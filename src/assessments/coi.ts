/**
 * @license
 * Copyright 2024 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import "@oada/pino-debug";
import { readFile, stat, writeFile } from "node:fs/promises";
import { connect, type OADAClient } from "@oada/client";
import { doJob } from "@oada/client/jobs";
import debug from "debug";
import Excel from "exceljs";
// @ts-expect-error jsonpath lacks types
import jp from "jsonpath";
// @ts-expect-error jsonpath lacks types
import jp from "jsonpath";
import JsZip from "jszip";
import ky, { HTTPError, type Options as KyOptions } from "ky";
import { type ErrorObject, serializeError } from "serialize-error";
import config from "../config.js";
import type {
  AttachmentResources,
  AutoLiability,
  CoiAssessment,
  CombinedTrellisCOI,
  ErrObj,
  ExcelRow,
  ExtractPdfResult,
  FlDocComment,
  FlDocument,
  FlDocumentError,
  FlQuery,
  GeneralLiability,
  HolderCheckResult,
  Limit,
  LimitResult,
  Policy,
  PolicyType,
  ReportDataSave,
  TargetJob,
  TrellisCOI,
  UmbrellaLiability,
  WorkersCompEmployersLiability,
} from "../types.js";
import { groupBy, minimumDate, sum } from "../utils.js";

const { domain, token } = config.get("trellis");
const FL_TOKEN = config.get("foodlogiq.token");
const FL_DOMAIN = config.get("foodlogiq.domain");
const CO_ID = config.get("foodlogiq.community.owner.id");
const COMMUNITY_ID = config.get("foodlogiq.community.id");

const fail = "FFb96161";
const passFill = "FF80a57d";
const warnFill = "FFffff93";
const actionFill = "FFffffa6";

const limits: Record<string, Limit> = {
  "General Liability Per Occurrence": {
    limit: 2_000_000,
    title:
      "General Liability\n(Per Occurrence)\n(Greater than or equal\nto 2000000)",
    name: "General Liability",
    longname: "General Liability (Per Occurrence)",
    path: "each_occurrence",
    type: "cgl",
  },
  "General Liability Aggregate": {
    limit: 5_000_000,
    title:
      "General Liability\n(Aggregate)\n(Greater than or equal\nto 5000000)",
    name: "General Liability",
    longname: "General Liability (Aggregate)",
    path: "general_aggregate",
    type: "cgl",
  },
  "Automobile Liability": {
    limit: 1_000_000,
    title: "Automobile Liability\n(Greater than or equal\nto 1000000)",
    name: "Automobile Liability",
    path: "combined_single_limit",
    type: "al",
  },
  "Employers Liability": {
    limit: 1_000_000,
    title: `Employer's Liability\n(Greater than or equal\nto 1000000)`,
    longname: `Employer's Liability`,
    name: `Worker's Compensation Employee Liability`,
    path: "el_each_accident",
    type: "wcel",
  },
};

const coiReportColumns = {
  "Trading Partner": 40,
  "FoodLogiq Document Link": 35,
  "Grouped FoodLogiq\nDocuments": 18,
  "Recommended Action": 18,
  "ACTION SELECTION": 18,
  "Rejection Reasons": 30,
  "Custom Message": 30,
  "Minimum Policy\nExpiration Date": 15,
  "Different FoodLogiq\nExpiration Date": 20,
  ...Object.fromEntries(Object.values(limits).map(({ title }) => [title, 20])),
  "Umbrella Liability": 15,
  "Workers Compensation\n(per Statutory Requirements)\n(Is equal to Yes)": 20,
  "Holder Name": 30,
  "FoodLogiq Comments": 30,
  "Attachment Parsing Details": 30,
  "Additional FoodLogiq \nDocs Considered": 20,
};

const trace = debug("fl-sync:trace");
const info = debug("fl-sync:info");
const error = debug("fl-sync:error");
const warn = debug("fl-sync:warn");
let oada: OADAClient;

try {
  oada = await connect({ domain, token });
} catch (error_) {
  error(error_);
}

/*
 *  Fetch some Food Logiq COIs
 */
async function getFlCois(
  queryString: string,
  coiResults: Record<string, FlDocument> = {},
  pageIndex?: number,
): Promise<Record<string, FlDocument>> {
  const request: KyOptions = {
    method: "get",
    headers: { Authorization: `${FL_TOKEN}` },
  };

  if (pageIndex) {
    request.searchParams = { pageIndex };
  }

  const response = await ky(
    `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents${queryString}`,
    request,
  );
  const data = await response.json<FlQuery>();

  for await (const flCoi of data.pageItems) {
    coiResults[flCoi._id] = flCoi;
  }

  // Repeat for additional pages of FL results
  if (data.hasNextPage) {
    await getFlCois(queryString, coiResults, data.nextPageIndex);
  }

  return coiResults;
}

/*
 * Fetch the attachments associated with a particular Food Logiq document.
 * For each attachment, return the OADA resource ID where the binary was stored.
 */
async function fetchAndExtractAttachments(
  item: FlDocument | FlDocumentError,
): Promise<AttachmentResources> {
  const attachments: AttachmentResources = {};

  let zipFile: Uint8Array;
  try {
    const response = await ky.get(
      `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      {
        headers: { Authorization: FL_TOKEN },
      },
    );
    zipFile = await response.bytes();
  } catch (error_: unknown) {
    if (error_ instanceof HTTPError && error_.response?.status === 404) {
      warn(
        error_,
        `Bad attachments on item ${item._id}. Returning with no attachments`,
      );
      return {
        msg: `Bad attachments on item ${item._id}.`,
        serialized: serializeError(error_),
      };
    }

    error(error_, `Errored on item ${item._id}. Returning with no attachments`);
    return {
      serialized: serializeError(error_ as Error),
    };
  }

  const zip = await new JsZip().loadAsync(zipFile);
  const files = Object.keys(zip.files);

  for await (const fKey of files) {
    if (!fKey) {
      warn(`Could not get file key for item ${item._id}`);
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] = {
        msg: `Could not get file key for item ${item._id}`,
      };
      continue;
    }

    // Prepare the pdf resource
    const ab = await zip.file(fKey)!.async("uint8array");
    const zdata = Buffer.alloc(ab.byteLength).map((_, index) => ab[index]!);

    try {
      const { headers } = await oada.post({
        path: "/resources",
        data: zdata,
        contentType: "application/pdf",
      });
      const _id = headers["content-location"]!.replace(/^\//, "");

      debug(
        `Extracting binary data for FL Doc ${item._id}. Attachment ${fKey}`,
      );
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] =
        await extractPdfData(_id);
    } catch (cError) {
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] =
        Buffer.byteLength(zdata) === 0
          ? {
              msg: "Attachment data was corrupt or empty.",
              serialized: serializeError(cError as Error),
            }
          : { serialized: serializeError(cError as Error) };
      // continue;
    }
  }

  return attachments;
}

async function extractPdfData(_id: string): Promise<ExtractPdfResult> {
  try {
    const job = (await doJob(oada, {
      service: "target",
      type: "transcription-only",
      config: {
        type: "pdf",
        pdf: { _id },
        "document-type": "application/vnd.trellisfw.coi.accord.1+json",
        "oada-doc-type": "cois",
      },
    })) as unknown as TargetJob;

    // Accumulate the attachments
    // Target result is like { cois: { abcx123: {_id: "resources/abc123"}}}
    const results: ExtractPdfResult["results"] = {};
    if (job.result.cois) {
      for await (const [key, value] of Object.entries(job.result.cois)) {
        const { data: doc } = (await oada.get({
          path: `/${value._id}`,
        })) as unknown as { data: TrellisCOI };

        (results as Record<string, TrellisCOI>)[key] = doc;
      }

      return { job, results };
    }

    return {
      job,
      results: {
        serialized: serializeError(job.result),
      },
    };
  } catch (error_: unknown) {
    error(error_);
    return {
      results: { serialized: serializeError(error_ as Error) },
    };
  }
}

/*
 * Does a few things:
 * - filters out improperly extracted dates resulting in dates with year 1900
 * - filters out expired policies
 */
function combineCois(
  mixedCois: Array<TrellisCOI | ErrorObject>,
): CombinedTrellisCOI {
  const cois: TrellisCOI[] = mixedCois.filter(
    (coi) => "_id" in coi,
  ) as TrellisCOI[];

  return {
    _id: cois.map((coi) => coi._id).join(";"),
    expire_date: policiesToExpirations(
      cois.flatMap((coi) => Object.values(coi?.policies || {})),
    ).sort(
      (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime(),
    )[0]!,

    policies: {
      cgl: composePolicy(
        cois,
        "Commercial General Liability",
      ) as GeneralLiability,
      al: composePolicy(cois, "Automobile Liability") as AutoLiability,
      ul: composePolicy(cois, "Umbrella Liability") as UmbrellaLiability,
      wcel: composePolicy(
        cois,
        `Worker's Compensation Employee Liability`,
      ) as WorkersCompEmployersLiability,
    },
  };
}

function policiesToExpirations(policies: Policy[]) {
  return policies
    .filter(Boolean)
    .filter((p) => typeof p !== "string" && "expire_date" in p)
    .map((policy: Policy) => policy.expire_date)
    .filter((d) => new Date(d).getFullYear() !== 1900);
}

// Compose a single policy of a particular type from an array of COIs (each with
// several policies of different types).
// -filters out already-expired policies
// -gives last expiration date if there were only expired policies
// -handles uploading the same PDF twice, i.e., idempotent merge on policy ID
function composePolicy(
  cois: TrellisCOI[],
  type: PolicyType,
): Policy | undefined {
  let policies = cois
    .flatMap((coi) => Object.values(coi.policies || {}))
    .filter((p) => typeof p !== "string");

  policies = policies.filter((p) => p.type === type);

  const uniques = new Set<string>();
  const activePolicies = policies
    // Filter dates first; policy numbers may not change each year
    .filter(
      (p) =>
        new Date(p.expire_date) > new Date() || hasBadDates([p.expire_date]),
    )
    // Filter by unique policy number
    .filter((p) => {
      if ("number" in p) {
        if (uniques.has(p.number)) {
          return false;
        }

        uniques.add(p.number);
      }

      return true;
    });

  if (Object.values(activePolicies).length === 0) {
    return undefined;
  }

  const combined: Policy = {} as unknown as Policy;

  // If none of the policies are active, return the closest one
  if (Object.values(activePolicies).length === 0 && policies.length > 0) {
    for (const pol of policies) {
      combined.expire_date = minimumDate(combined.expire_date, pol.expire_date);
    }

    return combined;
  }

  for (const pol of activePolicies) {
    combined.effective_date = minimumDate(
      combined.effective_date,
      pol.effective_date,
    );
    combined.expire_date = minimumDate(combined.expire_date, pol.expire_date);
    switch (type) {
      case "Commercial General Liability": {
        (combined as GeneralLiability).each_occurrence = sum(
          combined as GeneralLiability,
          pol as GeneralLiability,
          "each_occurrence",
        );
        (combined as GeneralLiability).general_aggregate = sum(
          combined as GeneralLiability,
          pol as GeneralLiability,
          "general_aggregate",
        );
        (combined as GeneralLiability)["products_-_compop_agg"] = sum(
          combined as GeneralLiability,
          pol as GeneralLiability,
          "products_-_compop_agg",
        );
        break;
      }

      case "Automobile Liability": {
        (combined as AutoLiability).combined_single_limit = sum(
          combined as AutoLiability,
          pol as AutoLiability,
          "combined_single_limit",
        );
        break;
      }

      case "Umbrella Liability": {
        (combined as UmbrellaLiability).each_occurrence = sum(
          combined as UmbrellaLiability,
          pol as UmbrellaLiability,
          "each_occurrence",
        );
        break;
      }

      case "Worker's Compensation Employee Liability": {
        (combined as WorkersCompEmployersLiability).el_each_accident = sum(
          combined as WorkersCompEmployersLiability,
          pol as WorkersCompEmployersLiability,
          "el_each_accident",
        );
        (combined as WorkersCompEmployersLiability).el_disease_employee = sum(
          combined as WorkersCompEmployersLiability,
          pol as WorkersCompEmployersLiability,
          "el_disease_employee",
        );
        (combined as WorkersCompEmployersLiability).el_disease_limit = sum(
          combined as WorkersCompEmployersLiability,
          pol as WorkersCompEmployersLiability,
          "el_disease_limit",
        );
        (combined as WorkersCompEmployersLiability).per_statute =
          ((combined as WorkersCompEmployersLiability).per_statute || "1") ===
            "1" && (pol as WorkersCompEmployersLiability).per_statute === "1"
            ? "1"
            : "0";

        break;
      }

      case "Worker's Compensation": {
        break;
      }
    }
  }

  return combined;
}

function hasBadDates(allExpirations: string[]): boolean {
  return allExpirations.some((date) => new Date(date).getFullYear() === 1900);
}

function assessCoi({
  flCoi,
  attachments,
  combinedTrellisCoi,
}: {
  flCoi: FlDocument | FlDocumentError;
  attachments: TrellisCOI[];
  combinedTrellisCoi: CombinedTrellisCOI;
}): CoiAssessment {
  let reasons: string[] = [];

  // First check for expirations using only this FL COI's attachments
  const { minExpiration, expiryPassed, expiryMismatch, flExpiration } =
    checkExpirations(flCoi as FlDocument, combinedTrellisCoi);

  // Check if the coverages are satisfactory
  const umbrella = Number.parseInt(
    String(combinedTrellisCoi?.policies?.ul?.each_occurrence ?? "0"),
    10,
  );

  // Check policies against limits
  const limitCheck = checkPolicyLimits(combinedTrellisCoi, reasons, umbrella);
  const { limitResults } = limitCheck;
  reasons = limitCheck.reasons;
  const limitsPassed = Object.values(limitResults).every(({ pass }) => pass);

  const parsingError = false;

  if (parsingError) {
    reasons.push("PDF Parsing error");
  }

  // Check Worker's Comp
  const workersCheck = checkWorkersComp(
    combinedTrellisCoi,
    parsingError,
    reasons,
  );
  reasons = workersCheck.reasons;

  // Check Holder
  const holderCheck = checkHolders(attachments);
  if (!holderCheck.pass)
    reasons.push("Holder info does not meet requirements.");

  // Make overall assessment
  const assessment = {
    passed: Boolean(
      limitsPassed &&
        expiryPassed &&
        workersCheck.workersPerStatute &&
        holderCheck.pass,
    ),
    dateParseWarning: Object.values(limitResults).some(
      ({ dateParseWarning }) => dateParseWarning,
    ),
    reasons: reasons.length > 0 ? reasons.join("\n") : "",
  };

  return {
    assessment,
    minExpiration,
    expiryPassed,
    expiryMismatch,
    flExpiration,
    parsingError,
    limitResults,
    workersCheck,
    holderCheck,
  };
}

export function generateAssessmentRow({
  flCoi,
  combinedTrellisCoi,
  assessment,
  part,
  additionalCoisConsidered,
  attachmentStatuses,
  minExpiration,
  expiryPassed,
  expiryMismatch,
  flExpiration,
  parsingError,
  invalidHolder,
  limitResults,
  workersCheck,
  holderCheck,
}: CoiAssessment & {
  flCoi: FlDocument | FlDocumentError;
  combinedTrellisCoi: CombinedTrellisCOI;
  part: string;
  additionalCoisConsidered: string;
  attachmentStatuses: Record<string, string>;
}): Record<string, ExcelRow> {
  return {
    "Trading Partner": {
      value:
        // @ts-expect-error
        flCoi?.shareSource?.sourceBusiness?.name ??
        "Unknown (error retrieving FL Doc)",
    },

    "FoodLogiq Document Link": {
      value: "name" in flCoi ? flCoi.name : flCoi._id,
      hyperlink: flIdToLink(flCoi._id),
    },

    "Grouped FoodLogiq\nDocuments": {
      value: part,
    },

    "Recommended Action": {
      value: assessment.passed
        ? "Approve"
        : parsingError || assessment.dateParseWarning
          ? "Review"
          : "Reject",
    },

    "ACTION SELECTION": {
      value: "",
      dropdown: {
        formulae: '"Ignore,Approve,Reject,Archive"',
      },
    },

    "Rejection Reasons": {
      value: assessment.passed
        ? " "
        : parsingError
          ? `PDF extraction errors occurred. ${invalidHolder ? "Invalid Holder info detected. " : ""}`
          : assessment.reasons || "",
      // ...(assessment.passed ? {fill: passFill}: parsingError ? {fill: warnFill } : {}), // {fill: fail}),
    },

    "Custom Message": { value: "" },

    "Minimum Policy\nExpiration Date": {
      value: minExpiration ? minExpiration.split("T")[0] : "",

      ...(expiryPassed === undefined
        ? {}
        : expiryPassed
          ? {}
          : parsingError
            ? {}
            : { fill: fail }),
    },

    "Different FoodLogiq\nExpiration Date": {
      value: expiryMismatch ? flExpiration : "",
      ...(expiryMismatch ? { fill: fail } : {}),
    },

    ...Object.fromEntries(
      Object.entries(limitResults ?? {}).map(([, object]) => [
        object?.title,
        {
          value: object?.value,
          ...(object.pass
            ? {}
            : object.dateParseWarning
              ? { fill: warnFill }
              : // Do not highlight when there is a parsing error or no value (no unexpired policies)
                // @ts-expect-error
                parsingError || (!object?.value && object?.value !== 0)
                ? {}
                : { fill: fail }),
        },
      ]),
    ),

    "Umbrella Liability (Per Accident) (Greater than or equal\nto 1000000)": {
      value: combinedTrellisCoi?.policies?.ul?.each_occurrence,
    },

    "Workers Compensation (per Statutory Requirements) (Is equal to Yes)": {
      value: workersCheck.workersPerStatute,
      ...(workersCheck.workersDateParseWarning
        ? { fill: warnFill }
        : workersCheck.workersExpired
          ? { fill: fail }
          : workersCheck.workersPerStatute.startsWith("No")
            ? { fill: fail }
            : {}),
    },

    "Holder Name (s)": {
      value: holderCheck?.holderString,
      ...(parsingError || holderCheck?.pass ? {} : { fill: fail }),
    },

    Comments: gatherComments(flCoi as FlDocument),

    "Attachment Details": {
      value: Object.entries(attachmentStatuses)
        .map(([id, status]) => `${id}: ${status}`)
        .join("\n"),
    },

    "Additional FoodLogiq Docs Considered": { value: additionalCoisConsidered },
  };
}

function checkHolders(cois: TrellisCOI[]): HolderCheckResult {
  const holderString = cois
    .map((coi) =>
      [
        coi.holder?.name,
        coi.holder?.location?.street_address,
        coi.holder?.location?.city,
        coi.holder?.location?.state,
        coi.holder?.location?.postal_code,
        coi.holder?.location?.country,
      ].filter(Boolean),
    )
    .join("\n");

  const goodValues = cois.filter((coi) =>
    Boolean(
      coi?.holder?.name &&
        coi?.holder?.location &&
        coi?.holder?.name.toLowerCase().includes("smithfield") &&
        coi?.holder?.location.state?.toLowerCase() === "va" &&
        coi?.holder?.location.city?.toLowerCase() === "smithfield" &&
        coi?.holder?.location?.street_address
          ?.toLowerCase()
          .includes("commerce"),
    ),
  );

  return { holderString, goodValues, pass: goodValues.length > 0 };
}

function checkExpirations(flCoi: FlDocument, combinedTrellisCoi: TrellisCOI) {
  const allExpirations = policiesToExpirations(
    Object.values(combinedTrellisCoi?.policies ?? {}),
  );

  const minExpiration = allExpirations.sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  )[0];
  const minExpirationDate = minExpiration && new Date(minExpiration);

  // Verify Expiration Dates
  const expiryPassed = minExpirationDate && minExpirationDate > new Date();

  const flExp = new Date(flCoi.expirationDate);
  const flExpiration = flExp.toISOString().split("T")[0];
  flExp.setHours(0);

  // Check if the FL Document expiration date does not match the minimum of the COI doc
  // False and undefined are treated the same
  const expiryMismatch = minExpirationDate && minExpirationDate < flExp;
  if (expiryMismatch) {
    warn("The policy expiration date does not match the FL expiration date.");
  }

  return { flExpiration, expiryPassed, minExpiration, expiryMismatch };
}

/*
 *  Umbrella should only apply when there is an existing policy to begin with.
 */
function checkPolicyLimits(
  coi: CombinedTrellisCOI | undefined,
  reasons: string[],
  umbrella: number,
): {
  limitResults: Record<string, LimitResult>;
  reasons: string[];
} {
  const limitResults = Object.fromEntries(
    Object.values(limits).map((limit) => {
      const policy = coi?.policies?.[limit.type as "wcel" | "al" | "cgl"];
      // @ts-expect-error
      const value = policy?.[limit.path];

      // No policy found. Umbrella should not count in this case.
      if (value === "" || value === undefined) {
        reasons.push(`No unexpired ${limit.name} policies found`);
        return [
          limit.title,
          {
            ...limit,
            pass: false,
            value: "",
            dateParseWarning: false,
          },
        ];
      }

      // Compute the "effective" coverage with umbrella liability included
      const effValue = Number.parseInt(value ?? "0", 10) + umbrella;

      const expireDate =
        coi?.policies?.[limit.type as "wcel" | "al" | "cgl"]?.expire_date;

      const expired = expireDate ? new Date(expireDate) < new Date() : true;
      const dateParseWarning = expireDate ? hasBadDates([expireDate]) : false;

      if (expireDate === undefined) {
        reasons.push(`${limit.name} policy has no expiration date`);
      } else if (expired && !dateParseWarning) {
        reasons.push(
          `${limit.name} policy expired ${expireDate.split("T")[0]}`,
        );
      }

      const pass = !dateParseWarning && effValue >= limit.limit;
      if (dateParseWarning) {
        reasons.push(`Confirm Effective Dates for ${limit.name} policy.`);
      } else if (!pass && !Number.isNaN(effValue)) {
        reasons.push(
          `Insufficient ${limit.longname ?? limit.name} coverage. ${limit.limit} is required. Coverage${
            umbrella > 0 ? " including Umbrella policy" : ""
          } is only ${effValue}.`,
        );
      }

      // Compose the entry
      return [
        limit.title,
        {
          ...limit,
          pass,
          value: expired
            ? dateParseWarning
              ? `${value} (Confirm Effective Dates)`
              : `Expired ${expireDate ? expireDate.split("T")[0] : "(unknown)"}`
            : value,
          dateParseWarning,
        },
      ];
    }),
  );

  return {
    limitResults,
    reasons: [...new Set(reasons)], // Two types of General Liability are assessed, so will create a duplicate reason
  };
}

// Verify Worker's Compensation coverage
function checkWorkersComp(
  coi: CombinedTrellisCOI | undefined,
  parsingError: boolean,
  reasons: string[],
) {
  const wcelPolicies = [coi?.policies?.wcel].filter(
    Boolean,
  ) as WorkersCompEmployersLiability[];
  //const wcelPolicies = Object.values(coi?.policies ?? [])
  //  .filter(p => typeof p === 'object' && p.type === "Worker's Compensation Employee Liability");

  let workersPerStatute = "";

  if (wcelPolicies.length <= 0 && !parsingError) {
    // This should already get flagged by the Employer's Liability coverage check
    //    reasons.push(`Worker's Comp policy required.`);
  }

  for (const p of wcelPolicies) {
    workersPerStatute = p.per_statute === "1" ? "Yes" : "No";

    if (hasBadDates([p.expire_date])) {
      //reasons.push(`Worker's Comp policy ${p.number ? `${p.number} `: ''}had an improperly extracted expiration date.`);
      workersPerStatute = `${workersPerStatute} (Confirm Effective Dates)`;
      continue;
    }

    if (new Date(p.expire_date) < new Date()) {
      reasons.push(
        `Worker's Comp policy ${p.number ? `${p.number} ` : ""}is expired.`,
      );
      workersPerStatute = `${p.per_statute} (Expired ${p.expire_date.split("T")[0]})`;
      continue;
    }

    if (p.per_statute !== "1") {
      reasons.push(
        `Worker's Comp policy ${p.number ? `${p.number} ` : ""}is missing per statute requirement.`,
      );
    }
  }

  return {
    workersPerStatute,
    reasons,
    workersDateParseWarning: Object.values(wcelPolicies).some((p) =>
      hasBadDates([p.expire_date]),
    ),
    workersExpired: Object.values(wcelPolicies).some(
      (p) => new Date(p.expire_date) < new Date(),
    ),
  };
}

function gatherComments(coi: FlDocument) {
  const comments = Object.values(coi.comments ?? {}).map(
    (comsArray: FlDocComment[]) =>
      comsArray
        .map(
          (com) =>
            `${com.createdBy.firstName} ${com.createdBy.lastName}: ${com.comment}`,
        )
        .join("\n"),
  );

  return {
    value: comments.join("\n"),
  };
}

async function writeExcelFile(
  rows: Array<Record<string, ExcelRow>>,
  columns: Record<string, number>,
  fname: string,
) {
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet("Report", {
    views: [
      {
        state: "frozen",
        xSplit: 1,
      },
    ],
  });

  worksheet.columns = Object.entries(columns).map(([header, width]) => ({
    header,
    width,
  }));

  const startRow = 2;
  const startCol = 1;

  for (const [rowIndex, row] of rows.entries()) {
    for (const [
      colIndex,
      { value, fill, hyperlink, dropdown },
    ] of Object.values(row).entries()) {
      const cell = worksheet.getCell(startRow + rowIndex, startCol + colIndex);
      cell.value = hyperlink
        ? {
            text: value as string,
            hyperlink,
          }
        : value;

      if (fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fill },
        };
      }

      if (dropdown) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [dropdown.formulae],
        };
      }
    }
  }

  // Changing this appears to change the font different from the rest, so I apparently need to specify it now...
  worksheet.getColumn(5).font = { bold: true, name: "Calibri" };

  worksheet.getColumn(5).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: actionFill },
  };

  createOuterBorder(
    worksheet,
    {
      row: 2,
      col: 5,
    },
    {
      row: rows.length + 1,
      col: 5,
    },
  );

  worksheet.getRow(1).height = 40;

  // Save the modified workbook
  await workbook.xlsx.writeFile(fname);
}

const defaultPosition = { row: 1, col: 1 };
const defaultBorderWidth = "thick";
function createOuterBorder(
  worksheet: Excel.Worksheet,
  start: {
    row: number;
    col: number;
  } = defaultPosition,
  end: { row: number; col: number } = defaultPosition,
  borderWidth: "thick" = defaultBorderWidth,
) {
  const borderStyle = {
    style: borderWidth,
  };
  for (let i = start.row; i <= end.row; i++) {
    const leftBorderCell = worksheet.getCell(i, start.col);
    const rightBorderCell = worksheet.getCell(i, end.col);
    leftBorderCell.border = {
      ...leftBorderCell.border,
      left: borderStyle,
    };
    rightBorderCell.border = {
      ...rightBorderCell.border,
      right: borderStyle,
    };
  }

  for (let i = start.col; i <= end.col; i++) {
    const topBorderCell = worksheet.getCell(start.row, i);
    const bottomBorderCell = worksheet.getCell(end.row, i);
    topBorderCell.border = {
      ...topBorderCell.border,
      top: borderStyle,
    };
    bottomBorderCell.border = {
      ...bottomBorderCell.border,
      bottom: borderStyle,
    };
  }
}

function flIdToLink(_id: string) {
  return `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${_id}/${COMMUNITY_ID}`;
}

/**
 * Find documents with drafts and apply an "Awaiting Approval" status.
 * Because FL seems to lack the appropriate query parameters, a 2-year
 * limit is placed on versionUpdated (apart from the COI doc type).
 * Then, we filter the returned results by presence of draftVersionId.
 *
 * @returns voice
 */
export async function draftsToAwaitingApproval() {
  const queryDate = new Date();
  queryDate.setMonth(new Date().getMonth() - 24);
  const flBaseQuery = `?sourceCommunities=5fff03e0458562000f4586e9&shareSourceTypeId=60653e5e18706f0011074ec8&versionUpdated=${queryDate.toISOString()}..`;
  let flCois = await getFlCois(flBaseQuery);

  // Find docs with drafts
  flCois = Object.fromEntries(
    Object.entries(flCois).filter(
      ([_, flCoi]) => flCoi.shareSource.draftVersionId,
    ),
  );

  for await (const [_, coi] of Object.entries(flCois)) {
    const _id = coi.shareSource.draftVersionId;
    await ky.put(
      `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${_id}/approvalStatus`,
      {
        json: {
          comment: "",
          status: "Awaiting Approval",
          visibleForSupplier: false,
        },
        headers: {
          Authorization: `${FL_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
  }

  return flCois;
}

/*
 * The original setup in generateCoisReport used the attachments on a single FL doc; Instead, let's combine documents
 * across the trading partner to handle multiple FL docs.
 */
export async function gatherCoisReportData(outputFilename: string) {
  let flCois: ReportDataSave["flCois"] = {};
  let attachments: ReportDataSave["attachments"] = {};

  // Try to load what we can
  if (await stat(outputFilename)) {
    // Load the saved JSON data
    const json = await readFile(outputFilename, "utf8");
    const obj = JSON.parse(json) as ReportDataSave;
    flCois = obj.flCois;
    attachments = obj.attachments;
  } else {
    // 1. Grab all FL COIs currently awaiting-review
    const queryDate = new Date();
    queryDate.setMonth(new Date().getMonth());
    const flBaseQuery = `?sourceCommunities=5fff03e0458562000f4586e9&approvalStatuses=Awaiting Approval&shareSourceTypeId=60653e5e18706f0011074ec8&archived=false&expirationDate=${queryDate.toISOString()}..`;
    flCois = await getFlCois(flBaseQuery);
  }

  // 2. Group COIs by supplier
  const coisBySupplier: Record<
    string,
    Array<FlDocument | FlDocumentError>
  > = groupBy(
    Object.values(flCois),
    (flCoi) => flCoi?.shareSource?.sourceBusiness?._id,
  );

  const queryDate = new Date();
  queryDate.setMonth(new Date().getMonth());
  let i = 0;
  for await (const [busId, supplierCois] of Object.entries(coisBySupplier)) {
    debug(
      `Processing Business ${busId} (${i++}/${Object.values(coisBySupplier).length})`,
    );
    if (attachments[supplierCois[0]!._id]) {
      trace(`Business ${busId} already processed.`);
      continue;
    }

    // 3. Grab additional COIs of other statuses from that supplier
    //    that may contribute to the assessment.
    const flTradingPartnerQuery = `?sourceCommunities=5fff03e0458562000f4586e9&approvalStatuses=Approved&sourceBusinesses=${busId}&shareSourceTypeId=60653e5e18706f0011074ec8&expirationDate=${queryDate.toISOString()}..`;
    const moreFlCois = await getFlCois(flTradingPartnerQuery);

    flCois = {
      ...flCois,
      ...moreFlCois,
    };

    // The collection of grouped flCois
    supplierCois.push(...Object.values(moreFlCois));

    // Fetch the attachments and save the job result(s) which are TrellisCOIs
    for await (const coi of Object.values(supplierCois)) {
      attachments[coi._id] = await fetchAndExtractAttachments(coi);
    }

    await writeFile(outputFilename, JSON.stringify({ attachments, flCois }));
  }

  await writeFile(outputFilename, JSON.stringify({ flCois, attachments }));
  return { flCois, attachments };
}

export async function generateCoisReport(
  reportDataSave: ReportDataSave,
  filename: string,
) {
  const { flCois, attachments } = reportDataSave;

  // 2. Group COIs by supplier
  const coisBySupplier: Record<
    string,
    Array<FlDocument | FlDocumentError>
  > = groupBy(
    Object.values(flCois),
    (flCoi) => flCoi?.shareSource?.sourceBusiness?._id,
  );

  const excelData: Array<Record<string, ExcelRow>> = [];
  let i = 0;
  for (const [busId, supplierCois] of Object.entries(coisBySupplier)) {
    trace(
      `Processing Business ${busId} (${i++}/${Object.values(coisBySupplier).length})`,
    );

    // Filter the actual TrellisCOI attachments
    const coisToCombine = supplierCois
      // Filter errors at the coi level (failed to retrieve all attachments)
      .filter(({ _id }) => !attachments[_id]!.serialized)
      .flatMap(({ _id }) =>
        Object.values(attachments[_id] ?? {})
          // Filter ErrObjs at the individual attachment level
          .filter((value) => "results" in value)
          .flatMap(
            ({ results }: ExtractPdfResult) =>
              Object.values(results) as TrellisCOI[],
          ),
      );

    const coisToReport = supplierCois
      // Filter errors at the coi level (failed to retrieve all attachments)
      .filter(
        (flCoi) =>
          !("error" in flCoi) &&
          flCoi?.shareSource?.approvalInfo?.status === "Awaiting Approval" &&
          flCoi?.isArchived !== true,
      );

    const additionalCoisConsidered = supplierCois
      .map(({ _id }) => flIdToLink(_id))
      .join("\n");

    const combinedTrellisCoi = combineCois(coisToCombine);
    for (const [index, flCoi] of coisToReport.entries()) {
      const attachmentStatuses = Object.fromEntries(
        supplierCois
          // Filter errors at the coi level (failed to retrieve all attachments)
          .filter(({ _id }) => !attachments[_id]!.serialized)
          .flatMap(({ _id }) =>
            Object.entries(attachments[_id] ?? {})
              // Filter ErrObjs at the individual attachment level
              .map(([key, trellisCoiOrError]) => [
                key,
                "serialized" in trellisCoiOrError ||
                trellisCoiOrError.results.serialized
                  ? `Parsing Error: ${(
                      trellisCoiOrError?.results?.serialized?.cause?.cause
                        ?.information ??
                      trellisCoiOrError?.msg ??
                      ""
                    )
                      .replaceAll("!", "")
                      .replaceAll(";", "; ")}`
                  : "Success",
              ]),
          ),
      ) as unknown as Record<string, string>;
      const attachmentExtractionErrors = Object.fromEntries(
        supplierCois
          // Filter errors at the coi level (failed to retrieve all attachments)
          .filter(({ _id }) => !attachments[_id]!.serialized)
          .flatMap(({ _id }) =>
            Object.entries(attachments[_id] ?? {})
              // Filter ErrObjs at the individual attachment level
              .filter(
                ([_, trellisCoiOrError]) =>
                  "serialized" in trellisCoiOrError ||
                  trellisCoiOrError.results.serialized,
              )
              .map(([key, trellisCoiOrError]) => [
                key,
                trellisCoiOrError?.results?.serialized?.cause?.cause
                  ?.information,
              ]),
          ),
      ) as unknown as Record<string, string>;

      const invalidHolder = Object.values(
        attachmentExtractionErrors || {},
      ).some((value) => (value || "").includes("Holder"));

      const thisCoiAttachments = Object.values(attachments[flCoi._id] ?? {})
        // Filter ErrObjs at the individual attachment level
        .filter((value) => "results" in value)
        .flatMap(
          ({ results }: ExtractPdfResult) =>
            Object.values(results) as TrellisCOI[],
        );

      const coiAssessment = assessCoi({
        flCoi,
        attachments: thisCoiAttachments,
        combinedTrellisCoi,
      });

      const parsingError = Object.values(attachmentStatuses).some((status) =>
        status.includes("Parsing Error"),
      );

      excelData.push(
        generateAssessmentRow({
          flCoi,
          ...coiAssessment,
          combinedTrellisCoi,
          parsingError,
          invalidHolder,
          part: coisToReport.length <= 1 ? "" : (index + 1).toLocaleString(),
          additionalCoisConsidered,
          attachmentStatuses,
        }),
      );
    }
  }

  info(`Writing Excel file...${filename}`);
  await writeExcelFile(excelData, coiReportColumns, filename);
}

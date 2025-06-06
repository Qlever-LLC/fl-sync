/**
 * @license
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import config from "./config.js";

import fs from "node:fs/promises";

import "@oada/pino-debug";
// @ts-expect-error no types
import csvjson from "csvjson";
import debug from "debug";
import ksuid from "ksuid";
import moment from "moment";

import type { OADAClient } from "@oada/client";
import { connect } from "@oada/client";
import type { Job } from "@oada/jobs";
import type Link from "@oada/types/oada/link/v1.js";

const DOMAIN = config.get("trellis.domain");
const TOKEN = config.get("trellis.token");
const SERVICE_NAME = config.get("service.name");
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const SUPPLIER = config.get("foodlogiq.testSupplier.id");
const FL_TRELLIS_USER = config.get("foodlogiq.trellisUser");
const CO_ID = config.get("foodlogiq.community.owner.id");
const FL_DOMAIN = config.get("foodlogiq.domain");
const FL_TOKEN = config.get("foodlogiq.token");

const info = debug("fl-sync:info");
const trace = debug("fl-sync:trace");
const error = debug("fl-sync:error");

const humanReadableJobError: Record<string, string> = {
  "target-other": "Other target errors",
  "associated-assessment-rejected": "Assessment failure",
  "document-validation": "Document data did not match Food LogiQ data",
  "target-unrecognized": "Format unrecognized during extration",
  "multi-files-attached": "Multiple files were attached within Food LogiQ",
  "target-validation":
    "Required data elements missing during Target extraction",
  "target-multiple-docs-combined":
    "The PDF contained multiple document extractable results, but this is current not supported.",
  "bad-fl-attachments":
    "Attachments corrupt or can no longer be retrieved from Amazon S3",
};

export async function makeFinalReport() {
  const spreadsheet: any[] = [];
  const otherReport: any = {
    otherErrors: {},
    notInLaserfiche: {},
    approvedNotInLaserfiche: {},
    approvedButNoJob: {},
    flDeleted: {},
  };

  const finalReport: any = {
    total: 0,
    ignoreTestSupplier: 0,
    ignoreCommunityOwner: 0,
    flStatuses: {
      approved: {
        total: 0,
        byUs: 0,
      },
      rejected: {
        total: 0,
        byUs: 0,
      },
    },
    otherErrors: 0,
    "job-errors": {
      total: 0,
    },
    inLaserfiche: 0,
    notInLaserfiche: 0,
    flDeleted: 0,
  };

  try {
    // 1. Iterate over the docs
    const mint = setInterval(() => {
      info("ping");
    }, 3000);
    const oada = await connect({
      domain: `https://${DOMAIN}`,
      token: TOKEN,
    });
    const { data: buses } = await oada.get({
      path: `${SERVICE_PATH}/businesses`,
    });
    const busKeys: any = Object.keys(buses as Record<string, unknown>).filter(
      (index) => !index.startsWith("_"),
    );

    for await (const bid of busKeys) {
      const { data: docs } = await oada
        .get({
          path: `${SERVICE_PATH}/businesses/${bid}/documents`,
        })
        .catch(() => ({ data: undefined }));
      if (!docs) {
        return;
      }

      const documentKeys = Object.keys(docs).filter(
        (index) => !index.startsWith("_"),
      );

      for await (const docId of documentKeys) {
        if (!docId) {
          return;
        }

        const { data: document } = (await oada
          .get({
            path: `${SERVICE_PATH}/businesses/${bid}/documents/${docId}`,
          })
          .catch(() => ({ data: undefined }))) as { data: any };

        if (!document) {
          return;
        }

        // eslint-disable-next-line sonarjs/no-duplicate-string
        const type = `${document?.["food-logiq-mirror"]?.shareSource?.type?.name}`;
        if (type !== "Certificate of Insurance") {
          return;
        }

        finalReport.total++;

        if (bid === SUPPLIER) {
          finalReport.ignoreTestSupplier++;
          return;
        }

        if (bid === CO_ID) {
          finalReport.ignoreCommunityOwner++;
          return;
        }

        const documentName = `${document?.["food-logiq-mirror"]?.name} `;
        const busName = `${document?.["food-logiq-mirror"]?.shareSource?.sourceBusiness?.name}`;
        const status = `${
          document?.["food-logiq-mirror"]?.shareSource?.approvalInfo?.status
        }`;
        const user = `${document?.["food-logiq-mirror"]?.shareSource?.approvalInfo?.setBy?._id}`;
        const createDate = `${document?.["food-logiq-mirror"]?.versionInfo?.createdAt}`;
        if (status) {
          finalReport.flStatuses[status] ??= {};
          finalReport.flStatuses[status].total ??= 0;
          finalReport.flStatuses[status].total++;
        }

        if (status && user && user === FL_TRELLIS_USER) {
          finalReport.flStatuses[status].byUs ??= 0;
          finalReport.flStatuses[status].byUs++;
        }

        try {
          await fetch(
            `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}`,
            {
              method: "head",
              headers: {
                Authorization: `${FL_TOKEN}`,
              },
            },
          );
        } catch (cError: unknown) {
          // @ts-expect-error stupid errors
          if (cError.response.status === 404) {
            error("Document has been deleted in FL", {
              docid: docId,
              bid,
            });
            otherReport.flDeleted[docId] = { docid: docId, bid, status, user };
            finalReport.flDeleted++;
          } else throw cError as Error;
        }

        // 2. Get the associated job
        const { data: meta } = (await oada
          .get({
            path: `${SERVICE_PATH}/businesses/${bid}/documents/${docId}/_meta`,
          })
          .catch(() => ({ data: undefined }))) as { data: any };
        if (!meta) {
          return;
        }

        const jobs = (meta?.services?.["fl-sync"]?.jobs ??
          {}) as unknown as Record<string, Link>;
        if (Object.keys(jobs).length <= 0) {
          finalReport.missingFlSyncJob ??= 0;
          finalReport.missingFlSyncJob++;
          finalReport.flStatuses[status].missingFlSyncJob ??= 0;
          finalReport.flStatuses[status].missingFlSyncJob++;
          otherReport.missingFlSyncJobs ??= {};
          otherReport.missingFlSyncJobs[status] ??= {};
          otherReport.missingFlSyncJobs[status][docId] = {
            docid: docId,
            bid,
            status,
            user,
          };
          if (status === "approved") {
            trace({ docid: docId, bid, status, user });
            otherReport.approvedButNoJob[docId] = {
              docid: docId,
              bid,
              status,
              user,
            };
          }

          return;
        }

        const jobkey = mostRecentKsuid(Object.keys(jobs));
        if (!jobkey) {
          return;
        }

        const jobId = jobs[jobkey]?._id;

        const { data: job } = (await oada.get({
          path: `/${jobId}`,
        })) as unknown as { data: Job };

        // 3. Find the reason for failure
        // @ts-expect-error TODO: fix type for job
        const jobError: string | undefined = job?.result?.JobError;
        if (jobError) {
          finalReport["job-errors"][jobError] =
            finalReport["job-errors"][jobError] || 0;
          finalReport["job-errors"][jobError]++;
          finalReport["job-errors"].total++;

          spreadsheet.push({
            "Document Name": documentName,
            "Document Type": type,
            "Date Created": createDate,
            Supplier: busName,
            "FoodLogiQ Status": status,
            "Trellis Result": humanReadableJobError[jobError],
            "FoodLogiQ Link": `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${docId}`,
            "FoodLogiQ Document ID": docId,
            "FoodLogiQ Supplier ID": bid,
          });

          return;
        }

        if (job.status === "success") {
          finalReport.jobSuccess ??= 0;
          finalReport.jobSuccess++;

          spreadsheet.push({
            "Document Name": documentName,
            "Document Type": type,
            "Date Created": createDate,
            Supplier: busName,
            "FoodLogiQ Status": status,
            "Trellis Result": "Success",
            "FoodLogiQ Link": `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${docId}`,
            "FoodLogiQ Document ID": docId,
            "FoodLogiQ Supplier ID": bid,
          });
          info({ docid: docId, jobid: jobId, status: job.status });
        } else {
          finalReport.otherErrors++;
          otherReport.otherErrors[docId] = { docid: docId, bid, jobid: jobId };
          spreadsheet.push({
            "Document Name": documentName,
            "Document Type": type,
            "Date Created": createDate,
            Supplier: busName,
            "FoodLogiQ Status": status,
            "Trellis Result": "Other Trellis Error",
            "FoodLogiQ Link": `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${docId}`,
            "FoodLogiQ Document ID": docId,
            "FoodLogiQ Supplier ID": bid,
          });
          return;
        }

        // @ts-expect-error TODO: fix type for job
        const coiId: unknown = job?.trellisDoc?.key;

        if (coiId) {
          const { data: coiMeta } = (await oada.get({
            path: `/resources/${coiId}/_meta`,
          })) as { data: any };

          const entryId: unknown =
            coiMeta?.services?.["lf-sync"]?.LaserficheEntryID;
          if (entryId) {
            finalReport.inLaserfiche++;
          } else {
            finalReport.notInLaserfiche++;
            finalReport.flStatuses[status].notInLaserfiche ??= 0;
            finalReport.flStatuses[status].notInLaserfiche++;
            otherReport.notInLaserfiche[docId] = {
              docid: docId,
              bid,
              jobid: jobId,
            };
            if (status === "approved") {
              otherReport.approvedNotInLaserfiche[docId] = {
                docid: docId,
                bid,
                jobid: jobId,
              };
            }
          }
        }
        // 3b. Was it a target error
        // 3c. Was it some other error?
        // 3d. Is it still in limbo due to bad format, OCR, etc?
      }
    }

    info(finalReport);
    await fs.writeFile(
      "./scripts/finalReportDocs-Prod.json",
      JSON.stringify(otherReport),
    );
    await fs.writeFile(
      "./scripts/finalReport-Prod.json",
      JSON.stringify(finalReport),
    );
    finalReport.checks = {
      totals: {
        total: finalReport.total,
        testSupplier: finalReport.ignoreTestSupplier,
        success: finalReport.jobSuccess,
        jobErrors: finalReport["job-errors"].total,
        otherErrors: finalReport.otherErrors,
        missingFlSyncJob: finalReport.missingFlSyncJob,
        sum:
          finalReport.ignoreTestSupplier +
          finalReport.jobSuccess +
          finalReport["job-errors"].total +
          finalReport.otherErrors +
          finalReport.missingFlSyncJob,
      },
      awaiting: {
        total: finalReport.flStatuses["Awaiting Approval"].total,
        "target-unrecognized": finalReport["job-errors"]["target-unrecognized"],
        "target-validation": finalReport["job-errors"]["target-validation"],
        "target-other": finalReport["job-errors"]["target-other"],
        missingFlSyncJob:
          finalReport.flStatuses["Awaiting Approval"].missingFlSyncJob,
        "bad-fl-attachments": finalReport["job-errors"]["bad-fl-attachments"],
        otherErrors: finalReport.otherErrors,
        sum:
          finalReport["job-errors"]["target-validation"] +
          finalReport["job-errors"]["target-unrecognized"] +
          finalReport["job-errors"]["target-other"] +
          finalReport.flStatuses["Awaiting Approval"].missingFlSyncJob +
          finalReport["job-errors"]["bad-fl-attachments"] +
          finalReport.otherErrors,
      },
      approved: {
        jobSuccess: finalReport.jobSuccess,
        inLaserfiche: finalReport.inLaserfiche,
      },
    };
    info(finalReport);
    let csv = csvjson.toCSV(spreadsheet, { delimiter: ",", wrap: false });
    csv = fixHeaders(csv, Object.keys(spreadsheet[0]));
    await fs.writeFile("./scripts/finalReport-Prod.csv", csv);
    info("Done with CSV");

    clearInterval(mint);
    return csv;
  } catch (cError: unknown) {
    error(cError);
  }
}

function fixHeaders(csv: string, headers: string[]) {
  for (const h of headers) {
    const pattern = new RegExp(`\\[\\]\\.${h}`);
    csv = csv.replace(pattern, h);
  }
}

export function mostRecentKsuid(keys: string[]) {
  return keys.length > 0
    ? keys
        .map((k) => ksuid.parse(k))
        .reduce((a, b) => (a.compare(b) > 0 ? a : b)).string
    : undefined;
}

export function extraStuff(oada: OADAClient) {
  // 1. Check every X minutes to see if it is time to run the report
  setInterval(() => {
    isItTime(oada);
  }, 600_000);
  // 2. Run the report
  // 3. Write the report out to OADA in some day-index (if there is content)
  //   3a. Index it on the key of the document id
  // 4. Filter out the stuff we don't want to report on
  // 5. Turn it into a CSV
  // 6. Filter by date for daily
  // 7. Email it
}

export async function isItTime(oada: OADAClient) {
  let currentlyReporting = false;
  const now = moment();
  const { data: reportTime } = await oada.get({
    path: `${SERVICE_PATH}/_meta/report/fl-sync-daily/last-report`,
  });
  const lastTime = moment(reportTime as string);

  if (
    lastTime.year() === now.year() &&
    lastTime.clone().add(1, "day").dayOfYear() === now.dayOfYear() &&
    !currentlyReporting
  ) {
    currentlyReporting = true;
    const report = await makeFinalReport();
    await postEmailJob(report, oada);
  }
}

async function postEmailJob(csv: string, oada: OADAClient) {
  const date = moment().subtract(1, "day").format("YYYY-MM-DD");
  const job = {
    service: "abalonemail",
    type: "email",
    config: {
      multiple: false,
      from: "dev_3pty@centricity.us",
      to: {
        name: "Smithfield FSQA Suppliers",
        //        "email": "fsqasupplier@smithfield.com"
        email: "sn@centricity.us",
      },
      subject: `Trellis Automation Report - ${date}`,
      text: `Attached is the Trellis Automation Report for the Food Logiq documents processed for the 24 hour period of ${date}.`,
      attachments: [
        {
          content: csv,
          filename: `TrellisAutomationReport-${date}.csv`,
          type: "text/csv",
        },
      ],
    },
  };

  const { headers } = await oada.post({
    path: "/resources",
    contentType: "application/vnd.oada.job.1+json",
    data: job,
  });
  const jobkey = headers["content-location"]!.replace(/^\/resources\//, "");

  await oada.put({
    path: "/bookmarks/services/abalonemail/jobs/pending",
    data: {
      [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
    },
  });
}

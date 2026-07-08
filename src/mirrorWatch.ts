/**
 * @license
 * Copyright 2023 Qlever LLC
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
import crypto from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { JsonObject, OADAClient } from "@oada/client";
import { doJob, JobEventType, JobsRequest } from "@oada/client/jobs";
import {
  type Job,
  JobError,
  postUpdate,
  type WorkerFunction,
} from "@oada/jobs";
import { AssumeState, ChangeType, ListWatch } from "@oada/list-lib";
import type { Logger } from "@oada/pino-debug";
import oError from "@overleaf/o-error";
import pointer from "json-pointer";
import JSZip from "jszip";
import md5 from "md5";

import { linkAssessmentToDocument, spawnAssessment } from "./assessments.js";
import checkAssessment from "./checkAssessments.js";
import config from "./config.js";
import { flToTrellis, fromOadaType } from "./conversions.js";
import { validateResult } from "./docTypeValidation.js";
import { getAutoApprove } from "./index.js";
import tree from "./tree.js";
import mirrorTree from "./tree.mirrorWatch.js";
import type {
  AutoLiability,
  EmployersLiability,
  FlAssessment,
  FlObject,
  FlSyncJob,
  GeneralLiability,
  JobConfig,
  TargetJob,
  TrellisCOI,
  UmbrellaLiability,
} from "./types.js";

const FL_DOMAIN = config.get("foodlogiq.domain");
const FL_TOKEN = config.get("foodlogiq.token");
const ASSESSMENT_TEMPLATE_ID = config.get("foodlogiq.assessment-template.id");
const FL_TRELLIS_USER = config.get("foodlogiq.trellisUser");
const APPROVAL_TRELLIS_USER = config.get("foodlogiq.capaTrellisUser");
const CO_ID = config.get("foodlogiq.community.owner.id");
const COMMUNITY_ID = config.get("foodlogiq.community.id");
const FL_WRITEBACK_ENABLED = config.get("foodlogiq.writebackEnabled");

const SERVICE_NAME = config.get("service.name");
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const pending = `${SERVICE_PATH}/jobs/pending`;
const assessmentToFlId = new Map<
  string,
  { jobId: string; mirrorid: string; flId: string; assessmentJobId?: string }
>();
const targetErrors = {
  "target-multiple-docs-combined": {
    patterns: [/this is a multi-.* file/i],
    reject: false,
    jobError: "target-multiple-docs-combined",
  },
  "target-validation": {
    patterns: [/(validation|valiadation) failed/i],
    reject: true,
    jobError: "target-validation",
  },
  "target-unrecognized": {
    patterns: [
      /file format was not recognized/i,
      /^file is not a textual pdf/i,
    ],
    reject: false,
    jobError: "target-unrecognized",
  },
};

async function foodLogiqWriteback(
  description: string,
  url: string,
  options: RequestInit,
  log: Logger,
) {
  if (!FL_WRITEBACK_ENABLED) {
    log.warn(
      `FoodLogiQ writeback disabled by FL_WRITEBACK_ENABLED=false. Skipping ${description}.`,
    );
    return undefined;
  }

  return fetch(url, options);
}

const multipleFilesErrorMessage =
  "Multiple files attached. Please upload a single PDF per Food LogiQ document.";
const attachmentsErrorMessage = "Failed to retreive attachments";
const finalTargetStatuses = new Set(["success", "failure"]);

// Let targetErrorTypes = {"multi-COI": "multi-coi"}
const flSyncJobs = new Map(); // Map of fl-sync jobs
if (SERVICE_NAME && tree?.bookmarks?.services?.["fl-sync"]) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services["fl-sync"];
}

if (SERVICE_NAME && mirrorTree?.bookmarks?.services?.["fl-sync"]) {
  mirrorTree.bookmarks.services[SERVICE_NAME] =
    mirrorTree.bookmarks.services["fl-sync"];
}

let CONNECTION: OADAClient;
// Let flList = ['documents', 'products', 'locations', 'assessments'];
const noMultiFile = new Set();
/* Const multiFileOkay = [
  'Rate Sheet',
  'Specified Risk Materials (SRM) Audit',
  'Specified Risk Materials (SRM) Audit Corrective Actions',
  'Third Party Food Safety GMP Audit',
  'Third Party Food Safety GMP Audit Corrective Actions'
  ];
  */

const fTypes = {
  "100g Nutritional Information": { assessments: false },
  //  'ACH Form': { assessments: false },
  "APHIS Statement": { assessments: false },
  "Allergen Statement": { assessments: false },
  "Animal Welfare Audit": { assessments: false },
  "Animal Welfare Corrective Actions": { assessments: false },
  "Bioengineered (BE) Ingredient Statement": { assessments: false },
  "Bisphenol A (BPA) Statement": { assessments: false },
  "Business License": { assessments: false },
  COA: { assessments: false },
  "California Prop 65 Statement": { assessments: false },
  "Certificate of Insurance": { assessments: false },
  "Co-Pack Confidentiality Agreement Form": { assessments: false },
  "Co-Packer FSQA Questionnaire (GFSI Certified)": { assessments: false },
  "Co-Packer FSQA Questionnaire (Non-GFSI Certified)": { assessments: false },
  "Country of Origin Statement": { assessments: false },
  "E.Coli 0157:H7 Intervention Audit": { assessments: false },
  "E.Coli 0157:H7 Intervention Statement": { assessments: false },
  "Foreign Material Control Plan": { assessments: false },
  "GFSI Audit": { assessments: false },
  "GFSI Certificate": { assessments: false },
  "Gluten Statement": { assessments: false },
  "HACCP Plan / Flow Chart": { assessments: false },
  "Humane Harvest Statement": { assessments: false },
  "Ingredient Breakdown Range %": { assessments: false },
  "Lot Code Explanation": { assessments: false },
  "Master Service Agreement (MSA)": { assessments: false },
  "National Residue Program (NRP) Statement": { assessments: false },
  "Natural Statement": { assessments: false },
  "Non-Ambulatory (3D/4D) Animal Statement": { assessments: false },
  "Product Label": { assessments: false },
  "Product Specification": { assessments: false },
  "Pure Food Guaranty and Indemnification Agreement (LOG)": {
    assessments: false,
  },
  "Rate Sheet": { assessments: false },
  "Safety Data Sheet (SDS)": { assessments: false },
  //  'Small Business Administration (SBA) Form': { assessments: false },
  "Specified Risk Materials (SRM) Audit": { assessments: false },
  "Specified Risk Materials (SRM) Audit Corrective Actions": {
    assessments: false,
  },
  "Specified Risk Materials (SRM) Statement": { assessments: false },
  "Third Party Food Safety GMP Audit": { assessments: false },
  "Third Party Food Safety GMP Audit Corrective Actions": {
    assessments: false,
  },
  "Third Party Food Safety GMP Certificate": { assessments: false },
  //  'W-8': { assessments: false },
  //  'W-9': { assessments: false },
};
const flTypes = new Map(Object.entries(fTypes));

const rejectable = {
  //  'Certificate of Insurance': 'Certificate of Insurance',
  //  'cois': 'cois',
};

async function handleTargetStatus(
  targetJob: TargetJob,
  docJob: FlSyncJob,
  log: Logger,
) {
  const { status } = targetJob;
  const docJobId = docJob.oadaId;
  const { masterid, key } = docJob.config;
  const approvedMustContinue =
    docJob.config["allow-rejection"] === false || docJob.config.status === "Approved";
  if (docJob && approvedMustContinue) {
    log.trace(
      `[job ${docJobId}] Target finished with status ${status} on already-approved doc.`,
    );
    if (status === "success") {
      // If successful, skip the potential pitfalls of assessment creation and call finishDoc.
      await postUpdate(
        CONNECTION,
        docJobId,
        "Target extraction completed. Handling result...",
        "in-progress",
      );
      return finishDocument(docJobId, key, masterid, "Approved", log);
    }

    if (status === "failure") {
      // Approved documents still need to reach Laserfiche even when extraction fails.
      await postUpdate(
        CONNECTION,
        docJobId,
        "Target extraction failed",
        "in-progress",
      );
      return finishDocument(docJobId, key, masterid, "Approved", log);
    }
  }

  if (status === "success") {
    await postUpdate(
      CONNECTION,
      docJobId,
      "Target extraction completed. Handling result...",
      "in-progress",
    );
    await handleScrapedResult(targetJob, docJob as unknown as JsonObject, log);
  } else if (status === "failure") {
    await postUpdate(
      CONNECTION,
      docJobId,
      "Target extraction failed",
      "in-progress",
    );

    let jobError;
    let errorMessage = "Other Target failure";
    // Target failed and we have "updates". Otherwise, no "updates"; make it work.
    if (isObj(targetJob) && targetJob.updates) {
      // 1. Find the update with the error message
      const errorObject = Object.values(targetJob.updates).find(
        (object) => object.status === "error",
      );
      if (errorObject) errorMessage = errorObject.information;
      // 2. Determine whether to reject the document based on target error type; others we'll need to review
      // 3. Determine error indexing within fl-sync
      if (errorObject && typeof errorMessage === "string") {
        let reject = false;
        for (const tError of Object.values(targetErrors)) {
          if (tError.patterns.some((p) => p.test(errorMessage))) {
            jobError = tError.jobError;
            reject = tError.reject;
          }
        }

        log.error(
          jobError,
          `[job ${docJobId}] Target job ${targetJob._id} errored. reject: ${reject}; fl-sync job error ${jobError}`,
        );

        if (reject) {
          log.warn(
            `[job ${docJobId}] Target failure was rejectable, but automatic rejection is disabled.`,
          );
        }
        if (jobError)
          endJob(docJobId, log, new JobError(errorMessage, jobError));
      }
    }

    if (!jobError)
      endJob(docJobId, log, new JobError(errorMessage, "target-other"));
  }
}

async function handleAttachmentTargetStatus({
  targetJob,
  docJob,
  attachmentKey,
  log,
}: {
  targetJob: TargetJob;
  docJob: FlSyncJob;
  attachmentKey: string;
  log: Logger;
}) {
  const docJobId = docJob.oadaId;
  const { status } = targetJob;
  if (!finalTargetStatuses.has(status)) {
    log.trace(
      `[job ${docJobId}] Target job ${targetJob._id} for attachment ${attachmentKey} status event: ${status}. Waiting for final status.`,
    );
    return;
  }

  const trackedJob = flSyncJobs.get(docJobId);
  if (!trackedJob) {
    log.warn("Promise for flSyncJobs %s not found.", docJobId);
    return;
  }

  const targetJobsByAttachment = trackedJob.targetJobsByAttachment ?? {};
  const previousAttachmentJob = targetJobsByAttachment[attachmentKey];
  if (
    previousAttachmentJob?._id === targetJob._id &&
    previousAttachmentJob.status === status &&
    finalTargetStatuses.has(String(previousAttachmentJob.status))
  ) {
    log.trace(
      `[job ${docJobId}] Ignoring duplicate final Target status ${status} for attachment ${attachmentKey} job ${targetJob._id} from memory state.`,
    );
    return;
  }

  const { data: persistedAttachmentJob } = (await CONNECTION.get({
    path: `/${docJobId}/config/target-jobs/${attachmentKey}`,
  }).catch((error: any) => {
    if (error?.status === 404) return { data: undefined };
    throw error;
  })) as unknown as { data?: { _id?: string; status?: string } };
  let shouldPersistTargetStatus = true;
  if (
    persistedAttachmentJob?._id === targetJob._id &&
    persistedAttachmentJob.status === status &&
    finalTargetStatuses.has(String(persistedAttachmentJob.status))
  ) {
    targetJobsByAttachment[attachmentKey] = {
      ...previousAttachmentJob,
      ...persistedAttachmentJob,
    };
    trackedJob.targetJobsByAttachment = targetJobsByAttachment;
    log.trace(
      `[job ${docJobId}] Ignoring duplicate final Target status ${status} for attachment ${attachmentKey} job ${targetJob._id} from persisted state.`,
    );
    shouldPersistTargetStatus = false;
  }

  targetJobsByAttachment[attachmentKey] = {
    ...previousAttachmentJob,
    _id: targetJob._id,
    status,
  };
  trackedJob.targetJobsByAttachment = targetJobsByAttachment;

  if (shouldPersistTargetStatus) {
    await CONNECTION.put({
      path: `/${docJobId}/config`,
      data: {
        "target-jobs": {
          [attachmentKey]: {
            _id: targetJob._id,
            status,
          },
        },
      },
    });
    log.debug(
      `[job ${docJobId}] Persisted final Target status ${status} for attachment ${attachmentKey} job ${targetJob._id}.`,
    );
  }

  const expectedTargetJobCount = trackedJob.expectedTargetJobCount ?? Object.keys(targetJobsByAttachment).length;
  const targetJobEntries = Object.entries(targetJobsByAttachment) as Array<[
    string,
    { _id?: string; status?: string },
  ]>;
  const finalTargetJobEntries = targetJobEntries.filter(([, attachmentJob]) => finalTargetStatuses.has(String(attachmentJob.status)));

  log.trace(
    `[job ${docJobId}] Target job ${targetJob._id} for attachment ${attachmentKey} finished with ${status}. ${finalTargetJobEntries.length}/${expectedTargetJobCount} attachment target jobs complete.`,
  );

  if (trackedJob.targetJobsComplete) {
    log.trace(
      `[job ${docJobId}] All attachment Target jobs were already marked complete. Ignoring final status for ${attachmentKey}.`,
    );
    return;
  }

  if (finalTargetJobEntries.length < expectedTargetJobCount) return;

  trackedJob.targetJobsComplete = true;
  const successfulTargetEntry = targetJobEntries.find(([, attachmentJob]) => attachmentJob.status === "success");
  log.info(
    `[job ${docJobId}] All ${expectedTargetJobCount} attachment Target job(s) reached final status; ${finalTargetJobEntries.filter(([, attachmentJob]) => attachmentJob.status === "success").length} succeeded. Continuing document workflow.`,
  );

  if (successfulTargetEntry?.[1]._id) {
    const [, successfulTargetJob] = successfulTargetEntry;
    trackedJob.targetJobId = successfulTargetJob._id;
    const { data: successfulTargetJobData } = (await CONNECTION.get({
      path: `/${successfulTargetJob._id}`,
    })) as unknown as { data: TargetJob };

    await postUpdate(
      CONNECTION,
      docJobId,
      `Target extraction completed for ${finalTargetJobEntries.filter(([, attachmentJob]) => attachmentJob.status === "success").length} of ${expectedTargetJobCount} attachment(s). Handling successful extraction evidence.`,
      "in-progress",
    );

    return await handleTargetStatus(successfulTargetJobData, docJob, log);
  }

  return await handleTargetStatus(targetJob, docJob, log);
}

/**
 * handles queued assessment-type jobs.
 * Assessments should be treated as separate from the documents as much as possible.
 */
export const handleAssessmentJob: WorkerFunction = async (
  job: any,
  { oada, jobId, log },
) => {
  const jobKey = jobId.replace(/^resources\//, "");
  try {
    const { bid, key, flDocJobId: docJobId } = job.config;
    // Is this recommended?
    //log = log.child({ document: key })
    log.trace(`[job ${docJobId}] Handling incoming Assessment job ${jobKey}`);
    const { data: itemData } = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
    });
    if (!isObj(itemData)) {
      throw new TypeError(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    // eslint-disable-next-line sonarjs/no-duplicate-string
    const item = itemData["food-logiq-mirror"] as unknown as FlAssessment;

    if (!item || !isObj(item)) return {};
    if (!item._id || !assessmentToFlId.has(item._id)) {
      throw new Error(`assessmentToFlId does not exist for _id ${item._id}`);
    }

    // 1. Create a job entry for the assessment
    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}/_meta`,
      data: {
        services: {
          "fl-sync": {
            jobs: {
              [jobKey]: { _id: jobId }, // Assessment
            },
          },
        },
      },
    });

    const aaa = getAutoApprove();
    log.trace(
      `[job ${docJobId}] Autoapprove Assessments Configuration: [${aaa}]`,
    );
    if (aaa) {
      const { failed, reasons }: { failed: boolean; reasons: string[] } =
        checkAssessment(item);
      item.state = failed ? "Rejected" : "Approved";
      await CONNECTION.put({
        path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        data: {
          approval: !failed,
        },
      });
      log.trace(
        `[job ${docJobId}] Assessment Auto-${item.state}. [${item._id}]`,
      );
      await foodLogiqWriteback(
        `[job ${docJobId}] assessment auto-${item.state} ${item._id}`,
        `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${
          item._id
        }/${failed ? "reject" : "approve"}spawnedassessment`,
        {
          method: "put",
          headers: { Authorization: FL_TOKEN },
          body: JSON.stringify(item),
        },
        log,
      );
      log.trace(`[job ${docJobId}] Assessment Reasons: ${reasons.join(";")}`);

      const docJob = assessmentToFlId.get(item._id);
      if (docJob && failed) {
        await CONNECTION.put({
          path: `/${docJob.jobId}`,
          data: {
            "fail-reasons": reasons.join(";"),
          },
        });
      }

      await postUpdate(
        CONNECTION,
        jobId,
        {},
        `Assessment auto-${item.state}. [${item._id}] ${
          failed ? `for these reasons: ${reasons.join(";")}` : ""
        }`,
        // TODO: is this an enumerated status?Should the above line get applied as the 'meta'?
        // 'in-progress'
      );
      // TODO: Resolve this
      // fail/succeed the job
      if (failed) {
        //   Throw new Error('Assessment auto-rejected')
      } else {
        //    Return { assessmentState: item.state}
      }
    } else {
      // No auto-approve/reject set; leave it in limbo
    }

    // Save the assessment job under its item._id (not job id)
    return await new Promise((resolve, reject) => {
      flSyncJobs.set(item._id, {
        resolve,
        reject,
      });
      log.trace("Saved assessmentjob");
    });
  } catch (err: unknown) {
    log.error(err, "Error handleAssessmentJob");
    throw err;
  }
}; // HandleAssessmentJob

export async function postTpDocument({
  bid,
  item,
  oada,
  masterid,
  jobId,
  jobKey,
  docJob,
  log,
}: {
  bid: string;
  item: FlObject;
  oada: OADAClient;
  masterid: string;
  jobId: string;
  jobKey: string;
  docJob: Job;
  log: Logger;
}) {
  log.debug(`postTpDocument: bid:${bid} item:${item._id}`);
  const type = item?.shareSource?.type?.name;

  // 1. Retrieve the attachments and unzip
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
    {
      method: "get",
      headers: { Authorization: FL_TOKEN },
    },
  ).catch((error_) => {
    if (error_.response?.status === 404) {
      log.warn(`Bad attachments on item ${item._id}. Throwing JobError`);
      throw new JobError(attachmentsErrorMessage, "bad-fl-attachments");
    }
    throw error_;
  });
  const zipFile = await response.arrayBuffer();

  log.trace(`Got attachments for FL mirror ${item._id}`);

  const zip = await new JSZip().loadAsync(zipFile);

  const files = Object.keys(zip.files).filter((file) => !zip.files[file]?.dir);

  if (files.length !== 1 && noMultiFile.has(type)) {
    log.warn(`Multiple files not allowed for doc type ${type}`);
    throw new JobError(multipleFilesErrorMessage, "multi-files-attached");
  }

  const { document, docType, urlName } = await flToTrellis(item);
  log.trace(
    `Generated translated partial JSON for mirror with docType ${docType}`,
  );

  const hashKey = md5(JSON.stringify(item)); // Unique to every version of that fl document
  let docId: string | undefined;

  // If the trading-partner doc already exists, return the existing key
  try {
    const r = await oada.head({
      path: `/${masterid}/shared/trellisfw/documents/${urlName}/${hashKey}`,
    });
    docId = r.headers["content-location"]!.replace(/^\//, "");
    log.trace(
      `Doc for hashKey ${hashKey} already exists. Partial JSON lives at /${docId}`,
    );
  } catch (error_: unknown) {
    // @ts-expect-error error nonsense
    if (error_?.status !== 404) {
      throw error_;
    }

    const r = await oada.post({
      path: "/resources",
      data: document,
      contentType: docType,
    });
    docId = r.headers["content-location"]!.replace(/^\//, "");
    log.trace(
      `Doc for hashKey ${hashKey} did not exist. Partial JSON created at /${docId}`,
    );
  }

  // First, overwrite what is currently there if previous pdfs vdocs had been linked
  // NEW: Consider just writing this afterwards???
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
    data: {
      vdoc: {
        pdf: 0, // Wipes out {key1: {}, key2: {}, etc.}
      },
    },
    contentType: docType,
  });
  log.trace(
    `Reset pdf vdoc reference in mirror metadata of FL _id: ${item._id}`,
  );
  // 2. Fetch mirror and pdf resource id
  const { data: mirrorId } = (await oada.get({
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_id`,
  })) as unknown as { data: string };
  log.trace("Retrieved mirrorId %s", mirrorId);

  await oada.put({
    path: `/${docId}/_meta`,
    data: {
      vdoc: {
        pdf: 0,
      },
      shared: "incoming",
    },
  });
  log.trace(
    "Reset pdf vdoc reference in trellis document metadata for %s",
    docId,
  );

  const attachmentPdfs: Array<{
    attachmentKey: string;
    filename: string;
    pdfId: string;
  }> = [];

  for (const fKey of files) {
    if (!fKey)
      throw new Error(
        "Failed to acquire file key while handling pending document",
      );

    // Prepare one pdf resource per FoodLogiQ attachment.
    const ab = await zip.file(fKey)!.async("uint8array");
    const zData = Buffer.alloc(ab.byteLength).map((_, index) => ab[index]!);
    const pdfKey = crypto.createHash("sha256").update(zData).digest("hex");
    const pdfId = `resources/${pdfKey}-pdf`;

    try {
      await oada.put({
        path: `/${pdfId}`,
        data: zData,
        contentType: "application/pdf",
      });
      await oada.put({
        path: `/${pdfId}/_meta`,
        data: { filename: fKey },
        contentType: "application/json",
      });
      log.trace(`Wrote file [${fKey}] to pdfId ${pdfId}.`);
    } catch (cError: unknown) {
      throw Buffer.byteLength(zData) === 0
        ? new JobError(
            `Attachment Buffer data 'zData' was empty.`,
            "bad-fl-attachments",
          )
        : (cError as Error);
    }

    // 4. Create a vdoc entry from the pdf to foodlogiq
    await oada.put({
      path: `/${pdfId}/_meta`,
      data: {
        filename: fKey,
        vdoc: {
          foodlogiq: { _id: mirrorId },
        },
        services: {
          "fl-sync": {
            jobs: {
              [jobKey]: { _id: jobId },
            },
          },
        },
      } as any,
      contentType: "application/json",
    });
    log.trace(
      "Wrote FL mirror (%s) and fl-sync job (%s) references to _meta of pdf resource %s",
      mirrorId,
      jobId,
      pdfId,
    );

    await oada.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
      data: {
        vdoc: {
          pdf: {
            [pdfKey]: { _id: pdfId, filename: fKey },
          },
        },
      },
      contentType: docType,
    });
    log.trace(
      "Wrote pdf vdoc reference into FL mirror _meta for attachment %s",
      pdfKey,
    );

    await oada.put({
      path: `/${docId}/_meta`,
      data: {
        vdoc: { pdf: { [pdfKey]: { _id: pdfId, filename: fKey } } },
        shared: "incoming",
      },
    });
    log.trace(
      "Wrote pdf vdoc reference into trellis document _meta for attachment %s",
      pdfKey,
    );

    attachmentPdfs.push({ attachmentKey: pdfKey, filename: fKey, pdfId });
  }

  // Now that the pdf is in place, drop the document to generate a target job
  await oada.put({
    path: `/${masterid}/shared/trellisfw/documents/${urlName}`,
    data: {
      [hashKey]: { _id: docId, _rev: 0 },
    },
    tree,
  });
  log.debug(
    `Created partial JSON in docs list: /${masterid}/shared/trellisfw/documents/${urlName}/${hashKey}`,
  );

  const primaryAttachmentKey = attachmentPdfs[0]?.attachmentKey;
  if (!primaryAttachmentKey) {
    throw new Error("No attachment PDFs were prepared while handling pending document");
  }

  const targetJobsByAttachment: Record<
    string,
    { _id?: string; filename: string; pdf: { _id: string }; status?: string; targetJobKey?: string }
  > = {};

  flSyncJobs.set(jobId, {
    ...flSyncJobs.get(jobId),
    expectedTargetJobCount: new Set(attachmentPdfs.map(({ attachmentKey }) => attachmentKey)).size,
    targetJobsByAttachment,
    targetJobsComplete: false,
  });

  for (const attachmentPdf of attachmentPdfs) {
    targetJobsByAttachment[attachmentPdf.attachmentKey] = {
      filename: attachmentPdf.filename,
      pdf: { _id: attachmentPdf.pdfId },
      status: "pending",
    };

    const targetJob = {
      service: "target",
      type: "transcription",
      "trading-partner": masterid,
      config: {
        type: "pdf",
        pdf: { _id: attachmentPdf.pdfId },
        document: { _id: docId },
        docKey: hashKey,
        attachmentKey: attachmentPdf.attachmentKey,
        attachmentFilename: attachmentPdf.filename,
        "document-type": docType || "unknown",
        "oada-doc-type": urlName,
      },
    };
    const targetJobRequest = new JobsRequest({
      oada: CONNECTION,
      job: targetJob,
    });
    log.debug(
      `[job ${docJob.oadaId}] Starting Target transcription job for attachment ${attachmentPdf.attachmentKey} (${attachmentPdf.filename}) pdf ${attachmentPdf.pdfId}`,
    );

    targetJobRequest.on(JobEventType.Status, async ({ job: jobChange }: any) => {
      const index = await jobChange;

      await handleAttachmentTargetStatus({
        targetJob: index as unknown as TargetJob,
        docJob: docJob as unknown as FlSyncJob,
        attachmentKey: attachmentPdf.attachmentKey,
        log,
      });
    });
    //  TargetJobRequest.on(JobEventType.Update, handleTargetUpdates)

    const { key: targetJobKey, _id: targetJobId } =
      await targetJobRequest.start();
    log.info(
      `[job ${docJob.oadaId}] Started Target transcription job ${targetJobId} for attachment ${attachmentPdf.attachmentKey}.`,
    );

    targetJobsByAttachment[attachmentPdf.attachmentKey] = {
      ...targetJobsByAttachment[attachmentPdf.attachmentKey],
      _id: targetJobId,
      filename: attachmentPdf.filename,
      pdf: { _id: attachmentPdf.pdfId },
      targetJobKey,
    };

    await postUpdate(
      CONNECTION,
      targetJobId,
      `Document attachment ${attachmentPdf.filename} posted to /${masterid}/shared/trellisfw/documents/${urlName}/${hashKey} (${docId}).`,
      "in-progress",
    );

    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
      data: {
        services: {
          target: {
            jobs: {
              [targetJobKey]: {
                _id: targetJobId,
                attachmentKey: attachmentPdf.attachmentKey,
                filename: attachmentPdf.filename,
                pdf: { _id: attachmentPdf.pdfId },
              },
            },
          },
        },
      },
    });

    log.debug(
      `[job ${docJob.oadaId}] Noted target job ${targetJobKey} for attachment ${attachmentPdf.attachmentKey} in FL mirror metadata`,
    );
  }

  // Add the target info to the in-memory job listing. Keep the singular fields
  // for existing finishDocument behavior until downstream multi-result handling exists.
  flSyncJobs.set(jobId, {
    ...flSyncJobs.get(jobId),
    targetJobKey: targetJobsByAttachment[primaryAttachmentKey]!.targetJobKey,
    targetJobId: targetJobsByAttachment[primaryAttachmentKey]!._id,
    targetJobsByAttachment,
  });
  await oada.put({
    path: `${jobId}`,
    data: {
      trellisDoc: {
        key: docId,
        listKey: hashKey,
        type: docType,
      },
    },
  });

  await CONNECTION.put({
    path: `/${jobId}/config/target-jobs`,
    data: targetJobsByAttachment,
  });
  log.debug(
    `[job ${docJob.oadaId}] Noted ${attachmentPdfs.length} target job(s) by attachment in fl-sync job ${jobId}`,
  );

  return type;
}

/**
 * Handles documents pending approval
 * @param job
 * @param oada
 */
export const handleDocumentJob: WorkerFunction = async (
  job: Job,
  { oada, jobId, log },
) => {
  const jobKey = jobId.replace(/^resources\//, "");
  let item: FlObject;
  const indexConfig = job.config as unknown as JobConfig;
  const { bid, key, masterid } = indexConfig;
  let flType: string;
  try {
    log.trace(
      "handleDocumentJob processing new document job resource[%s] doc [%s]",
      jobId,
      `${SERVICE_NAME}/businesses/${bid}/documents/${key}`,
    );

    const { data: itemData } = (await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}`,
    })) as { data: JsonObject };
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    item = itemData["food-logiq-mirror"] as unknown as FlObject;

    if (!item || !isObj(item)) throw new Error("Bad FlObject");

    if (!masterid) {
      const message = `Missing trading partner masterid for FoodLogiQ business [${bid}] document [${key}].`;
      log.error(`[job ${jobId}] ${message}`);
      await postUpdate(oada, jobId, message, "missing-masterid");
      throw new JobError(message, "missing-masterid");
    }

    // Save the document job
    return await new Promise(async (resolve, reject) => {
      flSyncJobs.set(jobId, {
        resolve,
        reject,
        "allow-rejection": indexConfig["allow-rejection"], // Also save this here
        itemId: item._id,
        job,
      });
      try {
        flType = await postTpDocument({
          bid,
          oada,
          item,
          masterid,
          jobKey,
          jobId,
          docJob: job,
          log,
        });
      } catch (cError: unknown) {
        log.error(cError, "postTpDocument Promise threw. Rejecting...");
        const { message, JobError } = cError as Error & {
          JobError?: string;
        };
        if (
          [multipleFilesErrorMessage, attachmentsErrorMessage].includes(message)
        ) {
          log.error(JobError, "error type");
          log.warn(
            `[job ${jobId}] Automatic rejection is disabled. Leaving FoodLogiQ document ${item!._id} unchanged.`,
          );
          // Now let it continue below and throw; no promise gets made, but the job is failed now
        }

        // If allowejection is false and it throws, the job will fail and leave
        // the document "suspended" for further review, which is fine
        reject(cError);
      }
    });
  } catch (cError: unknown) {
    log.error(cError, "handleDocumentJob errored");
    const { message, JobError } = cError as Error & {
      JobError?: string;
    };
    if (
      [multipleFilesErrorMessage, attachmentsErrorMessage].includes(message)
    ) {
      log.error(JobError, "error type");
      await oada.put({
        path: `/${jobId}`,
        data: {
          fl_data_validation: {
            status: false,
            message,
          },
        },
      });
      log.warn(
        `[job ${jobId}] Automatic rejection is disabled. Leaving FoodLogiQ document ${item!._id} unchanged.`,
      );
      // Now let it continue below and throw; no promise gets made, but the job is failed now
    }

    // If allow-rejection is false and it throws, the job will fail and leave
    // the document "suspended" for further review, which is fine
    throw cError;
  }
}; // HandleDocumentJob

async function finishDocument(
  docJobId: string,
  itemId: string,
  masterid: string,
  status: string,
  log: Logger,
) {
  if (status === "Approved") {
    log.debug(`Finishing doc: [${itemId}] with status [${status}] `);
    // Get the target job, result, and clean everything up
    // Get reference to corresponding pending scraped pdf

    const docJob = flSyncJobs.get(docJobId);
    if (!docJob) return;
    const { targetJobId } = docJob;

    const { data: targetJob } = (await CONNECTION.get({
      path: `/${targetJobId}`,
    })) as unknown as { data: TargetJob };
    const { result } = targetJob;

    let type = Object.keys(result || {})[0];
    // If (result && result.name && result.name === 'TimeoutError') {
    if (result && (result.name || result.code)) {
      type = undefined;
    }

    type ||= targetJob.config["oada-doc-type"];
    if (!type) {
      log.error("finishDoc could not determine doc type.");
      endJob(
        docJobId,
        log,
        new JobError("finishDoc could not determine doc type.", "other"),
      );
      return;
    }

    // Get the result key and _id to write links into approved docs list
    let key;
    let _id;
    if (result?.[type] && Object.keys(result[type]!).length > 0) {
      key = Object.keys(result[type]!)[0]!;
      _id = result[type]![key]!._id;
    }

    // Target didn't give us a result; just use the FL info
    if (!key && !_id) {
      if (docJob && docJob["allow-rejection"] === false) {
        key = targetJob.config.docKey;
        _id = targetJob.config.document._id;
      } else {
        // PDFs from already-approved things need to land in LF.
        log.error(
          "Target result was incomplete, perhaps due to a doc type mismatch",
        );
        endJob(
          docJobId,
          log,
          new JobError(
            "Target result was incomplete. Unable to call finishDoc",
            "target-invalid-result",
          ),
        );
        return;
      }
    }

    // Move approved docs to trading partner /bookmarks
    try {
      log.trace(
        `[job ${docJobId}] Moving approved document to [/${masterid}/bookmarks/trellisfw/documents/${type}/${key}]`,
      );
      await CONNECTION.ensure({
        path: `/${masterid}/bookmarks/trellisfw`,
        data: {},
        headers: {
          "Content-Type": "application/vnd.oada.trellisfw.1+json",
        },
      });
      await CONNECTION.ensure({
        path: `/${masterid}/bookmarks/trellisfw/documents`,
        data: {},
        headers: {
          "Content-Type": "application/vnd.trellisfw.documents.1+json",
        },
      });
      await CONNECTION.ensure({
        path: `/${masterid}/bookmarks/trellisfw/documents/${type}`,
        data: {},
        /*
        Headers: {
          'Content-Type': `application/vnd.trellisfw.${type}.1+json`,
        }
          */
      });
      await CONNECTION.delete({
        path: `/${masterid}/bookmarks/trellisfw/documents/${type}/${key}`,
      });
      await CONNECTION.put({
        path: `/${masterid}/bookmarks/trellisfw/documents/${type}/${key}`,
        data: { _id, _rev: 0 },
        /*
        Headers: {
          'Content-Type': `application/vnd.trellisfw.${type}.1+json`,
        }
          */
      });
      await CONNECTION.delete({
        path: `/${masterid}/shared/trellisfw/documents/${type}/${key}`,
      });

      await syncToLf(CONNECTION, masterid, _id, docJobId);
      log.trace("Laserfiche sync job completed");
    } catch (err: unknown) {
      log.error(err, `Error during move to bookmarks`);
      endJob(
        docJobId,
        log,
        new JobError(
          err instanceof Error ? err.message : "Laserfiche sync handoff failed",
          "lf-sync",
        ),
      );
      return;
    }

    endJob(docJobId, log);
  } else {
    // Don't do anything; the job was already failed at the previous step and just marked in FL as Rejected.
    log.trace(
      `[job ${docJobId}] Document [${itemId}] with status [${status}]. finishDoc skipping.`,
    );
  }
}

/**
 * Resolves flSyncJobs such that jobs get succeeded
 * @param {*} jobId - the _id of the job tied to the promise entry
 * @param {*} log - the
 * @return
 */
function endJob(
  jobId: string,
  log: Logger,
  message?: string | Error | JobError,
) {
  log.trace(`[job ${jobId}] Removing job from flSyncJobs Map`);
  // Trace(flSyncJobs, 'All flSyncJobs');
  const prom = flSyncJobs.get(jobId);
  if (prom) {
    if (message) {
      prom.reject(message);
    } else {
      prom.resolve(jobId);
    }
  } else {
    log.warn("Promise for flSyncJobs %s not found.", jobId);
  }

  flSyncJobs.delete(jobId);
}

/**
 * Builds assessment
 * @param {*} flId
 * @param {*} name
 * @param {*} bid
 * @param {*} result
 * @param {*} updateFlId
 * @returns
 */
async function constructCOIAssessment(
  flId: string,
  name: string,
  bid: string,
  bname: string,
  result: TrellisCOI,
  updateFlId?: string,
) {
  const policies = Object.values(result.policies);
  const cgl = (policies.find(
    (policy) =>
      typeof policy === "object" &&
      policy.type === "Commercial General Liability",
  ) ?? {}) as GeneralLiability;
  const general = Number.parseInt(String(cgl.each_occurrence) || "0", 10);
  const aggregate = Number.parseInt(String(cgl.general_aggregate) || "0", 10);
  const product = Number.parseInt(
    String(cgl["products_-_compop_agg"]) || "0",
    10,
  );

  const al = (policies.find(
    (policy) =>
      typeof policy === "object" && policy.type === "Automobile Liability",
  ) ?? {}) as AutoLiability;
  const auto = Number.parseInt(String(al.combined_single_limit) || "0", 10);

  const ul = (policies.find(
    (policy) =>
      typeof policy === "object" && policy.type === "Umbrella Liability",
  ) ?? {}) as UmbrellaLiability;
  const umbrella = Number.parseInt(String(ul.each_occurrence) || "0", 10);

  const wc = policies.find(
    (policy) =>
      typeof policy !== "string" && policy.type === `Worker's Compensation`,
  );
  const worker = Boolean(wc);

  const element = (policies.find(
    (policy) =>
      typeof policy === "object" &&
      policy.type === `Worker's Compensation Employee Liability`,
  ) ?? {}) as EmployersLiability;
  const employer = Number.parseInt(String(element.el_each_accident) || "0", 10);

  const assess = await spawnAssessment(bid, bname, {
    general,
    aggregate,
    auto,
    product,
    umbrella,
    employer,
    worker,
    updateFlId,
  });

  if (!updateFlId) {
    await linkAssessmentToDocument(
      CO_ID,
      {
        _id: assess._id,
        type: "assessment",
      },
      {
        _id: flId,
        name,
        type: "document",
      },
    );
  }

  return assess;
} // ConstructAssessment

/**
 * Gets the scraped JSON, perform document vs FL validation, and start an assessment
 * @param {*} targetJob
 */
async function handleScrapedResult(
  targetJob: TargetJob,
  flSyncJob: JsonObject,
  log: Logger,
) {
  try {
    // 1. Get the result content
    const docJobId = flSyncJob.oadaId as string;
    const { result: targetResult } = targetJob;

    // TODO: Handle multiple results
    const type = Object.keys(targetResult ?? {})[0];
    if (!type || !targetResult[type]) return;
    const key = Object.keys(targetResult[type] ?? {})[0];
    if (!key) return;
    const targetResultItem = targetResult?.[type] as JsonObject;
    if (
      type &&
      key &&
      targetResultItem?.[key] &&
      isObj(targetResultItem?.[key])
    ) {
      const targetRes = targetResultItem?.[key];
      log.trace(
        `[job ${docJobId}] Job result: [type: ${type}, key: ${key}, _id: ${targetRes?._id}]`,
      );
    }

    const { data: result } = (await CONNECTION.get({
      path: `/${targetJob._id}/result/${type}/${key}`,
    })) as unknown as { data: TrellisCOI };

    // 2. Get the fl-sync job
    const { config: configData } = flSyncJob;
    const {
      key: flId,
      name,
      bid,
      mirrorid,
      masterid,
      bname,
      status,
    } = configData as unknown as JobConfig;

    // 3. Fetch and validate the fl-mirror against the result
    const { data: flMirrorData } = (await CONNECTION.get({
      path: `/${mirrorid}`,
    })) as { data: JsonObject };
    if (!isObj(flMirrorData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    const flMirror = flMirrorData["food-logiq-mirror"] as unknown as FlObject;

    const validationResult = await validateResult(result, flMirror, type);

    log.trace(
      `[job ${docJobId}] Validation of pending document result:[${result._id}]: ${validationResult.status}`,
    );
    await CONNECTION.put({
      path: `/${docJobId}`,
      data: {
        validation: validationResult,
      } as any,
    });

    // 4a. Validation failed. Record it, but do not update FoodLogiQ status.
    if (!validationResult?.status) {
      await postUpdate(
        CONNECTION,
        docJobId,
        `Trellis-extracted PDF data does not match FoodLogiQ form data for FL Doc ${flId}: ${validationResult.message}`,
        "in-progress",
      );

      if (status === "Approved") {
        await finishDocument(docJobId, flId, masterid, "Approved", log);
        return;
      }

      endJob(
        docJobId,
        log,
        new JobError(validationResult?.message, "document-validation"),
      );
      return;
    }

    // 4b. Validation success. Generate the assessment and link things up.
    const flType = fromOadaType(type)!.name;
    if (flType && flTypes.has(flType) && flTypes.get(flType)!.assessments) {
      let assessmentId = await CONNECTION.get({
        path: `${docJobId}/assessments/${ASSESSMENT_TEMPLATE_ID}/id`,
      })
        .then((r) => r.data as string)
        .catch((error_) => {
          if (error_.status !== 404) throw error_;
          return undefined;
        });

      if (assessmentId) {
        log.trace(
          `[job ${docJobId}] Assessment with id [${assessmentId}] already exists for document _id [${flId}].`,
        );
        assessmentToFlId.set(assessmentId, {
          jobId: docJobId,
          mirrorid,
          flId,
        });
      } else {
        log.trace(
          `[job ${docJobId}] Assessment does not yet exist for document _id [${flId}]`,
        );
      }

      let assess;

      try {
        assess = await constructCOIAssessment(
          flId,
          name,
          bid,
          bname,
          result,
          assessmentId,
        );

        if (!assessmentId) {
          assessmentId = assess._id;
          assessmentToFlId.set(assessmentId as string, {
            jobId: docJobId,
            mirrorid,
            flId,
          });
        }
      } catch (cError: unknown) {
        // @ts-expect-error error bs
        if (cError.response.status === 422) {
          const { data: mirrorAssess } = (await CONNECTION.get({
            path: `${SERVICE_PATH}/businesses/${bid}/assessments/${assessmentId}`,
          })) as { data: JsonObject };
          const { state } = mirrorAssess[
            "food-logiq-mirror"
          ] as unknown as FlObject;
          log.trace(
            `[job ${docJobId}] Assessment ${assessmentId} - bid: ${bid}; state: ${state}. Could not be modified.`,
          );

          // TODO:This is maybe a problem causing cyclical re-runs of assessments?
          // I think this was originally added because some very old assessments couldn't be modified
          // because they were in an approved/rejected state which cannot be changed. Reposting the assessment
          // to OADA just simulates that the assessment just showed up like that.
          //
          // This is now problematic because 422s are happening on some other assessments
          // and then getting re-dropped over and over
          //
          await setTimeout(2000); // Simulate the re-mirroring of the assessment
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${bid}/assessments/${assessmentId}`,
            data: {
              "food-logiq-mirror": mirrorAssess["food-logiq-mirror"],
            },
          });
        } else throw cError;
      }

      log.trace(
        `[job ${docJobId}] Spawned assessment [${assessmentId}] for business id [${bid}]`,
      );
      await postUpdate(
        CONNECTION,
        docJobId,
        `Assessment spawned with id ${assessmentId} and linked into job /${docJobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        "in-progress",
      );

      if (assessmentId) {
        await CONNECTION.put({
          path: `/${docJobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          data: { id: assessmentId } as any,
        });
      }
    } else {
      log.trace(
        `[job ${docJobId}] Skipping assessment for result of type [${flType}] [${type}].`,
      );
      await postUpdate(
        CONNECTION,
        docJobId,
        `Document validation completed. No assessment required for ${flType}.`,
        "in-progress",
      );

      if (status === "Approved") {
        await finishDocument(docJobId, flId, masterid, "Approved", log);
        return;
      }

      endJob(docJobId, log);
    }
  } catch (cError: unknown) {
    log.error(cError);
    throw cError as Error;
  }
} // HandleScrapedResult

function isFLItem(item: unknown) {
  return isObj(item) && isObj(item["food-logiq-mirror"]);
}

export async function startJobCreator(oada: OADAClient, log: Logger) {
  try {
    setConnection(oada);
    await CONNECTION.get({
      path: `${SERVICE_PATH}`,
    }).catch(async (cError) => {
      if (cError.status === 404) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}`,
          data: {},
          tree,
        });
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses`,
          data: {},
          tree,
        });
        return {};
      }

      throw cError as Error;
    });

    log.trace(`Path: ${SERVICE_PATH}/businesses`);

    const docsWatch = new ListWatch({
      conn: CONNECTION,
      itemsPath: "$.*.documents.*",
      name: "document-mirrored",
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
      onNewList: AssumeState.Handled,
    });

    docsWatch.on(ChangeType.ItemAdded, async ({item, pointer}) => {
      const it = (await item) as JsonObject;
      if (it['food-logiq-mirror']) {
        log.trace(`ListWatch ItemAdded triggered document queue for ${pointer}`);
        queueDocumentJob(it, pointer, log);
      }
    });

    docsWatch.on(ChangeType.ItemChanged, async ({ item, pointer }) => {
      const it = (await item) as JsonObject;
      if (it["food-logiq-mirror"]) {
        log.trace(`ListWatch ItemChanged triggered document queue for ${pointer}`);
        queueDocumentJob(it, pointer, log);
      }
    });

    const assessWatch = new ListWatch({
      conn: CONNECTION,
      itemsPath: "$.*.assessments.*",
      name: "assessment-mirrored",
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
      onNewList: AssumeState.Handled,
    });
    /* TODO: see above watch on documents and fix similarly later
    assessWatch.on(ChangeType.ItemAdded, async ({item, pointer}) => {
      let it = (await item) as JsonObject;
      if (it['food-logiq-mirror']) {
        queueAssessmentJob(it, pointer);
      }
    });
    */
    assessWatch.on(
      ChangeType.ItemChanged,
      async ({ item, pointer }) => {
        const it = (await item) as JsonObject;
        if (it["food-logiq-mirror"]) {
          queueAssessmentJob(it, pointer, log);
        }
      },
    );
  } catch (cError: unknown) {
    log.error(cError);
    throw cError as Error;
  }
} // StartJobCreator

async function queueAssessmentJob(
  change: JsonObject,
  path: string,
  log: Logger,
) {
  try {
    // 1. Gather fl indexing, mirror data, fl document lookup, etc.
    log.debug("queueAssessmentJob processing mirror change");
    const pieces = pointer.parse(path);
    const [bid, , key] = pieces;

    if (!key) {
      throw new TypeError(`Error parsing path: ${path}`);
    }

    const { data: itemData } = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
    });
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    const item = itemData["food-logiq-mirror"] as unknown as FlObject;

    // Skip when there is no associated document job.
    // This may happen on startup with lots of assessments already sitting there.
    if (!assessmentToFlId.has(key)) {
      log.trace(
        `No associated fl-sync document job could be found for assessment: ${item._id}`,
      );
      return;
    }

    const { jobId: docJobId } = assessmentToFlId.get(key)!;

    const { job: docJob } = flSyncJobs.get(docJobId);

    const indexConfig = docJob.config as unknown as JobConfig;

    if (!isObj(indexConfig)) {
      throw new Error("Unexpected job config data");
    }

    const { key: flDocumentId, type: flDocumentType, masterid } = indexConfig;
    if (!flDocumentType) {
      log.trace(
        `[job ${docJobId}] Assessment [${item._id}] could not find fl doc type prior to queueing. Ignoring.`,
      );
      return;
    }

    const assessmentType = item?.assessmentTemplate?.name;
    const docs = flTypes.get(flDocumentType);
    if (!assessmentType || !docs) {
      log.trace(
        `[job ${docJobId}] Assessment type of [${item._id}] was of type [${assessmentType}]. Ignoring.`,
      );
      return;
    }

    if (
      !docs.assessments ||
      !Object.keys(docs.assessments).includes(assessmentType)
    ) {
      log.trace(
        `[job ${docJobId}] Assessment [${item._id}] was of type [${assessmentType}]. Ignoring.`,
      );
      return;
    }

    const status = item.state;
    const approvalUser = item?.lastUpdate?.userId;
    const usersEqual =
      approvalUser === FL_TRELLIS_USER ||
      approvalUser === APPROVAL_TRELLIS_USER;
    log.trace(
      `[job ${docJobId}] approvalInfo user ${
        usersEqual
          ? "matches our user"
          : `[${approvalUser}] does not match our users: [${FL_TRELLIS_USER} or ${APPROVAL_TRELLIS_USER}]`
      }`,
    );

    switch (status) {
      case "Submitted": {
        // 2a. Create assessment job, and link it into jobs list and fl document job reference
        const { headers } = await CONNECTION.post({
          path: "/resources",
          contentType: "application/vnd.oada.job.1+json",
          data: {
            type: "assessment-mirrored",
            service: SERVICE_NAME,
            config: {
              "fl-sync-type": "assessment",
              type: assessmentType,
              key,
              bid,
              rev: indexConfig._rev,
              flDocId: flDocumentId,
              flDocType: flDocumentType,
              flDocJobId: docJobId,
              assessmentType: {
                id: item?.assessmentTemplate._id,
                name: item?.assessmentTemplate.name,
              },
            },
          },
        });
        const jobkey =
          headers["content-location"]?.replace(/^\/resources\//, "") ?? "";

        await CONNECTION.put({
          path: pending,
          tree,
          data: {
            [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
          },
        });
        log.trace(
          `[job ${docJobId}] Posted job [assessment] at /resources/${jobkey}`,
        );

        // Add it to the parent fl-sync job
        await CONNECTION.put({
          path: `/${docJobId}/assessment-jobs`,
          data: {
            [jobkey]: {
              _id: `resources/${jobkey}`,
            },
          },
        });

        break;
      }

      case "Approved": {
        // Approved (by anyone). Clean up and remove after approval
        endJob(item._id, log);
        assessmentToFlId.delete(item._id);
        // TODO: remove this when/if FL is able to retrieve changes after approval updates
        await finishDocument(docJobId, flDocumentId, masterid, status, log);

        break;
      }

      case "Rejected": {
        // 2b. Notify, clean up, and remove after rejection
        const reasons = `${docJob?.["fail-reasons"]}`;

        const message = `A supplier Assessment associated with this document has been rejected for the following reasons: ${reasons}.`;
        // Reject the assessment job;
        endJob(item._id, log, message);
        assessmentToFlId.delete(item._id);
        log.trace(`[job ${docJobId}] REASONS: ${reasons}`);

        // Reject the FL Document with a supplier message and reject the doc job
        if (flSyncJobs.get(docJobId)["allow-rejection"] === false) {
          log.warn(
            `[job ${docJobId}] Assessment ${item._id} failed logic, but cannot override approval. Calling finishDoc.`,
          );
          // TODO: remove this when/if FL is able to retrieve changes after approval updates
          await finishDocument(
            docJobId,
            flDocumentId,
            masterid,
            "Approved",
            log,
          );
        } else {
          endJob(
            docJobId,
            log,
            new JobError(message, "associated-assessment-rejected"),
          );
          // TODO: remove this when/if FL is able to retrieve changes after approval updates
          await finishDocument(docJobId, flDocumentId, masterid, status, log);
        }

        break;
      }

      default: {
        // 2c. Job not handled by trellis system.
        const message = `Assessment not pending, approval status not set by Trellis. Skipping. Assessment: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
        log.trace(`[job ${docJobId}] ${message}`);
      }
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      "queueAssessmentJob Failed",
      change.resource_id,
    );
  }
} // QueueAssessmentJob

export async function postJob(
  oada: OADAClient,
  indexConfig: JobConfig,
  flStatus: string,
  log: Logger,
) {
  const { headers } = await oada.post({
    path: "/resources",
    contentType: "application/vnd.oada.job.1+json",
    data: {
      type: "document-mirrored",
      service: SERVICE_NAME,
      config: indexConfig,
      "foodlogiq-result-status": flStatus,
    } as any,
  });
  const jobkey = headers["content-location"]!.replace(/^\/resources\//, "");

  await cancelDocJobs(indexConfig.key, log, jobkey);
  const _id = `resources/${jobkey}`;
  await oada.put({
    path: pending,
    tree,
    data: {
      [jobkey]: { _id, _rev: 0 },
    },
  });

  // Store the job in the meta of the fl document
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${indexConfig.bid}/documents/${indexConfig.key}/_meta`,
    data: {
      services: {
        "fl-sync": {
          jobs: {
            [jobkey]: { _id },
          },
        },
      },
    },
  });

  log.trace(`[job ${_id}] Posted job [document] at /${_id}`);
  return _id;
}

async function cancelDocJobs(itemId: string, log: Logger, newJobKey?: string) {
  // Find and ignore other jobs with the same item._id
  const flSyncJobMatches = Array.from(flSyncJobs.entries()).filter(
    ([_, v]) => v.itemId === itemId,
  );
  for await (const [jobId, _] of flSyncJobMatches) {
    const message = `Job was interrupted by an update to this FL doc${newJobKey ? ` resulting in a new job [resources/${newJobKey}]` : ""}. Cancelling this job.`;
    await postUpdate(CONNECTION, jobId, message, "in-progress");
    // TODO: Should this be considered job success or failure?
    await endJob(jobId, log, new JobError(message, "job-cancelled"));
  }
}

async function queueDocumentJob(
  fullData: JsonObject,
  path: string,
  log: Logger,
) {
  try {
    // 1. Gather fl indexing, mirror data, and trellis master id
    log.trace("queueDocumentJob processing mirror change");
    const pieces = pointer.parse(path);
    const [bid /* type */, , key] = pieces;

    const item = fullData["food-logiq-mirror"] as unknown as FlObject;

    if (item.shareSource.isDeleted) {
      log.trace(
        `Document [${item._id}] was deleted by the supplier. Skipping.`,
      );
      return;
    }

    const documentType = pointer.has(item, "/shareSource/type/name")
      ? pointer.get(item, "/shareSource/type/name")
      : undefined;
    const status = item?.shareSource?.approvalInfo?.status;
    if (!documentType) {
      log.trace(
        `Document [${item._id}] did not have a document type. Ignoring.`,
      );
      return;
    }

    if (!flTypes.has(documentType) && status !== "Approved") {
      log.trace(
        `Document [${item._id}] was of unsupported type [${documentType}] and status [${status}]. Ignoring.`,
      );
      return;
    }

    if (!flTypes.has(documentType)) {
      log.warn(
        `Approved document [${item._id}] was of unsupported type [${documentType}]. Queueing as unidentified so it can continue to Laserfiche.`,
      );
    }

    const { data: bus } = (await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`,
    })) as { data: JsonObject };

    let masterid;
    if (!bus) log.warn(`No trading partner found for business ${bid}.`);
    if (bus["food-logiq-mirror"]) {
      const { result } = (await doJob(CONNECTION, {
        service: SERVICE_NAME,
        type: "business-lookup",
        config: {
          "fl-business": bus["food-logiq-mirror"],
          link: `https://connect.foodlogiq.com/businesses/${CO_ID}/suppliers/detail/${item._id}/${COMMUNITY_ID}`,
        },
      })) as unknown as { result: { masterid: string } };
      masterid = result?.masterid;
    }

    if (masterid) {
      log.trace(
        `Found trading partner masterid [${masterid}] for FL business ${bid}`,
      );
    }

    const approvalUser = item?.shareSource?.approvalInfo?.setBy?._id;
    log.trace(
      `approvalInfo user: ${approvalUser} (${
        approvalUser === FL_TRELLIS_USER ||
        approvalUser === APPROVAL_TRELLIS_USER
          ? "Was us."
          : "Was NOT us"
      }). Status: ${status}. id: ${item._id}`,
    );

    // Accept all supplier drafts as we had previously while changing the doc
    // status back to Awaiting Approval.
    if (item.shareSource?.draftVersionId && status !== "Awaiting Approval") {
      log.trace(
        `Document [${item._id}] has a supplier update. Setting status to 'Awaiting Approval'.`,
      );
      await foodLogiqWriteback(
        `document ${item.shareSource.draftVersionId} status reset to Awaiting Approval`,
        `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item.shareSource.draftVersionId}/approvalStatus`,
        {
          method: "put",
          headers: { Authorization: FL_TOKEN },
          body: JSON.stringify({
            status: "Awaiting Approval",
            visibleForSupplier: false,
            comment: "",
          }),
        },
        log,
      );
      return;
    }

    const jobConfig: JobConfig = {
      status,
      "fl-sync-type": "document",
      type: documentType,
      key: key!,
      date: item.versionInfo.createdAt,
      bid: bid!,
      _rev: fullData._rev as number,
      masterid: masterid ?? "",
      mirrorid: fullData._id as string,
      bname: item.shareSource.sourceBusiness.name,
      name: item.name,
      link: `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${item._id}`,
    };

    if (!masterid) {
      log.error(
        `Missing trading partner masterid for FoodLogiQ business [${bid}] document [${item._id}]. Queueing diagnostic document-mirrored job.`,
      );
      await postJob(CONNECTION, jobConfig, status, log);
      return;
    }

    if (status === "Awaiting Approval") {
      // A. Create new job and link into jobs list and fl doc meta
      await postJob(CONNECTION, jobConfig, "Awaiting Approval", log);
    } else if (
      approvalUser === FL_TRELLIS_USER ||
      approvalUser === APPROVAL_TRELLIS_USER
    ) {
      log.trace(
        `Document ${item._id} approvalUser was Trellis. Calling finishDoc`,
      );
      // B. Approved or rejected by us. Finish up the automation
      // TODO There really shouldn't be multiple jobs here for a given item._id,
      // but in such an event, finish all of them.
      const flSyncJobMatches = Array.from(flSyncJobs.entries()).filter(
        ([_, v]) => v.itemId === item._id,
      );
      if (flSyncJobMatches.length === 0 && status === "Approved") {
        log.warn(
          `Approved document ${item._id} had no active document-mirrored job. Queueing approved reprocess job.`,
        );
        jobConfig["allow-rejection"] = false;
        await postJob(CONNECTION, jobConfig, status, log);
        return;
      }

      for await (const [docJobId, docJob] of flSyncJobMatches) {
        await finishDocument(docJobId, item._id, masterid, status, log);
      }
      // C. Document handled by others
    } else if (status === "Approved") {
      log.debug(
        `Already approved document[${item._id}]; bid[${bid}]; ApprovalUser was not us. Reprocessing and ushering through.`,
      );
      // Run it through target and move it to trading-partner /bookmarks
      jobConfig["allow-rejection"] = false;
      await postJob(CONNECTION, jobConfig, status, log);
    } else {
      log.warn(
        `Document ${item._id} approvalUser was not us. status !== Approved. Skipping. Killing any running jobs.`,
      );
      await cancelDocJobs(item._id, log);
    }
  } catch (cError: unknown) {
    throw oError.tag(cError as Error, "queueDocumentJob Failed", fullData._id);
  }
}

export async function queueMirroredDocumentJob(
  conn: OADAClient,
  fullData: JsonObject,
  path: string,
  log: Logger,
) {
  setConnection(conn);
  await queueDocumentJob(fullData, path, log);
}

export function isObj(thing: any): thing is JsonObject {
  return (
    typeof thing === "object" &&
    !Buffer.isBuffer(thing) &&
    !Array.isArray(thing)
  );
}

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

async function syncToLf(
  oada: OADAClient,
  tradingPartner: string,
  doc: string,
  docJobId: string,
) {
  const lfJob = {
    service: "lf-sync",
    type: "sync-doc",
    config: {
      tradingPartner,
      doc: {
        _id: doc,
      },
    },
  };
  const request = new JobsRequest({ oada, job: lfJob });
  let lfJobId = "";

  const completed = new Promise<TargetJob>((resolve, reject) => {
    request.on(JobEventType.Status, async ({ job: jobChange }: any) => {
      const index = (await jobChange) as TargetJob;
      if (index.status === "success") {
        resolve(index);
        return;
      }

      if (index.status === "failure") {
        const resultMessage = index.result?.message;
        const message =
          typeof resultMessage === "string"
            ? resultMessage
            : `lf-sync job ${index._id ?? lfJobId} failed without a message`;
        const error = new Error(message) as Error & { lfSyncJobId?: string };
        error.lfSyncJobId = index._id ?? lfJobId;
        reject(error);
      }
    });
  });

  const { _id } = await request.start();
  lfJobId = _id;
  await CONNECTION.put({
    path: `/${docJobId}`,
    data: {
      lfSyncJob: { _id: lfJobId },
    },
  });
  return completed;
}

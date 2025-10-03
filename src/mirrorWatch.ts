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
import '@oada/pino-debug';
import { AssumeState, ChangeType, ListWatch } from '@oada/list-lib';
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
} from './types.js';
import {
  type Job,
  JobError,
  type WorkerFunction,
  postUpdate,
} from '@oada/jobs';
import { JobEventType, JobsRequest, doJob } from '@oada/client/jobs';
import type { JsonObject, OADAClient } from '@oada/client';
import { flToTrellis, fromOadaType } from './conversions.js';
import { linkAssessmentToDocument, spawnAssessment } from './assessments.js';
import checkAssessment from './checkAssessments.js';
import config from './config.js';
import crypto from 'node:crypto';
import { getAutoApprove } from './index.js';
import JSZip from 'jszip';
import { type Logger } from '@oada/pino-debug';
import md5 from 'md5';
import mirrorTree from './tree.mirrorWatch.js';
import oError from '@overleaf/o-error';
import pointer from 'json-pointer';
import { setTimeout } from 'node:timers/promises';
import tree from './tree.js';
import { validateResult } from './docTypeValidation.js';

const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const FL_TRELLIS_USER = config.get('foodlogiq.trellisUser');
const APPROVAL_TRELLIS_USER = config.get('foodlogiq.capaTrellisUser');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');

const SERVICE_NAME = config.get('service.name');
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const pending = `${SERVICE_PATH}/jobs/pending`;
const assessmentToFlId = new Map<
  string,
  { jobId: string; mirrorid: string; flId: string; assessmentJobId?: string }
>();
const targetErrors = {
  'target-multiple-docs-combined': {
    patterns: [/this is a multi-.* file/i],
    reject: false,
    jobError: 'target-multiple-docs-combined',
  },
  'target-validation': {
    patterns: [/(validation|valiadation) failed/i],
    reject: true,
    jobError: 'target-validation',
  },
  'target-unrecognized': {
    patterns: [
      /file format was not recognized/i,
      /^file is not a textual pdf/i,
    ],
    reject: false,
    jobError: 'target-unrecognized',
  },
};

const multipleFilesErrorMessage =
  'Multiple files attached. Please upload a single PDF per Food LogiQ document.';
const attachmentsErrorMessage = 'Failed to retreive attachments';

// Let targetErrorTypes = {"multi-COI": "multi-coi"}
const flSyncJobs = new Map(); // Map of fl-sync jobs
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

if (SERVICE_NAME && mirrorTree?.bookmarks?.services?.['fl-sync']) {
  mirrorTree.bookmarks.services[SERVICE_NAME] =
    mirrorTree.bookmarks.services['fl-sync'];
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
  '100g Nutritional Information': { assessments: false },
  //  'ACH Form': { assessments: false },
  'APHIS Statement': { assessments: false },
  'Allergen Statement': { assessments: false },
  'Animal Welfare Audit': { assessments: false },
  'Animal Welfare Corrective Actions': { assessments: false },
  'Bioengineered (BE) Ingredient Statement': { assessments: false },
  'Bisphenol A (BPA) Statement': { assessments: false },
  'Business License': { assessments: false },
  'COA': { assessments: false },
  'California Prop 65 Statement': { assessments: false },
  /*'Certificate of Insurance': {
    assessments: {
      'Certificate of Insurance (COI) Requirements': ASSESSMENT_TEMPLATE_ID,
    },
  },
  */
  'Co-Pack Confidentiality Agreement Form': { assessments: false },
  'Co-Packer FSQA Questionnaire (GFSI Certified)': { assessments: false },
  'Co-Packer FSQA Questionnaire (Non-GFSI Certified)': { assessments: false },
  'Country of Origin Statement': { assessments: false },
  'E.Coli 0157:H7 Intervention Audit': { assessments: false },
  'E.Coli 0157:H7 Intervention Statement': { assessments: false },
  'Foreign Material Control Plan': { assessments: false },
  'GFSI Audit': { assessments: false },
  'GFSI Certificate': { assessments: false },
  'Gluten Statement': { assessments: false },
  'HACCP Plan / Flow Chart': { assessments: false },
  'Humane Harvest Statement': { assessments: false },
  'Ingredient Breakdown Range %': { assessments: false },
  'Lot Code Explanation': { assessments: false },
  'Master Service Agreement (MSA)': { assessments: false },
  'National Residue Program (NRP) Statement': { assessments: false },
  'Natural Statement': { assessments: false },
  'Non-Ambulatory (3D/4D) Animal Statement': { assessments: false },
  'Product Label': { assessments: false },
  'Product Specification': { assessments: false },
  'Pure Food Guaranty and Indemnification Agreement (LOG)': {
    assessments: false,
  },
  'Rate Sheet': { assessments: false },
  'Safety Data Sheet (SDS)': { assessments: false },
  //  'Small Business Administration (SBA) Form': { assessments: false },
  'Specified Risk Materials (SRM) Audit': { assessments: false },
  'Specified Risk Materials (SRM) Audit Corrective Actions': {
    assessments: false,
  },
  'Specified Risk Materials (SRM) Statement': { assessments: false },
  'Third Party Food Safety GMP Audit': { assessments: false },
  'Third Party Food Safety GMP Audit Corrective Actions': {
    assessments: false,
  },
  'Third Party Food Safety GMP Certificate': { assessments: false },
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
  if (docJob && docJob.config['allow-rejection'] === false) {
    log.info(
      `[job ${docJobId}] Target finished with status ${status} on already-approved doc.`,
    );
    if (status === 'success') {
      // If successful, skip the potential pitfalls of assessment creation and call finishDoc.
      await postUpdate(
        CONNECTION,
        docJobId,
        'Target extraction completed. Handling result...',
        'in-progress',
      );
      return finishDocument(docJobId, key, masterid, 'Approved', log);
    }

    if (status === 'failure') {
      // If failure, target can't extract it so we're stuck without a result. Fail the job
      // and call finishDoc.

      // TODO: Configure whether or not to continue to usher things through to
      // LF-Sync
      await postUpdate(
        CONNECTION,
        docJobId,
        'Target extraction failed',
        'in-progress',
      );
      // TODO: Probably shouldn't be ending the job in failure here. I'd say if we
      // are calling finish job as approved, its a success (despite issues)
      return finishDocument(docJobId, key, masterid, 'Approved', log);
    }
  }

  if (status === 'success') {
    await postUpdate(
      CONNECTION,
      docJobId,
      'Target extraction completed. Handling result...',
      'in-progress',
    );
    await handleScrapedResult(targetJob, docJob as unknown as JsonObject, log);
  } else if (status === 'failure') {
    await postUpdate(
      CONNECTION,
      docJobId,
      'Target extraction failed',
      'in-progress',
    );

    let jobError;
    let errorMessage = 'Other Target failure';
    // Target failed and we have "updates". Otherwise, no "updates"; make it work.
    if (isObj(targetJob) && targetJob.updates) {
      // 1. Find the update with the error message
      const errorObject = Object.values(targetJob.updates).find(
        (object) => object.status === 'error',
      );
      if (errorObject) errorMessage = errorObject.information;
      // 2. Determine whether to reject the document based on target error type; others we'll need to review
      // 3. Determine error indexing within fl-sync
      if (errorObject && typeof errorMessage === 'string') {
        let reject = false;
        for (const tError of Object.values(targetErrors)) {
          if (tError.patterns.some((p) => p.test(errorMessage))) {
            jobError = tError.jobError;
            reject = tError.reject;
          }
        }

        log.info(
          `[job ${docJobId}] Target job ${targetJob._id} errored. reject: ${reject}; fl-sync job error ${jobError}`,
        );

        // @ts-expect-error
        if (reject && rejectable[indexConfig.type])
          await rejectFlDocument(
            docJob.config.key,
            docJobId,
            log,
            errorMessage,
          );
        if (jobError)
          endJob(docJobId, log, new JobError(errorMessage, jobError));
      }
    }

    if (!jobError)
      endJob(docJobId, log, new JobError(errorMessage, 'target-other'));
  }
}

/**
 * Approves fl document associated with an assessment
 * @param {*} docId
 */
async function approveFlDocument(
  documentId: string,
  jobId: string,
  log: Logger,
) {
  log.info(`[job ${jobId}] Approving associated FL Doc ${documentId}`);
  try {
    await fetch(
      `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/approvalStatus`,
      {
        method: 'put',
        headers: { Authorization: FL_TOKEN },
        body: JSON.stringify({
          status: 'Approved',
          comment: '',
          visibleForSupplier: false,
        }),
      },
    );
  } catch (error_: unknown) {
    throw new Error('Approval request failed', { cause: error_ });
  }

  await CONNECTION.put({
    path: `/${jobId}`,
    data: { 'foodlogiq-result-status': 'Approved' },
  });
} // ApproveFlDoc

/**
 * handles queued assessment-type jobs.
 * Assessments should be treated as separate from the documents as much as possible.
 */
export const handleAssessmentJob: WorkerFunction = async (
  job: any,
  { oada, jobId, log },
) => {
  const jobKey = jobId.replace(/^resources\//, '');
  try {
    const { bid, key, flDocJobId: docJobId } = job.config;
    // Is this recommended?
    //log = log.child({ document: key })
    log.info(`[job ${docJobId}] Handling incoming Assessment job ${jobKey}`);
    const { data: itemData } = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
    });
    if (!isObj(itemData)) {
      throw new TypeError(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    // eslint-disable-next-line sonarjs/no-duplicate-string
    const item = itemData['food-logiq-mirror'] as unknown as FlAssessment;

    if (!item || !isObj(item)) return {};
    if (!item._id || !assessmentToFlId.has(item._id)) {
      throw new Error(`assessmentToFlId does not exist for _id ${item._id}`);
    }

    // 1. Create a job entry for the assessment
    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}/_meta`,
      data: {
        services: {
          'fl-sync': {
            jobs: {
              [jobKey]: { _id: jobId }, // Assessment
            },
          },
        },
      },
    });

    const aaa = getAutoApprove();
    log.info(
      `[job ${docJobId}] Autoapprove Assessments Configuration: [${aaa}]`,
    );
    if (aaa) {
      const { failed, reasons }: { failed: boolean; reasons: string[] } =
        checkAssessment(item);
      item.state = failed ? 'Rejected' : 'Approved';
      await CONNECTION.put({
        path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        data: {
          approval: !failed,
        },
      });
      log.info(
        `[job ${docJobId}] Assessment Auto-${item.state}. [${item._id}]`,
      );
      await fetch(
        `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${
          item._id
        }/${failed ? 'reject' : 'approve'}spawnedassessment`,
        {
          method: 'put',
          headers: { Authorization: FL_TOKEN },
          body: JSON.stringify(item),
        },
      );
      log.info(`[job ${docJobId}] Assessment Reasons: ${reasons.join(';')}`);

      const docJob = assessmentToFlId.get(item._id);
      if (docJob && failed) {
        await CONNECTION.put({
          path: `/${docJob.jobId}`,
          data: {
            'fail-reasons': reasons.join(';'),
          },
        });
      }

      await postUpdate(
        CONNECTION,
        jobId,
        {},
        `Assessment auto-${item.state}. [${item._id}] ${
          failed ? `for these reasons: ${reasons.join(';')}` : ''
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
      log.info('Saved assessmentjob');
    });
  } catch (error_) {
    log.error('Error handleAssessmentJob', error_);
    throw error_;
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
  log.info(`postTpDocument: bid:${bid} item:${item._id}`);
  const type = item?.shareSource?.type?.name;

  // 1. Retrieve the attachments and unzip
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
    {
      method: 'get',
      headers: { Authorization: FL_TOKEN },
    },
  ).catch((error_) => {
    if (error_.response?.status === 404) {
      log.info(`Bad attachments on item ${item._id}. Throwing JobError`);
      throw new JobError(attachmentsErrorMessage, 'bad-fl-attachments');
    } else throw error_;
  });
  const zipFile = await response.arrayBuffer();

  log.trace(`Got attachments for FL mirror ${item._id}`);

  const zip = await new JSZip().loadAsync(zipFile);

  const files = Object.keys(zip.files);

  if (files.length !== 1 && noMultiFile.has(type)) {
    log.info(`Multiple files not allowed for doc type ${type}`);
    throw new JobError(multipleFilesErrorMessage, 'multi-files-attached');
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
    docId = r.headers['content-location']!.replace(/^\//, '');
    log.trace(
      `Doc for hashKey ${hashKey} already exists. Partial JSON lives at /${docId}`,
    );
  } catch (error_: unknown) {
    // @ts-expect-error error nonsense
    if (error_?.status !== 404) {
      throw error_;
    }

    const r = await oada.post({
      path: `/resources`,
      data: document,
      contentType: docType,
    });
    docId = r.headers['content-location']!.replace(/^\//, '');
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
  log.trace('Retrieved mirrorId %s', mirrorId);

  // Errors up above for multiple files, so just take the first one here.
  const fKey = files[0];
  if (!fKey)
    throw new Error(
      `Failed to acquire file key while handling pending document`,
    );

  // Prepare the pdf resource
  const ab = await zip.file(fKey)!.async('uint8array');
  const zData = Buffer.alloc(ab.byteLength).map((_, index) => ab[index]!);
  const pdfKey = crypto.createHash('sha256').update(zData).digest('hex');
  const pdfId = `resources/${pdfKey}-pdf`;

  try {
    await oada.put({
      path: `/${pdfId}`,
      data: zData,
      contentType: 'application/pdf',
    });
    await oada.put({
      path: `/${pdfId}/_meta`,
      data: { filename: fKey },
      contentType: 'application/json',
    });
    log.trace(`Wrote file [${fKey}] to pdfId ${pdfId}.`);
  } catch (cError: unknown) {
    throw Buffer.byteLength(zData) === 0
      ? new JobError(
          `Attachment Buffer data 'zData' was empty.`,
          'bad-fl-attachments',
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
        'fl-sync': {
          jobs: {
            [jobKey]: { _id: jobId },
          },
        },
      },
    } as any,
    contentType: 'application/json',
  });
  log.trace(
    'Wrote FL mirror (%s) and fl-sync job (%s) references to _meta of pdf resource %s',
    mirrorId,
    jobId,
    pdfId,
  );

  await oada.put({
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
    data: {
      vdoc: {
        pdf: {
          [pdfKey]: { _id: pdfId },
        },
      },
    },
    contentType: docType,
  });
  log.trace(
    'Wrote pdf vdoc reference into FL mirror _meta for attachment %s',
    pdfKey,
  );

  await oada.put({
    path: `/${docId}/_meta`,
    data: {
      vdoc: { pdf: { [pdfKey]: { _id: pdfId } } },
      shared: 'incoming',
    },
  });
  log.trace(
    'Wrote pdf vdoc reference into trellis document _meta for attachment %s',
    pdfKey,
  );

  // Now that the pdf is in place, drop the document to generate a target job
  await oada.put({
    path: `/${masterid}/shared/trellisfw/documents/${urlName}`,
    data: {
      [hashKey]: { _id: docId, _rev: 0 },
    },
    tree,
  });
  log.info(
    `Created partial JSON in docs list: /${masterid}/shared/trellisfw/documents/${urlName}/${hashKey}`,
  );

  const targetJob = {
    'service': 'target',
    'type': 'transcription',
    'trading-partner': masterid,
    'config': {
      'type': 'pdf',
      'pdf': { _id: pdfId },
      'document': { _id: docId },
      'docKey': hashKey,
      'document-type': docType || 'unknown',
      'oada-doc-type': urlName,
    },
  };
  const targetJobRequest = new JobsRequest({
    oada: CONNECTION,
    job: targetJob,
  });

  targetJobRequest.on(JobEventType.Status, async ({ job: jobChange }: any) => {
    const index = await jobChange;

    // Handle final statuses
    await handleTargetStatus(
      index as unknown as TargetJob,
      docJob as unknown as FlSyncJob,
      log,
    );
  });
  //  TargetJobRequest.on(JobEventType.Update, handleTargetUpdates)

  const { key: targetJobKey, _id: targetJobId } =
    await targetJobRequest.start();
  // Add the target info to the in-memory job listing

  flSyncJobs.set(jobId, {
    ...flSyncJobs.get(jobId),
    targetJobKey,
    targetJobId,
  });

  await postUpdate(
    CONNECTION,
    targetJobId,
    `Document posted to /${masterid}/shared/trellisfw/documents/${urlName}/${hashKey} (${docId}).`,
    'in-progress',
  );
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
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
    data: {
      services: {
        target: {
          jobs: {
            [targetJobKey]: { _id: targetJobId },
          },
        },
      },
    },
  });

  await CONNECTION.put({
    path: `/${jobId}/config/target-jobs`,
    data: {
      [targetJobKey]: { _id: targetJobId },
    },
  });
  log.info(
    `[job ${docJob.oadaId}] Noted target job ${targetJobKey} in fl-sync job ${jobId}`,
  );

  return type;
}

/**
 * Handles documents pending approval
 * @param {*} job
 * @param {*} oada
 */
export const handleDocumentJob: WorkerFunction = async (
  job: Job,
  { oada, jobId, log },
) => {
  const jobKey = jobId.replace(/^resources\//, '');
  let item: FlObject;
  const indexConfig = job.config as unknown as JobConfig;
  const { bid, key, masterid } = indexConfig;
  let flType: string;
  try {
    log.info(
      'handleDocumentJob processing new document job resource[%s] doc [%s]',
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

    item = itemData['food-logiq-mirror'] as unknown as FlObject;

    if (!item || !isObj(item)) throw new Error(`Bad FlObject`);

    // Save the document job
    return await new Promise(async (resolve, reject) => {
      flSyncJobs.set(jobId, {
        resolve,
        reject,
        'allow-rejection': indexConfig['allow-rejection'], // Also save this here
        'itemId': item._id,
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
        log.error(
          { error: cError },
          'postTpDocument Promise threw. Rejecting...',
        );
        const { message, JobError } = cError as Error & {
          JobError?: string;
        };
        if (
          [multipleFilesErrorMessage, attachmentsErrorMessage].includes(message)
        ) {
          log.info('error type', JobError);
          if (indexConfig['allow-rejection'] !== false) {
            try {
              // @ts-expect-error
              if (flType && rejectable[flType])
                await rejectFlDocument(item!._id, jobId, log, message);
            } catch {
              log.info(
                `Caught in rejectFlDocument, likely because this document id:${
                  item!._id
                } no longer exists in FL.`,
              );
            }
          }
          // Now let it continue below and throw; no promise gets made, but the job is failed now
        }

        // If allow-rejection is false and it throws, the job will fail and leave
        // the document "suspended" for further review, which is fine
        reject(cError);
      }
    });
  } catch (cError: unknown) {
    log.error({ error: cError }, 'handleDocumentJob errored');
    const { message, JobError } = cError as Error & {
      JobError?: string;
    };
    if (
      [multipleFilesErrorMessage, attachmentsErrorMessage].includes(message)
    ) {
      log.info('error type', JobError);
      await oada.put({
        path: `/${jobId}`,
        data: {
          fl_data_validation: {
            status: false,
            message,
          },
        },
      });
      if (indexConfig['allow-rejection'] !== false) {
        try {
          // @ts-expect-error
          if (flType && rejectable[flType])
            await rejectFlDocument(item!._id, jobId, log, message);
        } catch {
          log.info(
            `Caught in rejectFlDocument, likely because this document id:${
              item!._id
            } no longer exists in FL.`,
          );
        }
      }
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
  if (status === 'Approved') {
    log.info(`Finishing doc: [${itemId}] with status [${status}] `);
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

    type ||= targetJob.config['oada-doc-type'];
    if (!type) {
      log.error(`finishDoc could not determine doc type.`);
      endJob(
        docJobId,
        log,
        new JobError(`finishDoc could not determine doc type.`, 'other'),
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
      if (docJob && docJob['allow-rejection'] === false) {
        key = targetJob.config.docKey;
        _id = targetJob.config.document._id;
      } else {
        // PDFs from already-approved things need to land in LF.
        log.error(
          `Target result was incomplete, perhaps due to a doc type mismatch`,
        );
        endJob(
          docJobId,
          log,
          new JobError(
            `Target result was incomplete. Unable to call finishDoc`,
            'target-invalid-result',
          ),
        );
        return;
      }
    }

    // Move approved docs to trading partner /bookmarks
    try {
      log.info(
        `[job ${docJobId}] Moving approved document to [/${masterid}/bookmarks/trellisfw/documents/${type}/${key}]`,
      );
      await CONNECTION.ensure({
        path: `/${masterid}/bookmarks/trellisfw`,
        data: {},
        headers: {
          'Content-Type': 'application/vnd.oada.trellisfw.1+json',
        },
      });
      await CONNECTION.ensure({
        path: `/${masterid}/bookmarks/trellisfw/documents`,
        data: {},
        headers: {
          'Content-Type': 'application/vnd.trellisfw.documents.1+json',
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

      await syncToLf(CONNECTION, masterid, _id);
      log.info('Laserfiche sync job completed');
    } catch (error_) {
      log.error(`Error during move to bookmarks ${error_}`);
    }

    endJob(docJobId, log);
  } else {
    // Don't do anything; the job was already failed at the previous step and just marked in FL as Rejected.
    log.info(
      `[job ${docJobId}] Document [${itemId}] with status [${status}]. finishDoc skipping.`,
    );
  }
}

/**
 * Resolves flSyncJobs such that jobs get succeeded
 * @param {*} jobId - the _id of the job tied to the promise entry
 * @param {*} msg - the
 * @return
 */
function endJob(
  jobId: string,
  log: Logger,
  message?: string | Error | JobError,
) {
  log.info(`[job ${jobId}] Removing job from flSyncJobs Map`);
  // Trace(flSyncJobs, 'All flSyncJobs');
  const prom = flSyncJobs.get(jobId);
  if (prom) {
    if (message) {
      prom.reject(message);
    } else {
      prom.resolve(jobId);
    }
  } else {
    log.warn('Promise for flSyncJobs %s not found.', jobId);
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
  updateFlId?: string | void,
) {
  const policies = Object.values(result.policies);
  const cgl = (policies.find(
    (policy) =>
      typeof policy === 'object' &&
      policy.type === 'Commercial General Liability',
  ) ?? {}) as GeneralLiability;
  const general = Number.parseInt(String(cgl.each_occurrence) || '0', 10);
  const aggregate = Number.parseInt(String(cgl.general_aggregate) || '0', 10);
  const product = Number.parseInt(
    String(cgl['products_-_compop_agg']) || '0',
    10,
  );

  const al = (policies.find(
    (policy) =>
      typeof policy === 'object' && policy.type === 'Automobile Liability',
  ) ?? {}) as AutoLiability;
  const auto = Number.parseInt(String(al.combined_single_limit) || '0', 10);

  const ul = (policies.find(
    (policy) =>
      typeof policy === 'object' && policy.type === 'Umbrella Liability',
  ) ?? {}) as UmbrellaLiability;
  const umbrella = Number.parseInt(String(ul.each_occurrence) || '0', 10);

  const wc = policies.find(
    (policy) =>
      typeof policy !== 'string' && policy.type === `Worker's Compensation`,
  );
  const worker = Boolean(wc);

  const element = (policies.find(
    (policy) =>
      typeof policy === 'object' && policy.type === `Worker's Compensation Employee Liability`,
  ) ?? {}) as EmployersLiability;
  const employer = Number.parseInt(String(element.el_each_accident) || '0', 10);

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
        type: 'assessment',
      },
      {
        _id: flId,
        name,
        type: 'document',
      },
    );
  }

  return assess;
} // ConstructAssessment

/**
 * Gets the scraped JSON, perform document vs FL validation, and start an assessment
 * @param {*} targetJobKey
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
      log.info(
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

    const flMirror = flMirrorData['food-logiq-mirror'] as unknown as FlObject;

    const validationResult = await validateResult(result, flMirror, type);

    log.info(
      `[job ${docJobId}] Validation of pending document result:[${result._id}]: ${validationResult.status}`,
    );
    await CONNECTION.put({
      path: `/${docJobId}`,
      data: {
        validation: validationResult,
      } as any,
    });

    // 4a. Validation failed, fail and reject things.
    if (!validationResult?.status) {
      await postUpdate(
        CONNECTION,
        docJobId,
        `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejected FL Doc ${flId}: ${validationResult.message}`,
        'in-progress',
      );
      if (
        validationResult.message &&
        !validationResult?.message.includes(
          'Could not extract expiration dates',
        ) && // @ts-expect-error todo
        rejectable[type]
      ) {
        log.info(
          `[job ${docJobId}] Document type ${type} was rejectable. Rejecting`,
        );
        await rejectFlDocument(flId, docJobId, log, validationResult?.message);
      }

      endJob(
        docJobId,
        log,
        new JobError(validationResult?.message, 'document-validation'),
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
        });

      if (assessmentId) {
        log.info(
          `[job ${docJobId}] Assessment with id [${assessmentId}] already exists for document _id [${flId}].`,
        );
        assessmentToFlId.set(assessmentId, {
          jobId: docJobId,
          mirrorid,
          flId,
        });
      } else {
        log.info(
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
            'food-logiq-mirror'
          ] as unknown as FlObject;
          log.info(
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
              'food-logiq-mirror': mirrorAssess['food-logiq-mirror'],
            },
          });
        } else throw cError;
      }

      log.info(
        `[job ${docJobId}] Spawned assessment [${assessmentId}] for business id [${bid}]`,
      );
      await postUpdate(
        CONNECTION,
        docJobId,
        `Assessment spawned with id ${assessmentId} and linked into job /${docJobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        'in-progress',
      );

      if (assessmentId) {
        await CONNECTION.put({
          path: `/${docJobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          data: { id: assessmentId } as any,
        });
      }
    } else {
      log.info(
        `[job ${docJobId}] Skipping assessment for result of type [${flType}] [${type}].`,
      );
    }
  } catch (cError: unknown) {
    log.error(cError);
    throw cError as Error;
  }
} // HandleScrapedResult

/**
 * rejects fl document
 */
async function rejectFlDocument(
  documentId: string,
  jobId: string,
  log: Logger,
  message?: string,
) {
  log.info(`[job ${jobId}] Rejecting FL document [${documentId}]. ${message}`);

  // Extra check prior to rejection.
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}`,
    {
      method: 'get',
      headers: { Authorization: FL_TOKEN },
    },
  );
  const doc = (await response.json()) as any;
  if (doc?.shareSource?.approvalInfo?.status === 'Approved') {
    await postUpdate(
      CONNECTION,
      jobId,
      'Job was going to be rejected but was already approved',
      'in-progress',
    );
    await CONNECTION.put({
      path: `/${jobId}`,
      data: {
        'foodlogiq-result-status': 'Approved',
      },
    });

    return;
  }

  await fetch(
    `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/approvalStatus`,
    {
      method: 'put',
      headers: { Authorization: FL_TOKEN },
      body: JSON.stringify({
        status: 'Rejected',
        comment: `${message} Please correct and resubmit or reach out to the Smithfield FSQA team`,
        visibleForSupplier: true,
      }),
    },
  );
  await CONNECTION.put({
    path: `/${jobId}`,
    data: {
      'foodlogiq-result-status': 'Rejected',
    },
  });
} // RejectFlDoc

function isFLItem(item: unknown) {
  return isObj(item) && isObj(item['food-logiq-mirror']);
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

    log.info(`Path: ${SERVICE_PATH}/businesses`);

    const docsWatch = new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.documents.*`,
      name: `document-mirrored`,
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
      onNewList: AssumeState.Handled,
    });

    /** TODO: Re-add this after list-lib/client/oada is fixed to dedupe the initial add/change that occurs
     * This occurs because tree PUT ensures the path first with empty resources, then writes the data, which triggers a change.
     * The add also comes in with the same or an unpredictable rev because item is fetched after the onAdd is triggered,
     * thus the _rev won't be the rev at the time it was added.
     * It'll be the _rev when it was fetched.
     *
    docsWatch.on(ChangeType.ItemAdded, async ({item, pointer}) => {
      const it = (await item) as JsonObject;
      if (it['food-logiq-mirror']) {
        queueDocumentJob(it, pointer);
      }
    });
    */
    docsWatch.on(ChangeType.ItemChanged, async ({ change, item, pointer }) => {
      const ch = await change;
      if (ch.body?.['food-logiq-mirror']) {
        queueDocumentJob((await item) as JsonObject, pointer, log);
      }
    });

    const assessWatch = new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.assessments.*`,
      name: `assessment-mirrored`,
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
      async ({ change, item, pointer }) => {
        const ch = await change;
        if (ch.body?.['food-logiq-mirror']) {
          queueAssessmentJob((await item) as JsonObject, pointer, log);
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
    log.info(`queueAssessmentJob processing mirror change`);
    const pieces = pointer.parse(path);
    const bid = pieces[0];
    const key = pieces[2]!;

    const { data: itemData } = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
    });
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`,
      );
    }

    const item = itemData['food-logiq-mirror'] as unknown as FlObject;

    // Skip when there is no associated document job.
    // This may happen on startup with lots of assessments already sitting there.
    if (!assessmentToFlId.has(key)) {
      log.info(
        `No associated fl-sync document job could be found for assessment: ${item._id}`,
      );
      return;
    }

    const { jobId: docJobId } = assessmentToFlId.get(key)!;

    const { job: docJob } = flSyncJobs.get(docJobId);

    const indexConfig = docJob.config as unknown as JobConfig;

    if (!isObj(indexConfig)) {
      throw new Error('Unexpected job config data');
    }

    const { key: flDocumentId, type: flDocumentType, masterid } = indexConfig;
    if (!flDocumentType) {
      log.info(
        `[job ${docJobId}] Assessment [${item._id}] could not find fl doc type prior to queueing. Ignoring.`,
      );
      return;
    }

    const assessmentType = item?.assessmentTemplate?.name;
    const docs = flTypes.get(flDocumentType)!;
    if (!assessmentType || !docs) {
      log.info(
        `[job ${docJobId}] Assessment type of [${item._id}] was of type [${assessmentType}]. Ignoring.`,
      );
      return;
    }

    if (
      !docs.assessments ||
      !Object.keys(docs.assessments).includes(assessmentType)
    ) {
      log.info(
        `[job ${docJobId}] Assessment [${item._id}] was of type [${assessmentType}]. Ignoring.`,
      );
      return;
    }

    const status = item.state;
    const approvalUser = item?.lastUpdate?.userId;
    const usersEqual =
      approvalUser === FL_TRELLIS_USER ||
      approvalUser === APPROVAL_TRELLIS_USER;
    log.info(
      `[job ${docJobId}] approvalInfo user ${
        usersEqual
          ? 'matches our user'
          : `[${approvalUser}] does not match our users: [${FL_TRELLIS_USER} or ${APPROVAL_TRELLIS_USER}]`
      }`,
    );

    switch (status) {
      case 'Submitted': {
        // 2a. Create assessment job, and link it into jobs list and fl document job reference
        const { headers } = await CONNECTION.post({
          path: '/resources',
          contentType: 'application/vnd.oada.job.1+json',
          data: {
            type: 'assessment-mirrored',
            service: SERVICE_NAME,
            config: {
              'fl-sync-type': 'assessment',
              'type': assessmentType,
              key,
              bid,
              'rev': indexConfig._rev,
              'flDocId': flDocumentId,
              'flDocType': flDocumentType,
              'flDocJobId': docJobId,
              'assessmentType': {
                id: item?.assessmentTemplate._id,
                name: item?.assessmentTemplate.name,
              },
            },
          },
        });
        const jobkey = headers['content-location']!.replace(
          /^\/resources\//,
          '',
        );

        await CONNECTION.put({
          path: pending,
          tree,
          data: {
            [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
          },
        });
        log.info(
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

      case 'Approved': {
        // Approved (by anyone). Clean up and remove after approval
        endJob(item._id, log);
        assessmentToFlId.delete(item._id);
        // Approve any linked jobs
        await approveFlDocument(flDocumentId, docJobId, log);
        // TODO: remove this when/if FL is able to retrieve changes after approval updates
        await finishDocument(docJobId, flDocumentId, masterid, status, log);

        break;
      }

      case 'Rejected': {
        // 2b. Notify, clean up, and remove after rejection
        const reasons = `${docJob?.['fail-reasons']}`;

        const message = `A supplier Assessment associated with this document has been rejected for the following reasons: ${reasons}.`;
        // Reject the assessment job;
        endJob(item._id, log, message);
        assessmentToFlId.delete(item._id);
        log.info(`[job ${docJobId}] REASONS: ${reasons}`);

        // Reject the FL Document with a supplier message and reject the doc job
        if (flSyncJobs.get(docJobId)['allow-rejection'] === false) {
          log.info(
            `[job ${docJobId}] Assessment ${item._id} failed logic, but cannot override approval. Calling finishDoc.`,
          );
          await approveFlDocument(flDocumentId, docJobId, log);
          // TODO: remove this when/if FL is able to retrieve changes after approval updates
          await finishDocument(
            docJobId,
            flDocumentId,
            masterid,
            'Approved',
            log,
          );
        } else {
          if (reasons) {
            await rejectFlDocument(flDocumentId, docJobId, log, message);
          }

          endJob(
            docJobId,
            log,
            new JobError(message, 'associated-assessment-rejected'),
          );
          // TODO: remove this when/if FL is able to retrieve changes after approval updates
          await finishDocument(docJobId, flDocumentId, masterid, status, log);
        }

        break;
      }

      default: {
        // 2c. Job not handled by trellis system.
        const message = `Assessment not pending, approval status not set by Trellis. Skipping. Assessment: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
        log.info(`[job ${docJobId}] ${message}`);
      }
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'queueAssessmentJob Failed',
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
    path: '/resources',
    contentType: 'application/vnd.oada.job.1+json',
    data: {
      'type': 'document-mirrored',
      'service': SERVICE_NAME,
      'config': indexConfig,
      'foodlogiq-result-status': flStatus,
    } as any,
  });
  const jobkey = headers['content-location']!.replace(/^\/resources\//, '');

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
        'fl-sync': {
          jobs: {
            [jobkey]: { _id },
          },
        },
      },
    },
  });

  log.info(`[job ${_id}] Posted job [document] at /${_id}`);
  return _id;
}

async function cancelDocJobs(itemId: string, log: Logger, newJobKey?: string) {
  // Find and ignore other jobs with the same item._id
  const flSyncJobMatches = Array.from(flSyncJobs.entries()).filter(
    ([_, v]) => v.itemId === itemId,
  );
  for await (const [jobId, _] of flSyncJobMatches) {
    const message = `Job was interrupted by an update to this FL doc${newJobKey ? ` resulting in a new job [resources/${newJobKey}]` : ''}. Cancelling this job.`;
    await postUpdate(CONNECTION, jobId, message, 'in-progress');
    // TODO: Should this be considered job success or failure?
    await endJob(jobId, log, new JobError(message, 'job-cancelled'));
  }
}

async function queueDocumentJob(
  fullData: JsonObject,
  path: string,
  log: Logger,
) {
  try {
    // 1. Gather fl indexing, mirror data, and trellis master id
    log.trace(`queueDocumentJob processing mirror change`);
    const pieces = pointer.parse(path);
    const bid = pieces[0]!;
    //    Const type = pieces[1];
    const key = pieces[2];

    const item = fullData['food-logiq-mirror'] as unknown as FlObject;

    if (item.shareSource.isDeleted) {
      log.info(`Document [${item._id}] was deleted by the supplier. Skipping.`);
      return;
    }

    const { data: bus } = (await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`,
    })) as { data: JsonObject };

    let masterid;
    if (!bus) log.error(`No trading partner found for business ${bid}.`);
    if (bus['food-logiq-mirror']) {
      const { result } = (await doJob(CONNECTION, {
        service: SERVICE_NAME,
        type: 'business-lookup',
        config: {
          'fl-business': bus['food-logiq-mirror'],
          'link': `https://connect.foodlogiq.com/businesses/${CO_ID}/suppliers/detail/${item._id}/${COMMUNITY_ID}`,
        },
      })) as unknown as { result: { masterid: string } };
      masterid = result?.masterid;
    }

    // TODO: Determine how to report this skipping due to no trading-partner.
    if (!masterid) return;
    log.info(
      `Found trading partner masterid [${masterid}] for FL business ${bid}`,
    );

    const documentType = pointer.has(item, `/shareSource/type/name`)
      ? pointer.get(item, `/shareSource/type/name`)
      : undefined;
    if (!documentType || !flTypes.has(documentType)) {
      log.info(
        `Document [${item._id}] was of type [${documentType}]. Ignoring.`,
      );
      return;
    }

    const status = item?.shareSource?.approvalInfo?.status;
    const approvalUser = item?.shareSource?.approvalInfo?.setBy?._id;
    log.info(
      `approvalInfo user: ${approvalUser} (${
        approvalUser === FL_TRELLIS_USER ||
        approvalUser === APPROVAL_TRELLIS_USER
          ? 'Was us.'
          : 'Was NOT us'
      }). Status: ${status}. id: ${item._id}`,
    );

    // Accept all supplier drafts as we had previously while changing the doc
    // status back to Awaiting Approval.
    if (item.shareSource?.draftVersionId && status !== 'Awaiting Approval') {
      log.info(
        `Document [${item._id}] has a supplier update. Setting status to 'Awaiting Approval'.`,
      );
      await fetch(
        `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item.shareSource.draftVersionId}/approvalStatus`,
        {
          method: 'put',
          headers: { Authorization: FL_TOKEN },
          body: JSON.stringify({
            status: 'Awaiting Approval',
            visibleForSupplier: false,
            comment: '',
          }),
        },
      );
      return;
    }

    const jobConfig: JobConfig = {
      status,
      'fl-sync-type': 'document',
      'type': documentType,
      'key': key!,
      'date': item.versionInfo.createdAt,
      bid,
      '_rev': fullData._rev as number,
      masterid,
      'mirrorid': fullData._id as string,
      'bname': item.shareSource.sourceBusiness.name,
      'name': item.name,
      'link': `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${item._id}`,
    };

    if (status === 'Awaiting Approval') {
      // A. Create new job and link into jobs list and fl doc meta
      await postJob(CONNECTION, jobConfig, 'Awaiting Approval', log);
    } else if (
      approvalUser === FL_TRELLIS_USER ||
      approvalUser === APPROVAL_TRELLIS_USER
    ) {
      log.info(
        `Document ${item._id} approvalUser was Trellis. Calling finishDoc`,
      );
      // B. Approved or rejected by us. Finish up the automation
      // TODO There really shouldn't be multiple jobs here for a given item._id,
      // but in such an event, finish all of them.
      const flSyncJobMatches = Array.from(flSyncJobs.entries()).filter(
        ([_, v]) => v.itemId === item._id,
      );
      if (!flSyncJobMatches) return;
      for await (const [docJobId, docJob] of flSyncJobMatches) {
        await finishDocument(docJobId, item._id, masterid, status, log);
      }
      // C. Document handled by others
    } else if (status === 'Approved') {
      log.info(
        `Already approved document[${item._id}]; bid[${bid}]; ApprovalUser was not us. Reprocessing and ushering through.`,
      );
      // Run it through target and move it to trading-partner /bookmarks
      jobConfig['allow-rejection'] = false;
      await postJob(CONNECTION, jobConfig, status, log);
    } else {
      log.info(
        `Document ${item._id} approvalUser was not us. status !== Approved. Skipping. Killing any running jobs.`,
      );
      await cancelDocJobs(item._id, log);
    }
  } catch (cError: unknown) {
    throw oError.tag(cError as Error, 'queueDocumentJob Failed', fullData._id);
  }
}

export function isObj(thing: any): thing is JsonObject {
  return (
    typeof thing === 'object' &&
    !Buffer.isBuffer(thing) &&
    !Array.isArray(thing)
  );
}

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

async function syncToLf(oada: OADAClient, tradingPartner: string, doc: string) {
  return doJob(oada, {
    service: 'lf-sync',
    type: 'sync-doc',
    config: {
      tradingPartner,
      doc: {
        _id: doc,
      },
    },
  });
}

/**
 * @license
 * Copyright 2022 Qlever LLC
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
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import ksuid from 'ksuid';
import debug from 'debug';
import oError from '@overleaf/o-error';
import Promise from 'bluebird';
import _ from 'lodash';
import pointer from 'json-pointer';
import jszip from 'jszip';
import config from './config.js';
import tree from './tree.js';
import md5 from 'md5';
import type { TreeKey } from '@oada/list-lib/dist/tree.js';
import { validateResult } from './docTypeValidation.js';
import mirrorTree from './tree.mirrorWatch.js';
import checkAssessment from './checkAssessments.js';
import { getAutoApprove } from './index.js';
import { flToTrellis, fromOadaType } from './conversions.js';
import { linkAssessmentToDocument, spawnAssessment } from './assessments.js';
import type { Job, WorkerFunction } from '@oada/jobs';
import type { Change, JsonObject, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import { JobError, postUpdate } from '@oada/jobs';
import { Change as ListChange, ListWatch } from '@oada/list-lib';
if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const FL_TRELLIS_USER = config.get('foodlogiq.trellisUser');
const CO_ID = config.get('foodlogiq.community.owner.id');

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');
const trace = debug('fl-sync:mirror-watchtrace');

const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
const pending = `${SERVICE_PATH}/jobs/pending`;
const MASTERID_INDEX_PATH = `/bookmarks/trellisfw/trading-partners/masterid-index`;
const targetToFlSyncJobs = new Map<string, { jobKey: string; jobId: string }>();
const assessmentToFlId = new Map<
  string,
  { jobId: string; mirrorid: string; flId: string; assessmentJobId?: string }
>();
const targetErrors = {
  'target-multiple-docs-combined': {
    patterns: [/this is a multi-.* file/i],
    reject: true,
    jobError: 'target-multiple-docs-combined',
  },
  'target-validation': {
    patterns: [/(validation|valiadation) failed/i],
    reject: false,
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
const multiFileOkay = new Set(['Corrective Actions']);
const flTypes = new Map(
  Object.entries({
    'Certificate of Insurance': {
      assessments: {
        'Certificate of Insurance (COI) Requirements': ASSESSMENT_TEMPLATE_ID,
      },
    },
    /*
  '100g Nutritional Information': {},
  'Specified Risk Materials (SRM) Audit': {
    assessments: {
      'Supplier Risk Acknowledgement': "61f97e7614a99d000e5ec310",
    }
  },
  */
  })
);
const multipleFilesErrorMessage =
  'Multiple files attached. Please upload a single PDF per Food LogiQ document.';
const attachmentsErrorMessage = 'Failed to retreive attachments';

function mostRecentKsuid(keys: string[]) {
  return keys.length > 0
    ? keys
        .map((k) => ksuid.parse(k))
        .reduce((a, b) => (a.compare(b) > 0 ? a : b)).string
    : undefined;
}

/**
 * Searching and assigning target jobs to FL documents
 * @param {*} item
 * @param {*} key
 * @returns
 */

export async function getLookup(item: any, key: string) {
  try {
    const { _id } = item;
    key = key.replace(/^\//, '');
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return;
    const pdfId = item.config.pdf._id;
    if (!pdfId) return;
    info(`New target job [${key}]: Trellis pdf: [${pdfId}]`);

    // Fetch then store a mapping to the fl-sync job
    let data = await CONNECTION.get({
      path: `/${pdfId}/_meta`,
    }).then((r) => r.data);

    if (Buffer.isBuffer(data)) {
      data = JSON.parse((data || '').toString());
    }

    if (!isObj(data)) {
      throw new Error(`PDF _meta [${pdfId}] was not an object.`);
    }

    // @ts-expect-error
    const flJobKeys = Object.keys(data?.services?.['fl-sync']?.jobs || {});
    console.log('getLookup1', flJobKeys);

    console.log({ flJobKeys });
    const jobKey = mostRecentKsuid(flJobKeys);
    if (!jobKey)
      throw new Error(`jobKey not found in _meta doc of the pdf [${pdfId}]`);

    // @ts-expect-error
    const jobId = data?.services?.['fl-sync']?.jobs?.[jobKey]!._id;

    const {
      data: { bid, key: documentKey },
    } = (await CONNECTION.get({
      path: `/${jobId}/config`,
    })) as { data: JsonObject };

    targetToFlSyncJobs.set(key, { jobKey, jobId });

    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${documentKey}/_meta`,
      data: {
        services: {
          target: {
            jobs: {
              [key]: { _id },
            },
          },
        },
      },
    });

    await CONNECTION.put({
      path: `/${jobId}/target-jobs`,
      data: {
        [key]: { _id },
      },
    });
    info(`Noted target job ${key} in fl-sync job ${jobId}`);
  } catch (error_) {
    error(`Error associating new target job to FL documents`);
    error(error_);
  }
} // GetLookup

/**
 * handling an update from target
 * @param {*} change
 * @param {*} targetJobKey
 * @returns
 */
export async function onTargetChange(change: Change, targetJobKey: string) {
  trace(`Recieved update for job [${targetJobKey}]`);
  try {
    // Gather the job information between target and fl-sync
    targetJobKey = targetJobKey.replace(/^\//, '');
    const job = await CONNECTION.get({
      path: `/resources/${targetJobKey}`,
    }).then((r) => r.data as JsonObject);

    if (!targetToFlSyncJobs.has(targetJobKey)) {
      trace(`No target job lookup for ${targetJobKey}`);
      return;
    }

    const { jobId: flSyncJobId } = targetToFlSyncJobs.get(targetJobKey)!;
    const indexConfig = await CONNECTION.get({
      path: `/${flSyncJobId}/config`,
    }).then((r) => r.data as unknown as JobConfig);
    const { key } = indexConfig;

    // Handle final statuses
    await handleTargetStatus(
      change,
      key,
      targetJobKey,
      flSyncJobId,
      job,
      indexConfig
    );

    // Handle updates
    await handleTargetUpdates(change, key);
  } catch (error_) {
    error('onTargetChange error: ');
    error(error_);
    throw error_;
  }
} // OnTargetChange

async function handleTargetStatus(
  change: Change,
  key: string,
  targetJobKey: string,
  flSyncJobId: string,
  targetJob: JsonObject,
  indexConfig: JobConfig
) {
  const status = pointer.has(change, `/body/status`)
    ? pointer.get(change, `/body/status`)
    : undefined;
  if (!status) return;

  const flSyncJob = flSyncJobs.get(flSyncJobId);
  if (flSyncJob && flSyncJob['allow-rejection'] === false) {
    const documentMirror = await CONNECTION.get({
      path: `/${indexConfig.mirrorid}`,
    }).then((r) => r.data as JsonObject);
    const item = documentMirror['food-logiq-mirror'] as unknown as FlObject;

    info(`Target finished with status ${status} on already-approved doc.`);
    if (status === 'success') {
      // If successful, skip the potential pitfalls of assessment creation and call finishDoc.
      await postUpdate(
        CONNECTION,
        flSyncJobId,
        'Target extraction completed. Handling result...',
        'in-progress'
      );
      return finishDocument(
        item,
        indexConfig.bid,
        indexConfig.masterid,
        'approved'
      );
    }

    if (status === 'failure') {
      // If failure, target can't extract it so we're stuck without a result. Fail the job
      // and call finishDoc.
      await postUpdate(
        CONNECTION,
        flSyncJobId,
        'Target extraction failed',
        'in-progress'
      );
      endJob(
        flSyncJobId,
        new JobError(
          'Target errored on already-approved job',
          'target-error-already-approved'
        )
      );
      targetToFlSyncJobs.delete(targetJobKey);
      return finishDocument(
        item,
        indexConfig.bid,
        indexConfig.masterid,
        'failed'
      );
    }
  }

  if (status === 'success') {
    await postUpdate(
      CONNECTION,
      flSyncJobId,
      'Target extraction completed. Handling result...',
      'in-progress'
    );
    await handleScrapedResult(targetJobKey);
  } else if (status === 'failure') {
    await postUpdate(
      CONNECTION,
      flSyncJobId,
      'Target extraction failed',
      'in-progress'
    );

    let jobError;
    let errorMessage = 'Other Target failure';
    // Target failed and we have "updates". Otherwise, no "updates"; make it work.
    if (isObj(targetJob) && targetJob.updates) {
      // 1. Find the update with the error message
      const errorObject = Object.values(targetJob.updates).find(
        (obj) => obj.status === 'error'
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

        info(
          `Target job ${targetJobKey} errored. reject: ${reject}; fl-sync job error ${jobError}`
        );

        if (reject) await rejectFlDocument(key, errorMessage);
        if (jobError) endJob(flSyncJobId, new JobError(errorMessage, jobError));
      }
    }

    if (!jobError)
      endJob(flSyncJobId, new JobError(errorMessage, 'target-other'));
    targetToFlSyncJobs.delete(targetJobKey);
  }
}

async function handleTargetUpdates(change: Change, key: string) {
  await Promise.each(
    Object.values((change && change.body && change.body.updates) || {}),
    async (value: { status: string; information: string }) => {
      let details;
      switch (value.status) {
        case 'started':
          break;
        case 'error':
          details = value.information;
          break;
        case 'identified':
        case 'success':
          break;
        default:
          break;
      }

      if (details) {
        info(`Posting new update to FL docId ${key}: ${details}`);
        await axios({
          method: 'post',
          url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${key}/capa`,
          headers: { Authorization: FL_TOKEN },
          data: {
            details,
            type: 'change_request',
          },
        });
      }
    }
  );
}

/**
 * Approves fl document
 * @param {*} docId
 */
async function approveFlDocument(documentId: string) {
  info(`Approving associated FL Doc ${documentId}`);
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/approvalStatus/approved`,
    headers: { Authorization: FL_TOKEN },
    data: {
      status: 'Approved',
    },
  });
} // ApproveFlDoc

/**
 * handles queued assessment-type jobs. Assessments should be treated as separate from the
   documents as much as possible.
 */
export const handleAssessmentJob: WorkerFunction = async (
  job: any,
  { oada, jobId: jobKey }
) => {
  info(`Handling Assessment job ${jobKey}`);
  try {
    const jobId = `resources/${jobKey}`;
    const { bid, key } = job.config;
    const itemData = await oada
      .get({
        path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
      })
      .then((r) => r.data as JsonObject);
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`
      );
    }

    const item = itemData['food-logiq-mirror'] as unknown as FlAssessment;

    if (!item || !isObj(item)) return {};
    if (!item._id || !assessmentToFlId.has(item._id))
      throw new Error(`assessmentToFlId does not exist for _id ${item._id}`);

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
    info(`Autoapprove Assessments Configuration: [${aaa}]`);
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
      info(`Assessment Auto-${item.state}. [${item._id}]`);
      await axios({
        method: 'put',
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${
          item._id
        }/${failed ? 'reject' : 'approve'}spawnedassessment`,
        headers: { Authorization: FL_TOKEN },
        data: item,
      });
      info("WRITING REASONS", reasons.join(';'));

      let docJob = assessmentToFlId.get(item._id);
      if (docJob) {
        await CONNECTION.put({
          path: `/${docJob.jobId}`,
          data: {
            'fail-reasons': reasons.join(';')
          }
        })
      }
      await postUpdate(
        CONNECTION,
        jobId,
        {},
        `Assessment auto-${item.state}. [${item._id}] ${
          failed ? `for these reasons: ${reasons.join(';')}` : ''
        }`
        // TODO: is this an enumerated status?Should the above line get applied as the 'meta'?
        // 'in-progress'
      );
      // TODO: Resolve this
      // fail/succeed the job
      if (!failed) {
        //    Return { assessmentState: item.state}
      } else {
        //   Throw new Error('Assessment auto-rejected')
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
    });
  } catch (error_) {
    error('Error handleAssessmentJob', error_);
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
}: {
  bid: string;
  item: FlObject;
  oada: OADAClient;
  masterid: string;
  jobKey: string;
  jobId: string;
}) {
  info(`postTpDocument: bid:${bid} item:${item._id}`);
  const type = item?.shareSource?.type?.name;
  // 1. Retrieve the attachments and unzip
  const request: AxiosRequestConfig = {
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
    headers: { Authorization: FL_TOKEN },
    responseEncoding: 'binary',
  };
  console.log('postTpDocument 1');

  const file = await axios(request)
    .then((r) => r.data)
    .catch((error_) => {
      if (error_.response.status === 404) {
        info(`Bad attachments on item ${item._id}. Throwing JobError`);
        throw new JobError(attachmentsErrorMessage, 'bad-fl-attachments');
      } else throw error_;
    });
  console.log('postTpDocument 2');

  const zip = await new jszip().loadAsync(file);

  const files = Object.keys(zip.files);

  if (files.length !== 1) {
    throw new JobError(multipleFilesErrorMessage, 'multi-files-attached');
    if (!multiFileOkay.has(type)) {
    }
  }

  const fKey = files[0];
  if (!fKey)
    throw new Error(
      `Failed to acquire file key while handling pending document`
    );
  // Make a hash of the file name because the file names themselves might not be
  // safe for oada or client
  const fileHash = md5(fKey);

  console.log('postTpDocument 3', item._id);
  // 2. Fetch mirror and pdf resource id
  const mirrorid = await oada
    .get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_id`,
    })
    .then((r) => r.data);

  console.log('postTpDocument 4');
  const pdfResponse = await oada
    .get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/vdoc/pdf`,
    })
    .then((r) => r.data as unknown as Record<string, any>)
    .catch((error_) => {
      if (error_.status !== 404) throw error_;
    });

  console.log('postTpDocument 5');
  // 3a. PDF could already have been mirrored in the approval flow
  // If it doesn't exist, create a new PDF resource
  const pdfId: string =
    pdfResponse?.[fileHash]?._id || `resources/${ksuid.randomSync().string}`;
  console.log('postTpDocument 5.1');

  const ab = await zip.file(fKey)!.async('uint8array');
  console.log('postTpDocument 5.2');
  const zdata = Buffer.alloc(ab.byteLength);
  console.log('postTpDocument 5.3');
  for (let index = 0; index < zdata.length; ++index) {
    zdata[index] = ab[index]!;
  }

  console.log('postTpDocument 5.4');
  await oada.put({
    path: `/${pdfId}`,
    data: zdata,
    contentType: 'application/pdf',
  });

  console.log('postTpDocument 6');
  // 4. Create a vdoc entry from the pdf to foodlogiq
  await oada.put({
    path: `/${pdfId}/_meta`,
    data: {
      filename: fKey,
      vdoc: {
        foodlogiq: { _id: mirrorid },
      },
      services: {
        'fl-sync': {
          jobs: {
            [jobKey]: { _id: jobId },
          },
        },
      },
    } as Body,
    contentType: 'application/json',
  });

  console.log('FINISHED WRITING FLSYNC TO META', { pdfId, jobKey, jobId });
  // Create reference from the pdf to the fl-sync job
  //  trace(`Creating link to fl-sync job in meta of ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}/${docKey}/_meta/vdoc/pdf/${fileHash}/_meta`);

  console.log('postTpDocument 7');
  // 5. Create a vdoc entry from the fl doc to the pdf
  // First, overwrite what is currently there if previous pdfs vdocs had been linked
  await axios({
    method: 'put',
    url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
    data: {
      vdoc: {
        pdf: 0, // Wipes out {key1: {}, key2: {}, etc.}
      },
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${TRELLIS_TOKEN}`,
    },
  });
  console.log('postTpDocument 7.5');
  await axios({
    method: 'put',
    url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
    data: {
      vdoc: {
        pdf: {
          [fileHash]: { _id: pdfId },
        },
      },
    },
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${TRELLIS_TOKEN}`,
    },
  });
  const pdfKey = pdfId.replace(/resources\//, '');

  console.log('postTpDocument 8');
  // 6. Link the pdf into the unextracted documents list
  const { document, docType, urlName } = await flToTrellis(item);
  const documentKey = await oada
    .post({
      path: `/resources`,
      data: document,
      contentType: docType,
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));
  trace(`Partial JSON created at /resources/${documentKey}`);

  console.log('postTpDocument 9');
  await oada.put({
    path: `resources/${documentKey}/_meta`,
    //    Path: `resources/${docKey}/_meta/vdoc/pdf/${fKey}`,
    data: {
      vdoc: { pdf: { [fileHash]: { _id: pdfId, _rev: 0 } } },
    },
  });
  info(
    `Pdf linked into /_meta/vdoc/pdf/${fileHash} of the partial json document.`
  );

  await oada.put({
    path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}`,
    data: {
      [documentKey]: { _id: `resources/${documentKey}`, _rev: 0 },
    },
    tree,
  });
  console.log('postTpDocument 10');
  info(
    `Created partial JSON in docs list: ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}/${documentKey}`
  );

  return {
    pdfKey,
    docKey: documentKey,
    item,
    urlName,
    docType,
    fKey,
    fileHash,
  };
}

/**
 * Handles documents pending approval
 * @param {*} job
 * @param {*} oada
 */
export const handleDocumentJob: WorkerFunction = async (
  job: Job,
  { oada, jobId: jobKey }: { oada: OADAClient; jobId: string }
) => {
  let item: FlObject;
  const indexConfig = job.config as unknown as JobConfig;
  const { bid, key, masterid } = indexConfig;
  const jobId: string = job.oadaId;
  try {
    info(`handleDocumentJob processing pending FL document [${key}]`);

    const itemData = await oada
      .get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}`,
      })
      .then((r) => r.data as JsonObject);
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`
      );
    }

    item = itemData['food-logiq-mirror'] as unknown as FlObject;

    if (!item || !isObj(item)) throw new Error(`Bad FlObject`);

    const { docKey, docType } = await postTpDocument({
      bid,
      oada,
      item,
      masterid,
      jobKey,
      jobId,
    });
    await postUpdate(
      CONNECTION,
      jobId,
      `Document [key:${docKey}, type: ${docType}] posted to trading partner docs.`,
      'in-progress'
    );
    await CONNECTION.put({
      path: `${jobId}`,
      data: {
        trellisDoc: {
          key: docKey,
          type: docType,
        },
      },
    });

    // Lazy create an index of trading partners' documents resources for monitoring.
    await CONNECTION.head({
      path: `${SERVICE_PATH}/monitors/tp-docs/${masterid}`,
    }).catch(async (error_) => {
      if (error_.status === 404) {
        const tpDocsId = await CONNECTION.head({
          path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents`,
        }).then((r) => r.headers['content-location']!.replace(/^\//, ''));
        // Create a versioned link to that trading-partner's shared documents
        await CONNECTION.put({
          path: `${SERVICE_PATH}/monitors/tp-docs`,
          tree,
          data: {
            [masterid]: {
              _id: tpDocsId,
              _rev: 0,
            },
          },
        });
      } else throw error_;
    });

    // Save the document job
    return await new Promise((resolve, reject) => {
      flSyncJobs.set(jobId, {
        resolve,
        reject,
        'allow-rejection': indexConfig['allow-rejection'], // Also save this here
      });
    });
  } catch (error_: any) {
    error(`handleDocumentJob errored`);
    error(error_);
    if (
      [multipleFilesErrorMessage, attachmentsErrorMessage].includes(
        error_.message
      )
    ) {
      await CONNECTION.put({
        path: `/${jobId}`,
        data: {
          fl_data_validation: {
            status: false,
            message: error_.message,
          },
        },
      });
      if (indexConfig['allow-rejection'] !== false)
        await rejectFlDocument(item!._id, error_.message);
      // Now let it continue below and throw; no promise gets made, but the job is failed now
    }

    // If allow-rejection is false and it throws, the job will fail and leave
    // the document "suspended" for further review, which is fine
    throw error_;
  }
}; // HandleDocumentJob

// The new one
async function finishDocument(
  item: FlObject,
  bid: string,
  masterid: string,
  status: string
) {
  if (status === 'approved') {
    info(`Finishing doc: [${item._id}] with status [${status}] `);
    // 1. Get reference of corresponding pending scraped pdf
    const jobs = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/fl-sync/jobs`,
    })
      .then((r) => r.data as unknown as Links)
      .catch((error_) => {
        if (error_.status !== 404) throw error_;
        return {};
      });

    console.log('fd', 1);
    if (!jobs || !isObj(jobs))
      throw new Error('Bad _meta target jobs during finishDoc');
    const jobKey = mostRecentKsuid(Object.keys(jobs));
    if (!jobKey || !jobs)
      throw new Error('Most recent KSUID Key had no link _id');
    console.log('fd', 2, jobKey);

    const jobObject = await CONNECTION.get({
      path: `/resources/${jobKey}`,
    }).then((r) => r.data as JsonObject);

    console.log('fd', 2.5);

    const targetJobs = _.get(jobObject, 'target-jobs') as unknown as string;
    let targetJob: string;
    if (targetJobs) {
      const tJobs = Object.keys(targetJobs);
      if (tJobs.length > 0) {
        targetJob = tJobs[0] as unknown as string;
      }
    }

    // @ts-expect-error
    if (targetJob !== undefined && targetToFlSyncJobs.has(targetJob)) {
      targetToFlSyncJobs.delete(jobKey);
    } else {
      throw new Error('Target job not found. Could not move result');
    }

    console.log('fd', 3);

    const { data } = (await CONNECTION.get({
      path: `/resources/${targetJob}`,
    })) as { data: JsonObject };
    const result = data.result as unknown as Record<string, any>;
    console.log('fd', 4);

    const type = Object.keys(result || {})[0];
    if (!type) return;
    const key = Object.keys(result[type])[0];
    if (!key) return;
    console.log('fd', 5);

    // 2. Move approved docs to trading partner /bookmarks
    info(
      `Moving approved document to [${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}]`
    );
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}`,
      data: {},
      tree,
    });
    console.log('fd', 6);
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}`,
      data: { _id: result[type][key]._id },
    });
    console.log('fd', 7);
    endJob(`/resources/${jobKey}`);
  } else {
    // Don't do anything; the job was already failed at the previous step and just marked in FL as Rejected.
    info(`Document [${item._id}] with status [${status}]. finishDoc skipping.`);
  }
}

/**
 * Move approved documents into final location. Triggered by document re-mirror.
 * @param {*} item
 * @param {*} bid
 * @param {*} masterid
 * @returns
 */
/*
async function finishDoc(item: FlObject, bid: string, masterid: string, status: string) {
  try {
    if (status === 'approved') {
      info(`Finishing doc: [${item._id}] with status [${status}] `);
      //1. Get reference of corresponding pending scraped pdf
      let jobs = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs`,
      }).then(r => r.data as unknown as Links)
      .catch((err) => {
        if (err.status !== 404) throw err;
        return {};
      })

      console.log('fd', 1)
      if (!jobs || !isObj(jobs)) throw new Error('Bad _meta target jobs during finishDoc');
      let jobKey = mostRecentKsuid(Object.keys(jobs));
      if (!jobKey || !jobs) throw new Error('Most recent KSUID Key had no link _id');
      console.log('fd', 2, jobKey)

      // Get FL-Sync job id then tidy targetToFlSyncJobs and resolve job promise
      //@ts-ignore
      let {jobId} = targetToFlSyncJobs.get(jobKey);
      console.log('fd', 2.5, jobId)
      if (!jobId) {
        console.log(`targetJobKey ${jobKey} does not exist on Map targetToFlSyncJobs at handleScrapedResult`);
        //Generally, this function only gets called when a job has not been queued.
        //However, its better to throw here in case it gets called from somehwere
        //that had a job queued
        throw new Error(`targetJobKey ${jobKey} does not exist on Map targetToFlSyncJobs at handleScrapedResult`);
      }
      console.log('fd', 2.75, targetToFlSyncJobs);
      console.log('fd', 2.75, targetToFlSyncJobs.get(jobKey));
      targetToFlSyncJobs.delete(jobKey);
      console.log('fd', 3)

      let { data } = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs/${jobKey}`,
      }) as {data: JsonObject}
      let result = data.result as unknown as {[key: string]: any};
      console.log('fd', 4)

      let type = Object.keys(result || {})[0];
      if (!type) return;
      let key = Object.keys(result[type])[0];
      if (!key) return;
      console.log('fd', 5)

      //2. Move approved docs to trading partner /bookmarks
      info(`Moving approved document to [${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}]`);
      await CONNECTION.put({
        path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}`,
        data: {},
        tree
      });
      console.log('fd', 6)
      await CONNECTION.put({
        path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}`,
        data: { _id: result[type][key]._id },
      })
      console.log('fd', 7)
      endJob(jobId)
    } else {
      //Don't do anything; the job was already failed at the previous step and just marked in FL as Rejected.
      info(`Document [${item._id}] with status [${status}]. finishDoc skipping.`);
      return;
    }
  } catch(err) {
    console.log(err);
    throw err;
  }
}//finishDoc
*/

/**
 * resolves flSyncJobs such that jobs get succeeded
 * @param {*} jobId - the _id of the job tied to the promise entry
 * @param {*} msg - the
 * @return
 */
function endJob(jobId: string, message?: string | Error | JobError) {
  info(`Removing ${jobId} from fl-sync job-flSyncJobs index`);
  trace(`All flSyncJobs: ${flSyncJobs}`);
  const prom = flSyncJobs.get(jobId);
  if (prom) {
    if (message) {
      prom.reject(message);
    } else {
      prom.resolve(jobId);
    }
  }

  flSyncJobs.delete(jobId);
}

export interface TrellisCOI {
  _id: string;
  policies: {
    expire_date: string;
    cgl: GeneralLiability;
    al: AutoLiability;
    el: EmployersLiability;
    ul: UmbrellaLiability;
  };
}

interface GeneralLiability {
  'type': string;
  'each_occurrence': string;
  'general_aggregate': string;
  'products_-_compop_agg': string;
}

interface AutoLiability {
  type: string;
  combined_single_limit: string;
}

interface UmbrellaLiability {
  type: string;
  each_occurrence: string;
}

interface EmployersLiability {
  type: string;
  el_each_accident: string;
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
  updateFlId?: string | void
) {
  const policies = Object.values(result.policies);
  const cgl = (_.find(policies, ['type', 'Commercial General Liability']) ||
    {}) as GeneralLiability;
  const general = Number.parseInt(cgl.each_occurrence || '0');
  const aggregate = Number.parseInt(cgl.general_aggregate || '0');
  const product = Number.parseInt(cgl['products_-_compop_agg'] || '0');

  const al = (_.find(policies, ['type', 'Automobile Liability']) ||
    {}) as AutoLiability;
  const auto = Number.parseInt(al.combined_single_limit || '0');

  const ul = (_.find(policies, ['type', 'Umbrella Liability']) ||
    {}) as UmbrellaLiability;
  const umbrella = Number.parseInt(ul.each_occurrence || '0');

  const wc = _.find(policies, ['type', `Worker's Compensation`]);
  const worker = Boolean(wc);

  const element = (_.find(policies, ['type', `Employers' Liability`]) ||
    {}) as EmployersLiability;
  const employer = Number.parseInt(element.el_each_accident || '0');

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
        _id: assess.data._id,
        type: 'assessment',
      },
      {
        _id: flId,
        name,
        type: 'document',
      }
    );
  }

  return assess;
} // ConstructAssessment

/**
 * Gets the scraped JSON, perform document vs FL validation, and start an assessment
 * @param {*} targetJobKey
 */
async function handleScrapedResult(targetJobKey: string) {
  if (!targetToFlSyncJobs.has(targetJobKey)) {
    throw new Error(
      `targetJobKey ${targetJobKey} does not exist on Map targetToFlSyncJobs at handleScrapedResult`
    );
  }

  // 1. Get the fl-sync job for the document
  const { jobKey, jobId } = targetToFlSyncJobs.get(targetJobKey)!;

  try {
    // 1. Get the result content
    const { data: targetResult } = (await CONNECTION.get({
      path: `/resources/${targetJobKey}/result`,
    })) as { data: JsonObject };

    // TODO: Handle multiple results
    const type = Object.keys(targetResult || {})[0];
    if (!type || !targetResult[type]) return;
    const key = Object.keys(targetResult[type] || {})[0];
    if (!key) return;
    const targetResultItem = targetResult?.[type] as JsonObject;
    if (
      type &&
      key &&
      targetResultItem?.[key] &&
      isObj(targetResultItem?.[key])
    ) {
      const targetRes = targetResultItem?.[key] as JsonObject;
      info(`Job result: [type: ${type}, key: ${key}, _id: ${targetRes?._id}]`);
    }

    const result = await CONNECTION.get({
      path: `/resources/${targetJobKey}/result/${type}/${key}`,
    }).then((r) => r.data as unknown as TrellisCOI);

    // 2. Get the fl-sync job
    const configData = await CONNECTION.get({
      path: `/${jobId}/config`,
    }).then((r) => r.data as JsonObject);
    const {
      key: flId,
      name,
      bid,
      mirrorid,
      masterid,
      bname,
    } = configData as unknown as JobConfig;

    // 3. Fetch and validate the fl-mirror against the result
    const flMirrorData = await CONNECTION.get({
      path: `/${mirrorid}`,
    }).then((r) => r.data as JsonObject);
    if (!isObj(flMirrorData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`
      );
    }

    const flMirror = flMirrorData['food-logiq-mirror'] as unknown as FlObject;

    const validationResult = await validateResult(result, flMirror, type);

    info(
      `Validation of pending document result:[${result._id}]: ${validationResult.status}`
    );
    await CONNECTION.put({
      path: `/${jobId}`,
      data: {
        validation: validationResult,
      } as unknown as Body,
    });

    // 4a. Validation failed, fail and reject things.
    if (!validationResult || !validationResult.status) {
      await postUpdate(
        CONNECTION,
        jobId,
        `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejected FL Doc ${flId}: ${validationResult.message}`,
        'in-progress'
      );
      if (
        validationResult.message &&
        !validationResult?.message.includes(
          'Could not extract expiration dates'
        )
      ) {
        await rejectFlDocument(flId, validationResult?.message);
      }

      endJob(
        jobId,
        new JobError(validationResult?.message, 'document-validation')
      );
      return;
    }

    // 4b. Validation success. Generate the assessment and link things up.
    const flType = fromOadaType(type)!.name;
    if (flType && flTypes.has(flType) && flTypes.get(flType)!.assessments) {
      let assessmentId = await CONNECTION.get({
        path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}/id`,
      })
        .then((r) => r.data as string)
        .catch((error_) => {
          if (error_.status !== 404) throw error_;
        });

      if (assessmentId)
        info(
          `Assessment with id [${assessmentId}] already exists for document _id [${flId}].`
        );
      if (!assessmentId)
        info(`Assessment does not yet exist for document _id [${flId}.`);

      //      If (type === 'Certificate of Insurance' && assessmentId) {
      const assess = await constructCOIAssessment(
        flId,
        name,
        bid,
        bname,
        result,
        assessmentId
      );
      assessmentId = assessmentId || assess.data._id;
      info(`Spawned assessment [${assessmentId}] for business id [${bid}]`);
      //      }

      await postUpdate(
        CONNECTION,
        jobId,
        `Assessment spawned with id ${assessmentId} and linked into job /${jobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        'in-progress'
      );

      if (assessmentId) {
        assessmentToFlId.set(assessmentId, { jobId, mirrorid, flId });
        await CONNECTION.put({
          path: `/resources/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          data: { id: assessmentId } as Body,
        });
      }
    } else {
      info(`Skipping assessment for result of type [${flType}] [${type}]`);
    }

    info(
      `Job result stored at trading partner ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/${type}/${key}`
    );
  } catch (error_) {
    error(error_);
    throw error_;
  }
} // HandleScrapedResult

/**
 * rejects fl document
 */
async function rejectFlDocument(documentId: string, message?: string) {
  info(`Rejecting FL document [${documentId}]. ${message}`);
  // Post message regarding error
  await axios({
    method: 'post',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/capa`,
    headers: { Authorization: FL_TOKEN },
    data: {
      details: `${message} Please correct and resubmit.`,
      type: 'change_request',
    },
  });

  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/submitCorrectiveActions`,
    headers: { Authorization: FL_TOKEN },
    data: {},
  });

  // Reject to FL
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${documentId}/approvalStatus/rejected`,
    headers: { Authorization: FL_TOKEN },
    data: { status: 'Rejected' },
  });
} // RejectFlDoc

export async function startJobCreator(oada: OADAClient) {
  try {
    setConnection(oada);
    await CONNECTION.get({
      path: `${SERVICE_PATH}`,
    })
      .then((r) => r.data)
      .catch(async (error_) => {
        if (error_.status === 404) {
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

        throw error_;
      });

    console.log('Making documents listwatch', `${SERVICE_PATH}/businesses`);
    new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.documents.*.food-logiq-mirror`,
      name: `document-mirrored`,
      onItem: queueDocumentJob,
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
    });
    console.log('Done making documents listwatch');

    return new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.assessments.*.food-logiq-mirror`,
      name: `assessment-mirrored`,
      onItem: queueAssessmentJob,
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
    });
  } catch (error_) {
    error(error_);
    throw error_;
  }
} // StartJobCreator

async function queueAssessmentJob(change: ListChange, path: string) {
  try {
    // 1. Gather fl indexing, mirror data, fl document lookup, etc.
    info(`queueAssessmentJob processing mirror change`);
    const pieces = pointer.parse(path);
    const bid = pieces[0];
    const key = pieces[2]!;

    const itemData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`,
    }).then((r) => r.data as JsonObject);
    if (!isObj(itemData)) {
      throw new Error(
        `Could not retrieve 'food-logiq-mirror' from request data.`
      );
    }

    const item = itemData['food-logiq-mirror'] as unknown as FlObject;

    // Skip when there is no associated document job.
    // This may happen on startup with lots of assessments already sitting there.
    if (!assessmentToFlId.has(key)) {
      info(
        `No associated fl-sync document job could be found for assessment: ${item._id}`
      );
      return;
    }

    const { jobId: documentJob } = assessmentToFlId.get(key)!;

    const docJob = await CONNECTION.get({
      path: `/${documentJob}`
    }).then(r => r.data);
    //@ts-ignore
    let jConfig = docJob.config as unknown as JobConfig;

    if (!isObj(jConfig)) {
      throw new Error('Unexpected job config data');
    }

    const { key: flDocumentId, type: flDocumentType } = jConfig;
    if (!flDocumentType) {
      info(
        `Assessment [${item._id}] could not find fl doc type prior to queueing. Ignoring.`
      );
      return;
    }

    const assessmentType = item?.assessmentTemplate?.name;
    const docs = flTypes.get(flDocumentType)!;
    if (!assessmentType || !docs) {
      info(
        `Assessment type of [${item._id}] was of type [${assessmentType}]. Ignoring.`
      );
      return;
    }

    if (
      !docs.assessments ||
      !Object.keys(docs.assessments).includes(assessmentType)
    ) {
      info(
        `Assessment [${item._id}] was of type [${assessmentType}]. Ignoring.`
      );
      return;
    }

    const status = item.state;
    const approvalUser = item?.lastUpdate?.userId;
    const usersEqual = approvalUser === FL_TRELLIS_USER;
    info(
      `approvalInfo user ${
        usersEqual
          ? 'matches our user'
          : `[${approvalUser}] does not match our user: [${FL_TRELLIS_USER}]`
      }`
    );

    if (status === 'Submitted') {
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
            'rev': jConfig._rev,
            'flDocId': flDocumentId,
            'flDocType': flDocumentType,
            'flDocJobId': documentJob,
            'assessmentType': {
              id: item?.assessmentTemplate._id,
              name: item?.assessmentTemplate.name,
            },
          },
        },
      });
      const jobkey = headers['content-location']!.replace(/^\/resources\//, '');

      await CONNECTION.put({
        path: pending,
        tree,
        data: {
          [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
        },
      });
      info('Posted assessment job resource, jobkey = %s', jobkey);
      trace('Posted new fl-sync mirrored assessment job');

      // Add it to the parent fl-sync job
      await CONNECTION.put({
        path: `/${documentJob}/assessment-jobs`,
        data: {
          [jobkey]: {
            _id: `resources/${key}`,
          },
        },
      });
    } else if (status === 'Approved') {
      // Approved (by anyone). Clean up and remove after approval
      endJob(item._id);
      assessmentToFlId.delete(item._id);
      // Approve any linked jobs
      await approveFlDocument(flDocumentId);
      return;
      // } else if (item!.state === 'Rejected' && approvalUser === FL_TRELLIS_USER) {
    } else if (item.state === 'Rejected') {
      // 2b. Notify, clean up, and remove after rejection
      // @ts-ignore
      info("DOC", docJob)
      const reasons:string = _.get(docJob, 'fail-reasons') as unknown as string;

      const message = `A supplier Assessment associated with this document has
      been rejected for the following reasons: ${reasons}.`;
      // Reject the assessment job;
      endJob(item._id, message);
      assessmentToFlId.delete(item._id);
      info("REASONS", reasons);

      // Reject the FL Document with a supplier message; Reject the document fl-sync job
      if (flSyncJobs.get(documentJob)['allow-rejection'] !== false) {
        if (reasons) {
          await rejectFlDocument(flDocumentId, message);
        }
        endJob(
          documentJob,
          new JobError(message, 'associated-assessment-rejected')
        );
      } else {
        info(
          `Assessment ${item._id} failed logic, but cannot override approval. Calling finishDoc.`
        );
        await approveFlDocument(flDocumentId);
      }
    } else {
      // 2c. Job not handled by trellis system. Leave
      const message = `Assessment not pending, approval status not set by Trellis. Skipping. Assessment: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
      info(message);
      return;
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'queueAssessmentJob Failed',
      change.resource_id
    );
  }
} // QueueAssessmentJob

async function postJob(indexConfig: JobConfig) {
  const { headers } = await CONNECTION.post({
    path: '/resources',
    contentType: 'application/vnd.oada.job.1+json',
    data: {
      type: 'document-mirrored',
      service: SERVICE_NAME,
      config: indexConfig,
    } as unknown as Body,
  });
  const jobkey = headers['content-location']!.replace(/^\/resources\//, '');

  await CONNECTION.put({
    path: pending,
    tree,
    data: {
      [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
    },
  });

  // Store the job in the meta of the fl document
  await CONNECTION.put({
    path: `${SERVICE_PATH}/businesses/${indexConfig.bid}/documents/${indexConfig.key}/_meta`,
    data: {
      services: {
        'fl-sync': {
          jobs: {
            [jobkey]: { _id: `resources/${jobkey}` },
          },
        },
      },
    },
  });

  info('Posted document job resource, jobkey = %s', jobkey);
  trace('Posted new fl-sync mirrored document job');
}

async function queueDocumentJob(data: ListChange, path: string) {
  try {
    // 1. Gather fl indexing, mirror data, and trellis master id
    info(`queueDocumentJob processing mirror change`);
    const pieces = pointer.parse(path);
    const bid = pieces[0]!;
    const type = pieces[1];
    const key = pieces[2];

    const fullData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`,
    }).then((r) => r.data as JsonObject);

    const bus: any = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`,
    }).then((r) => r.data);

    if (!bus || !bus.masterid)
      error(`No trading partner found for business ${bid}.`);
    if (!bus || !bus.masterid) return;
    const { masterid } = bus;
    info(`Found trading partner masterid [${masterid}] for FL business ${bid}`);

    const item = fullData['food-logiq-mirror'] as unknown as FlObject;
    const documentType = pointer.has(item, `/shareSource/type/name`)
      ? pointer.get(item, `/shareSource/type/name`)
      : undefined;
    if (documentType && !flTypes.has(documentType)) {
      info(`Document [${item._id}] was of type [${documentType}]. Ignoring.`);
      return;
    }

    const status = item.shareSource && item.shareSource.approvalInfo.status;
    const approvalUser = _.get(item, `shareSource.approvalInfo.setBy._id`);
    info(
      `approvalInfo user: [${approvalUser}]. Trellis user: [${FL_TRELLIS_USER}]. Status: [${status}]. id: [${item._id}]`
    );

    if (status === 'awaiting-review') {
      // 2a. Create new job and link into jobs list and fl doc meta
      await postJob({
        'fl-sync-type': 'document',
        'type': documentType,
        'key': key!,
        bid,
        '_rev': data._rev as number,
        masterid,
        'mirrorid': fullData._id as string,
        'bname': item.shareSource.sourceBusiness.name,
        'name': item.name,
      });
    } else if (approvalUser === FL_TRELLIS_USER) {
      info(`Document ${item._id} approvalUser was Trellis. Calling finishDoc`);
      // 2b. Approved or rejected by us. Finish up the automation
      await finishDocument(item, bid, masterid, status);
    } else {
      // 2c. Document handled by others
      if (status === 'approved') {
        info(
          `Document ${item._id} approvalUser was not us. Status approved. Reprocessing what we can and usering to completion.`
        );
        // Run it through target and move it to trading-partner /bookmarks
        info(
          `Document ${item._id} bid ${bid} approved by user ${approvalUser}. Ushering document through to completion...`
        );
        await postJob({
          'allow-rejection': false,
          'fl-sync-type': 'document',
          'type': documentType,
          'key': key!,
          bid,
          '_rev': data._rev as number,
          masterid,
          'mirrorid': fullData._id as string,
          'bname': item.shareSource.sourceBusiness.name,
          'name': item.name,
        });
      } else {
        // If (status === "rejected" || status === "incomplete") {
        info(
          `Document ${item._id} approvalUser was not us. status !== approved. Skipping.`
        );
      }

      const message = `Document not pending, approval status not set by Trellis. Skipping. Document: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
      info(message);
      return;
    }
  } catch (cError: unknown) {
    throw oError.tag(cError as Error, 'queueDocumentJob Failed', data._id);
  }
}

export interface FlAssessment {
  _id: string;
  state: string;
  assessmentTemplate: {
    _id: string;
  };
  sections: Array<{
    subsections: Array<{
      questions: Array<{
        productEvaluationOptions: {
          columns: Array<{
            type: string;
            acceptanceType: string;
            acceptanceValueBool?: boolean;
            acceptanceValueNumericPrimary: number;
            name: string;
            statisticsNumeric: {
              average: number;
            };
            statisticsCommon: {
              percentWithinTolerance: number;
            };
            _id: string;
          }>;
          answerRows: Array<{
            answers: Array<{
              answerBool?: boolean;
              answerNumeric?: number;
            }>;
          }>;
        };
      }>;
    }>;
  }>;
}

export interface JobConfig {
  'fl-sync-type': 'document';
  '_rev': number;
  'type': string;
  'key': string;
  'bid': string;
  'masterid': string;
  'mirrorid': string;
  'bname': string;
  'name': string;
  'allow-rejection'?: boolean;
}

export interface FlObject {
  name: string;
  _id: string;
  state: string;
  lastUpdate: {
    userId: string;
  };
  assessmentTemplate: {
    _id: string;
    name: string;
  };
  performedOnBusiness: {
    _id: string;
  };
  shareSource: {
    approvalInfo: {
      status: string;
    };
    shareSpecificAttributes: {
      effectiveDate: string;
    };
    type: {
      name: string;
    };
    sourceBusiness: {
      name: string;
      _id: string;
      address: {
        addressLineOne: string;
        postalCode: string;
        city: string;
        region: string;
        country: string;
      };
    };
  };
  expirationDate: string;
}

interface Link {
  _id: string;
  _rev?: number | string;
}

type Links = Record<string, Link>;

export function isObj(thing: any) {
  return (
    typeof thing === 'object' &&
    !Buffer.isBuffer(thing) &&
    !Array.isArray(thing)
  );
}

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}
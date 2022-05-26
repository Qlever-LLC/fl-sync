if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import axios from 'axios';
import type {AxiosRequestConfig} from 'axios'
import ksuid  from 'ksuid';
import debug from 'debug';
import oError from '@overleaf/o-error';
import Promise from 'bluebird';
import _  from 'lodash';
import pointer from 'json-pointer';
import jszip from 'jszip';
import config from './config.js';
import tree from './tree.js';
import md5 from 'md5';
import type {TreeKey} from '@oada/list-lib/lib/tree'
import {validateResult} from './docTypeValidation.js';
import mirrorTree from './tree.mirrorWatch.js';
import checkAssessment from './checkAssessments.js';
import * as indexStuff from './index.js';
import {fromOadaType, flToTrellis} from './conversions.js';
import { linkAssessmentToDocument, spawnAssessment } from './assessments.js';
import type { Job, WorkerFunction } from '@oada/jobs';
import type { Change, JsonObject, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import {postUpdate, JobError} from '@oada/jobs';
import {ListWatch, Change as ListChange} from '@oada/list-lib';

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

let SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
let SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
let pending = `${SERVICE_PATH}/jobs/pending`;
let MASTERID_INDEX_PATH = `/bookmarks/trellisfw/trading-partners/masterid-index`;
let targetToFlSyncJobs = new Map<string, {jobKey: string, jobId: string}>();
let assessmentToFlId = new Map<string, {jobId: string, mirrorid: string, flId: string, assessmentJobId?: string}>();
let targetErrors = {
  "target-multiple-docs-combined": {
    patterns: [/This is a multi-.* File/i],
    reject: true,
    jobError: 'target-multiple-docs-combined',
  },
  'target-validation': {
    patterns: [/(Validation|Valiadation) Failed/i],
    reject: false,
    jobError: 'target-validation',
  },
  'target-unrecognized': {
    patterns: [/File format was not recognized/i, /^File is not a Textual PDF/i],
    reject: false,
    jobError: 'target-unrecognized',
  }
}
//let targetErrorTypes = {"multi-COI": "multi-coi"}
let flSyncJobs = new Map(); // Map of fl-sync jobs
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}
if (SERVICE_NAME && mirrorTree?.bookmarks?.services?.['fl-sync']) {
  mirrorTree.bookmarks.services[SERVICE_NAME] = mirrorTree.bookmarks.services['fl-sync'];
}
let CONNECTION : OADAClient;
//let flList = ['documents', 'products', 'locations', 'assessments'];
let multiFileOkay = [
  "Corrective Actions",
];
let flTypes = new Map(Object.entries({
  'Certificate of Insurance': {
    assessments: {
      'Certificate of Insurance (COI) Requirements': ASSESSMENT_TEMPLATE_ID,
    }
  },
  '100g Nutritional Information': {},
  'Specified Risk Materials (SRM) Audit': {
    assessments: {
      'Supplier Risk Acknowledgement': "61f97e7614a99d000e5ec310",
    }
  },
}));
const multipleFilesErrorMsg = 'Multiple files attached. Please upload a single PDF per Food LogiQ document.';
const attachmentsErrorMsg = 'Failed to retreive attachments';

function mostRecentKsuid(keys: Array<string>) {
  return keys.length > 0 ? keys.map(k => ksuid.parse(k))
  .reduce((a, b) => a.compare(b) > 0 ? a : b).string
  : undefined;
}

/**
 * searching and assigning target jobs to FL documents
 * @param {*} item 
 * @param {*} key 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/no-shadow
export async function getLookup(item: any, key: string) {
  try {
    let {_id} = item;
    key = key.replace(/^\//, '');
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return;
    let pdfId = item.config.pdf._id;
    if (!pdfId) return;
    info(`New target job [${key}]: Trellis pdf: [${pdfId}]`);

    // Fetch then store a mapping to the fl-sync job
    let data = await CONNECTION.get({
      path: `/${pdfId}/_meta`,
    }).then(r => JSON.parse((r?.data || "").toString()))

    let flJobKeys = Object.keys(data?.services?.['fl-sync']?.jobs || {})

    let jobKey = mostRecentKsuid(flJobKeys);
    if (!jobKey) throw new Error(`jobKey not found in _meta doc of the pdf [${pdfId}]`)

    let jobId = data?.services?.['fl-sync']?.jobs?.[jobKey]!._id

    let {data: { bid, key: docKey }} = await CONNECTION.get({
      path: `/${jobId}/config`
    }) as {data: JsonObject};
      
    targetToFlSyncJobs.set(key, {jobKey, jobId})

    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${docKey}/_meta`,
      data: {
        services: {
          target: {
            jobs: {
              [key]: {_id }
            }
          }
        }
      }
    })
    
    await CONNECTION.put({
      path: `/${jobId}/target-jobs`,
      data: {
        [key]: { _id }
      }
    })
    info(`Noted target job ${key} in fl-sync job ${jobId}`);
  } catch (err) {
    error(`Error associating new target job to FL documents`)
    error(err);
  }
}//getLookup

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
    let job = await CONNECTION.get({
      path: `/resources/${targetJobKey}`
    }).then(r => r.data as JsonObject);

    if (!targetToFlSyncJobs.has(targetJobKey)) {
      info(`No target job lookup for ${targetJobKey}`);
      return;
    }
    let {jobId} = targetToFlSyncJobs.get(targetJobKey)!;
    let key = await CONNECTION.get({
      path: `/${jobId}/config/key`
    }).then(r => r.data as string)

    // Handle final statuses
    await handleTargetStatus(change, key, targetJobKey, jobId, job)

    //Handle updates
    await handleTargetUpdates(change, key);

  } catch (err) {
    error('onTargetChange error: ');
    error(err);
    throw err;
  }
}//onTargetChange

async function handleTargetStatus(change: Change, key: string, targetJobKey: string, jobId: string, job: JsonObject) {
  let status = pointer.has(change, `/body/status`) ? pointer.get(change, `/body/status`) : undefined;
  if (!status) return;
  if (status === 'success') {
    await postUpdate(
      CONNECTION,
      jobId,
      'Target extraction completed. Handling result...',
      'in-progress'
    )
    await handleScrapedResult(targetJobKey)
    //targetToFlSyncJobs.delete(targetJobKey);
  } else if (status === 'failure') {
    await postUpdate(
      CONNECTION,
      jobId,
      'Target extraction failed',
      'in-progress'
    )

    let jobError;
    let errMsg = "Other Target failure";
    //Target failed and we have "updates". Otherwise, no "updates"; make it work.
    if (isObj(job) && job.updates) {
      //1. Find the update with the error message
      let errObj = (Object.values(job.updates).find(obj => obj.status === 'error'));
      if (errObj) errMsg = errObj!.information
      //2. Determine whether to reject the document based on target error type; others we'll need to review
      //3. Determine error indexing within fl-sync
      if (errObj && typeof errMsg === 'string') {
        let reject = false;
        Object.values(targetErrors).forEach(tErr => {
          if (tErr.patterns.some(p => p.test(errMsg))) {
            jobError = tErr.jobError;
            reject = tErr.reject === true;
          }
        })
        info(`Target job ${targetJobKey} errored. reject: ${reject}; fl-sync job error ${jobError}`)

        // Fail the document now instead of waiting for reject to come in from
        // the mirrormaker so that we can utilize the jobs error type now
        if (reject) await rejectFlDoc(key, errMsg);
        if (jobError) endJob(jobId, new JobError(errMsg, jobError));
      }
    }
    if (!jobError) endJob(jobId, new JobError(errMsg, 'target-other'));
    targetToFlSyncJobs.delete(targetJobKey);
  }
}

async function handleTargetUpdates(change: Change, key: string) {
  await Promise.each(Object.values(change && change.body && change.body.updates || {}), async (val: {status: string, information: string}) => {

    let details;
    switch (val.status) {
      case 'started':
        break;
      case 'error':
        details = val.information;
        break;
      case 'identified':
        break;
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
          type: "change_request",
        }
      })
    }
  })
}

/**
 * approves fl document
 * @param {*} docId 
 */
async function approveFlDoc(docId: string) {
  info(`Approving associated FL Doc ${docId}`);
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/approvalStatus/approved`,
    headers: { Authorization: FL_TOKEN },
    data: {
      status: "Approved"
    }
  });
}//approveFlDoc

/**
 * handles queued assessment-type jobs. Assessments should be treated as separate from the 
   documents as much as possible. 
 */
//@ts-ignore
export const handleAssessment: WorkerFunction = async (job: any, {oada, jobId: jobKey}) => {
  info(`Handling Assessment job ${jobKey}`);
  try {
    let jobId = `resources/${jobKey}`;
    let {bid, key } = job.config;
    let itemData = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`
    }).then(r => r.data as JsonObject)
    if (!isObj(itemData)) {
      throw new Error(`Could not retrieve 'food-logiq-mirror' from request data.`)
    }
    let item = itemData['food-logiq-mirror'] as unknown as FlAssessment;

    if (!item || !isObj(item)) return {};
    if (!item._id || !assessmentToFlId.has(item._id)) throw new Error(`assessmentToFlId does not exist for _id ${item._id}`);

    // 1. Create a job entry for the assessment
    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}/_meta`,
      data: {
        services: {
          'fl-sync': {
            jobs: {
              [jobKey]: {_id: jobId}, //assessment
            }
          }
        }
      }
    })

    let aaa = indexStuff.getAutoApprove();
    info(`Autoapprove Assessments Configuration: [${aaa}]`)
    if (aaa) {
      let {failed, reasons}: {failed: boolean, reasons: string[]} = checkAssessment(item);
      item!.state = failed ? 'Rejected' : 'Approved';
      await CONNECTION.put({
        path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        data: {
          approval: !failed
        }
      })
      info(`Assessment Auto-${item!.state}. [${item!._id}]`);
      await axios({
        method: 'put',
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${item!._id}/${failed ? 'reject' : 'approve'}spawnedassessment`,
        headers: { Authorization: FL_TOKEN },
        data: item
      })
      await postUpdate(
        CONNECTION,
        jobId,
        {},
        `Assessment auto-${item!.state}. [${item!._id}] ${failed ? `for these reasons: ${reasons.join(';')}`: ''}`,
        //TODO: is this an enumerated status?Should the above line get applied as the 'meta'?
        //'in-progress'
      )
      //TODO: Resolve this
      // fail/succeed the job
      if (!failed) {
    //    return { assessmentState: item.state}
      } else {
     //   throw new Error('Assessment auto-rejected')
      }
    } else {
      // No auto-approve/reject set; leave it in limbo
    }
    return new Promise((resolve, reject) => {
      flSyncJobs.set(item._id, {
        resolve,
        reject
      })
    })
  } catch (err) {
    error('Error handleAssessment', err);
    throw err;
  }
}//handleAssessment

export async function postTpDocument({bid, item, oada, masterid}:{bid: string, item: FlObject, oada: OADAClient, masterid: string}) {
  info(`postTpDocument: bid:${bid} item:${item._id}`);
  let type = item?.shareSource?.type?.name;
  // 1. Retrieve the attachments and unzip
  let request: AxiosRequestConfig = {
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item!._id}/attachments`,
    headers: { Authorization: FL_TOKEN },
    //@ts-ignore
    responseEncoding: 'binary'
  }

  let file = await axios(request)
    .then(r => r.data)
    .catch(err => {
      if (err.status === 404) {
        throw new JobError(attachmentsErrorMsg, 'bad-fl-attachments')
      } else throw err;
    })

  let zip = await new jszip().loadAsync(file);

  let files = Object.keys(zip.files)

  if (files.length !== 1) {
    throw new JobError(multipleFilesErrorMsg, 'multi-files-attached')
    if (!multiFileOkay.includes(type)) {
    }
  }

  let fKey = files[0];
  if (!fKey) throw new Error(`Failed to acquire file key while handling pending document`)
  //Make a hash of the file name because the file names themselves might not be
  //safe for oada or client
  let fileHash = md5(fKey);

  // 2. Fetch mirror and pdf resource id
  let mirrorid = await oada.get({
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_id`,
  }).then(r => r.data)

  let pdfResponse = await oada.get({
    path: `${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta/vdoc/pdf`,
  }).then(r => r.data as unknown as {[key: string]: any})
  .catch((err) => {
    if (err.status !== 404) throw err;
  });

  // 3a. PDF could already have been mirrored in the approval flow
  // If it doesn't exist, create a new PDF resource
  let pdfId: string = pdfResponse?.[fileHash]?._id || `resources/${ksuid.randomSync().string}`;

  let ab = await zip.file(fKey)!.async("uint8array")
  let zdata = Buffer.alloc(ab.byteLength);
  for (var i = 0; i < zdata.length; ++i) {
    zdata[i] = ab[i]!;
  }
  await oada.put({
    path: `/${pdfId}`,
    data: zdata,
    contentType: 'application/pdf',
  })

  // 4. Create a vdoc entry from the pdf to foodlogiq
  await oada.put({
    path: `${pdfId}/_meta`,
    data: {
      filename: fKey,
      vdoc: {
        foodlogiq: { _id: mirrorid }
      }
    } as Body,
    contentType: 'application/json',
  });


  // 5. Create a vdoc entry from the fl doc to the pdf
  // First, overwrite what is currently there if previous pdfs vdocs had been linked
  await axios({
    method: 'put',
    url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta`,
    data: {
      vdoc: {
        pdf: 0 // wipes out {key1: {}, key2: {}, etc.}
      }
    },
    headers: { 
      'content-type': 'application/json',
      authorization: `Bearer ${TRELLIS_TOKEN}`
    },
  });
  await axios({
    method: 'put',
    url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta`,
    data: {
      vdoc: {
        pdf: {
          [fileHash]: { _id: pdfId }
        }
      }
    },
    headers: { 
      'content-type': 'application/json',
      authorization: `Bearer ${TRELLIS_TOKEN}`
    },
  });
  let pdfKey = pdfId.replace(/resources\//, '');

  //6. Link the pdf into the unextracted documents list
  let {document, docType, urlName} = await flToTrellis(item)
  let docKey = await oada.post({
    path: `/resources`,
    data: document,
    contentType: docType
  }).then(r => r.headers['content-location']!.replace(/^\/resources\//,''));
  trace(`Partial JSON created at /resources/${docKey}`);

  await oada.put({
    path: `resources/${docKey}/_meta`,
//    path: `resources/${docKey}/_meta/vdoc/pdf/${fKey}`,
    data: {
      vdoc: { pdf: {[fileHash]: {_id: pdfId, _rev: 0 }}}}
  })
  info(`Pdf linked into /_meta/vdoc/pdf/${fileHash} of the partial json document.`);

  await oada.put({
    path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}`,
    data: {
      [docKey]: {_id: `resources/${docKey}`, _rev: 0 }
    },
    tree
  })
  info(`Created partial JSON in docs list: ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}/${docKey}`);

  return {pdfKey, docKey, item, urlName, docType, fKey, fileHash}
}

/**
 * handles documents pending approval
 * @param {*} job
 * @param {*} oada
 */
export const handlePendingDocument: WorkerFunction = async (job: Job, {oada, jobId: jobKey}: {oada: OADAClient, jobId: string}) => {
  let item: FlObject;
  let { bid, key, masterid } = job.config as unknown as JobConfig;
  let jobId: string = job.oadaId;
  try {
    info(`handlePendingDocument processing pending FL document [${key}]`);

    let itemData = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}`
    }).then(r => r.data as JsonObject);
    if (!isObj(itemData)) {
      throw new Error(`Could not retrieve 'food-logiq-mirror' from request data.`)
    }
    item = itemData['food-logiq-mirror'] as unknown as FlObject;

    if (!item || !isObj(item)) throw new Error(`Bad FlObject`);

    let {fileHash, urlName, docKey, docType} = await postTpDocument({bid, oada, item, masterid})
    await postUpdate(
      CONNECTION,
      jobId,
      `Document [key:${docKey}, type: ${docType}] posted to trading partner docs.`,
      'in-progress'
    )
    await CONNECTION.put({
      path: `${jobId}`,
      data: {
        trellisDoc: {
          key: docKey,
          type: docType
        }
      }
    })

    // Create reference from the pdf to the fl-sync job
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}/${docKey}/_meta/vdoc/pdf/${fileHash}/_meta`,
      data: {
        services: {
          'fl-sync': {
            jobs: {
              [jobKey]: { _id: jobId }
            }
          }
        }
      }
    })
    trace(`Creating link to fl-sync job in meta of ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${urlName}/${docKey}/_meta/vdoc/pdf/${fileHash}/_meta`);

    //Lazy create an index of trading partners' documents resources for monitoring.
    await CONNECTION.head({
      path: `${SERVICE_PATH}/monitors/tp-docs/${masterid}`
    }).catch(async (err) => {
      if (err.status === 404) {
        let tpDocsId = await CONNECTION.head({
          path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents`,
        }).then(r => r.headers['content-location']!.replace(/^\//,''));
        // Create a versioned link to that trading-partner's shared documents
        await CONNECTION.put({
          path: `${SERVICE_PATH}/monitors/tp-docs`,
          tree,
          data: {
            [masterid]: {
            _id: tpDocsId,
            _rev: 0
            }
          }
        })
      } else throw err;
    })

    return new Promise((resolve, reject) => {
      flSyncJobs.set(jobId, {
        resolve,
        reject
      })
    })
  } catch (err: any) {
    error(`handlePendingDocument errored`);
    error(err);
    if ([multipleFilesErrorMsg, attachmentsErrorMsg].includes(err.message)) {
      await CONNECTION.put({
        path: `/${jobId}`,
        data: {
          fl_data_validation: {
          status: false,
          message: err.message
          }
        }
      })
      await rejectFlDoc(item!._id, err.message)
      // Now let it continue below and throw; no promise gets made, but the job is failed now
    }
    throw err;
  }
}//handlePendingDoc


/**
 * Move approved documents into final location. Triggered by document re-mirror.
 * @param {*} item 
 * @param {*} bid 
 * @param {*} masterid 
 * @returns 
 */
async function finishDoc(item: FlObject, bid: string, masterid: string, status: string) {

  if (status === 'approved') {
    info(`Finishing doc: [${item._id}] with status [${status}] `);
    //1. Get reference of corresponding pending scraped pdf
    let jobs = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs`,
    }).then(r => r.data as unknown as Links);

    if (!jobs || !isObj(jobs)) throw new Error('Bad _meta target jobs during finishDoc');
    let jobKey = mostRecentKsuid(Object.keys(jobs));
    if (!jobKey || !jobs) throw new Error('Most recent KSUID Key had no link _id');
    //let jobId = jobs[jobKey]!._id;

    // Get FL-Sync job id then tidy targetToFlSyncJobs and resolve job promise
    if (!targetToFlSyncJobs.has(jobKey)) {
      throw new Error(`targetJobKey ${jobKey} does not exist on Map targetToFlSyncJobs at handleScrapedResult`);
    }
    //@ts-ignore
    let {jobId} = targetToFlSyncJobs.get(jobKey);
    targetToFlSyncJobs.delete(jobKey);

    let { data } = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs/${jobKey}`,
    }) as {data: JsonObject}
    let result = data.result as unknown as {[key: string]: any};

    let type = Object.keys(result || {})[0];
    if (!type) return;
    let key = Object.keys(result[type])[0];
    if (!key) return;

    //2. Move approved docs to trading partner /bookmarks
    info(`Moving approved document to [${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}]`);
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}`,
      data: {},
      tree
    });
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/documents/${type}/${key}`,
      data: { _id: result[type][key]._id },
    })
    endJob(jobId)
  } else {
    //Don't do anything; the job was already failed at the previous step and just marked in FL as Rejected.
    info(`Document [${item._id}] with status [${status}]. finishDoc not doing anything else. `);
  }
}//finishDoc

/**
 * resolves flSyncJobs such that jobs get succeeded
 * @param {*} jobId - the _id of the job tied to the promise entry
 * @param {*} msg - the
 * @return 
 */
function endJob(jobId: string, msg?: string | Error | JobError) {
  info(`Removing ${jobId} from fl-sync job-flSyncJobs index`);
  trace(`All flSyncJobs: ${flSyncJobs}`);
  let prom = flSyncJobs.get(jobId)
  if (msg) {
    prom.reject(msg)
  } else {
    prom.resolve(jobId)
  }
  flSyncJobs.delete(jobId);
  return;
}

export interface TrellisCOI {
  _id: string
  policies: {
    expire_date: string
    cgl: GeneralLiability;
    al: AutoLiability;
    el: EmployersLiability;
    ul: UmbrellaLiability;
  }
}

interface GeneralLiability {
  type: string
  each_occurrence: string
  general_aggregate: string
  "products_-_compop_agg": string
}

interface AutoLiability {
  type: string
  combined_single_limit: string
}

interface UmbrellaLiability {
  type: string
  each_occurrence: string
}

interface EmployersLiability {
  type: string
  el_each_accident: string
}

/**
 * builds assessment
 * @param {*} flId
 * @param {*} name
 * @param {*} bid
 * @param {*} result
 * @param {*} updateFlId
 * @returns
 */
async function constructCOIAssessment(flId: string, name: string, bid: string, bname: string, result: TrellisCOI, updateFlId?: string | void) {
  let policies = Object.values(result.policies);
  let cgl  = (_.find(policies, ['type', 'Commercial General Liability']) || {}) as GeneralLiability;
  let general = parseInt(cgl.each_occurrence || '0');
  let aggregate = parseInt(cgl.general_aggregate || '0');
  let product = parseInt(cgl["products_-_compop_agg"] || '0');

  let al = (_.find(policies, ['type', 'Automobile Liability']) || {}) as AutoLiability;
  let auto = parseInt(al.combined_single_limit || '0');

  let ul = (_.find(policies, ['type', 'Umbrella Liability']) || {}) as UmbrellaLiability;
  let umbrella = parseInt(ul.each_occurrence || '0');

  let wc = _.find(policies, ['type', `Worker's Compensation`]);
  let worker = wc ? true : false;

  let el = (_.find(policies, ['type', `Employers' Liability`]) || {}) as EmployersLiability;
  let employer = parseInt(el.el_each_accident || '0');

  let assess = await spawnAssessment(bid, bname, {general, aggregate, auto, product, umbrella, employer, worker, updateFlId});

  if (!updateFlId) {
    await linkAssessmentToDocument(CO_ID, {
      "_id": assess.data._id,
      "type": "assessment"
    }, {
      "_id": flId,
      "name": name,
      "type": "document"
    })
  }

  return assess;
}//constructAssessment

/**
 * Gets the scraped JSON, perform and final validation, and process the doc
 * @param {*} targetJobKey
 */
async function handleScrapedResult(targetJobKey: string) {
  if (!targetToFlSyncJobs.has(targetJobKey)) {
    throw new Error(`targetJobKey ${targetJobKey} does not exist on Map targetToFlSyncJobs at handleScrapedResult`);
  }

  //1. Get the fl-sync job for the document
  let {jobKey, jobId} = targetToFlSyncJobs.get(targetJobKey)!;

  try {
    // 1. Get the result content
    let {data: targetResult} = await CONNECTION.get({
      path: `/resources/${targetJobKey}/result`
    }) as {data: JsonObject};

    // TODO: Handle multiple results
    let type = Object.keys(targetResult || {})[0];
    if (!type || !targetResult[type]) return;
    let key = Object.keys(targetResult[type] || {})[0];
    if (!key) return;
    let targetResultItem = targetResult?.[type] as JsonObject;
    if (type && key && targetResultItem?.[key] && isObj(targetResultItem?.[key])) {
      let targetRes = targetResultItem?.[key] as JsonObject;
      info(`Job result: [type: ${type}, key: ${key}, _id: ${targetRes?._id}]`);
    }

    let result = await CONNECTION.get({
      path: `/resources/${targetJobKey}/result/${type}/${key}`,
    }).then(r => r.data as unknown as TrellisCOI)

    // 2. Get the fl-sync job
     let configData = await CONNECTION.get({
      path: `/${jobId}/config`
     }).then(r => r.data as JsonObject)
     let {key: flId, name, bid, mirrorid, masterid, bname} = configData as unknown as JobConfig;

    // 3. Fetch and validate the fl-mirror against the result
    let flMirrorData = await CONNECTION.get({
      path: `/${mirrorid}`
    }).then(r => r.data as JsonObject);
    if (!isObj(flMirrorData)) {
      throw new Error(`Could not retrieve 'food-logiq-mirror' from request data.`)
    }
    let flMirror = flMirrorData['food-logiq-mirror'] as unknown as FlObject;

    let validationResult = await validateResult(result, flMirror, type);

    info(`Validation of pending document result:[${result._id}]: ${validationResult!.status}`);
    await CONNECTION.put({
      path: `/${jobId}`,
      data: {
        validation: validationResult
      } as unknown as Body
    })

    // 4a. Validation failed, fail and reject things.
    if (!validationResult || !validationResult!.status) {
      await postUpdate(
        CONNECTION,
        jobId,
        `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejected FL Doc ${flId}: ${validationResult!.message}`,
        'in-progress'
      )
      await rejectFlDoc(flId, validationResult?.message)
      endJob(jobId, new JobError(validationResult?.message, 'document-validation'));
      return;
    } else {

      // 4b. Validation success. Generate the assessment and link things up.
      let flType = fromOadaType(type)!.name;
      if (flType && flTypes.has(flType) && flTypes.get(flType)!.assessments) {
        let assessmentId = await CONNECTION.get({
          path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}/id`
        }).then(r => r.data as string)
        .catch(err => {
          if (err.status !== 404) throw err;
        })

        if (assessmentId) info(`Assessment with id [${assessmentId}] already exists for document _id [${flId}].`)
        if (!assessmentId) info(`Assessment does not yet exist for document _id [${flId}.`)

  //      if (type === 'Certificate of Insurance' && assessmentId) {
          let assess = await constructCOIAssessment(flId, name, bid, bname, result, assessmentId);
          assessmentId = assessmentId || assess.data._id;
          info(`Spawned assessment [${assessmentId}] for business id [${bid}]`);
  //      }

        await postUpdate(
          CONNECTION,
          jobId,
          `Assessment spawned with id ${assessmentId} and linked into job /${jobId}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          'in-progress'
        )

        if (assessmentId) {
          assessmentToFlId.set(assessmentId, {jobId, mirrorid, flId})
          await CONNECTION.put({
            path: `${pending}/${jobKey}/assessments/${ASSESSMENT_TEMPLATE_ID}`,
            data: {id: assessmentId} as Body
          })
        }
      } else {
        info(`Skipping assessment for result of type [${flType}] [${type}]`);
      }
      info(`Job result stored at trading partner ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/${type}/${key}`)
    }
  } catch (err) {
    error(err);
    throw err;
  }
}//handleScrapedResult


/**
 * rejects fl document
 */
async function rejectFlDoc(docId: string, message?: string) {
  info(`Rejecting FL document [${docId}]. ${message}`);
//Post message regarding error
  await axios({
    method: 'post',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/capa`,
    headers: { Authorization: FL_TOKEN },
    data: {
      details: `${message} Please correct and resubmit.`,
      type: "change_request",
    }
  });

  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/submitCorrectiveActions`,
    headers: { Authorization: FL_TOKEN },
    data: {}
  });

  //reject to FL
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/approvalStatus/rejected`,
    headers: { Authorization: FL_TOKEN },
    data: { status: "Rejected" }
  });
}//rejectFlDoc

export async function startJobCreator(oada: OADAClient) {
  try {
    setConnection(oada);
    await CONNECTION.get({
      path: `${SERVICE_PATH}`,
    }).then(r => r.data)
    .catch(async (err) => {
      if (err.status === 404) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}`,
          data: {},
          tree
        })
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses`,
          data: {},
          tree
        })
        return {};
      } else throw err;
    })

    new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.documents.*.food-logiq-mirror`,
      name: `document-mirrored`,
      onAddItem: queueDocumentJob,
      onChangeItem: queueDocumentJob,
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
    })

    return new ListWatch({
      conn: CONNECTION,
      itemsPath: `$.*.assessments.*.food-logiq-mirror`,
      name: `assessment-mirrored`,
      onAddItem: queueAssessmentJob,
      onChangeItem: queueAssessmentJob,
      path: `${SERVICE_PATH}/businesses`,
      resume: true,
      tree: mirrorTree,
    })
  } catch (err) {
    error(err);
    throw err;
  }
} //startJobCreator

async function queueAssessmentJob(change: ListChange, path: string) {
  try {
    // 1. Gather fl indexing, mirror data, fl document lookup, etc.
    info(`queueAssessmentJob processing mirror change`);
    let pieces = pointer.parse(path);
    let bid = pieces[0];
    let key = pieces[2] as string;

    let itemData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`
    }).then(r => r.data as JsonObject);
    if (!isObj(itemData)) {
      throw new Error(`Could not retrieve 'food-logiq-mirror' from request data.`)
    }
    let item = itemData['food-logiq-mirror'] as unknown as FlObject;


    let { jobId:docJob } = assessmentToFlId.get(key)!;

    let {data} = await CONNECTION.get({
      path: `/${docJob}/config`
    }) as unknown as {data: JobConfig}

    if (!isObj(data)) {
      throw new Error('Unexpected job config data')
    }
    let {key: flDocId, type: flDocType} = data;
    if (!flDocType) {
      info(`Assessment [${item._id}] could not find fl doc type prior to queueing. Ignoring.`);
      return;
    }
    let assessmentType = item?.assessmentTemplate?.name;
    let docs = flTypes.get(flDocType)!;
    if (!assessmentType || !docs) {
      info(`Assessment type of [${item._id}] was of type [${assessmentType}]. Ignoring.`);
      return;
    }
    if (!docs.assessments || !Object.keys(docs.assessments).includes(assessmentType)) {
      info(`Assessment [${item._id}] was of type [${assessmentType}]. Ignoring.`);
      return;
    }
    let status = item.state;
    let approvalUser = item?.lastUpdate?.userId;
    let usersEqual = approvalUser === FL_TRELLIS_USER
    info(`approvalInfo user ${usersEqual ? 'matches our user' : `[${approvalUser}] does not match our user: [${FL_TRELLIS_USER}]`}`);

    if (status === 'Submitted') {
      //2a. Create assessment job, and link it into jobs list and fl document job reference
      const { headers } = await CONNECTION.post({
        path: '/resources',
        contentType: 'application/vnd.oada.job.1+json',
        data: {
          'type': 'assessment-mirrored',
          'service': SERVICE_NAME,
          'config': {
            "fl-sync-type": 'assessment',
            type: assessmentType,
            key,
            bid,
            rev: data._rev,
            flDocId,
            flDocType,
            flDocJobId: docJob,
            assessmentType: {
              id: item?.assessmentTemplate._id,
              name: item?.assessmentTemplate.name
            }
          },
        },
      });
      const jobkey = headers['content-location']!.replace(
        /^\/resources\//,
        ''
      );

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
        path: `/${docJob}/assessment-jobs`,
        data: {
          [jobkey]: {
            _id: `resources/${key}`
          }
        }
      })

    } else if (status === 'Approved') {
      //2b. Clean up and remove after approval

      endJob(item._id);
      assessmentToFlId.delete(item._id);
      // approve any linked jobs
      return approveFlDoc(flDocId);
    //} else if (item!.state === 'Rejected' && approvalUser === FL_TRELLIS_USER) {
    } else if (item!.state === 'Rejected') {
      //2b. Notify, clean up, and remove after rejection
      //TODO: Work on new message. This message doesn't really explain what caused the
      // assessment to be rejected in the first place. I.e., was it policy coverage of a particular type?
      // How ought we carry the information regarding why it was rejected forward
      // to now where we see the rejected assessment arrive?
      let message = `A supplier Assessment associated with this document has been rejected. Please resubmit a document that satisfies supplier requirements.`
      //Reject the assessment job;
      endJob(item._id as string, message);
      assessmentToFlId.delete(item._id);
      // Reject the FL Document with a supplier message; Reject the document fl-sync job
      rejectFlDoc(flDocId, message);
      endJob(flDocId, new JobError(message, "associated-assessment-rejected"));
    } else {
      //2c. Job not handled by trellis system. Leave
      let msg = `Assessment not pending, approval status not set by Trellis. Skipping. Assessment: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
      info(msg);
      return;
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'queueAssessmentJob Failed',
      change.resource_id
    );
  }
}//queueAssessmentJob

async function queueDocumentJob(data: ListChange, path: string) {
  try {
    //1. Gather fl indexing, mirror data, and trellis master id
    info(`queueDocumentJob processing mirror change`);
    let pieces = pointer.parse(path);
    let bid = pieces[0] as string;
    let type = pieces[1];
    let key = pieces[2];

    let fullData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`
    }).then(r => r.data as JsonObject)

    let bus : any = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`
    }).then(r =>r.data);

    if (!bus || !bus.masterid) error(`No trading partner found for business ${bid}.`)
    if (!bus || !bus.masterid) return;
    let {masterid} = bus;
    info(`Found trading partner masterid [${masterid}] for FL business ${bid}`)

    let item = fullData['food-logiq-mirror'] as unknown as FlObject;
    let documentType = pointer.has(item, `/shareSource/type/name`) ? pointer.get(item, `/shareSource/type/name`) : undefined;
    if (documentType && !flTypes.has(documentType)) {
      info(`Document [${item._id}] was of type [${documentType}]. Ignoring.`);
      return;
    }
    let status = item.shareSource && item.shareSource.approvalInfo.status;
    let approvalUser = pointer.has(item, `/shareSource/approvalInfo/setBy/_id`) ?  pointer.get(item, `/shareSource/approvalInfo/setBy/_id`) : undefined;
    info(`approvalInfo user: [${approvalUser}]. Trellis user: [${FL_TRELLIS_USER}]. Status: [${status}].`);

    if (status === 'awaiting-review') {
      //2a. Create new job and link into jobs list and fl doc meta
      const { headers } = await CONNECTION.post({
        path: '/resources',
        contentType: 'application/vnd.oada.job.1+json',
        data: {
          'type': 'document-mirrored',
          'service': SERVICE_NAME,
          'config': {
            "fl-sync-type": 'document',
            type: documentType,
            key,
            bid,
            rev: data._rev,
            masterid,
            mirrorid: fullData._id,
            bname: item.shareSource.sourceBusiness.name,
            name: item.name,
          },
        } as unknown as Body,
      });
      const jobkey = headers['content-location']!.replace(
        /^\/resources\//,
        ''
      );

      await CONNECTION.put({
        path: pending,
        tree,
        data: {
          [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
        },
      });

      //Store the job in the meta of the fl document
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}/_meta`,
        data: {
          services: {
            'fl-sync': {
              'jobs': {
                [jobkey]: {_id: `resources/${jobkey}`}
              }
            }
          }
        }
      })

      info('Posted document job resource, jobkey = %s', jobkey);
      trace('Posted new fl-sync mirrored document job');

    } else if (approvalUser === FL_TRELLIS_USER) {
      // 2b. Approved or rejected by us. Finish up the automation
      return finishDoc(item, bid, masterid, status);
    } else {
      // 2c. Document handled by others
      // TODO: Finish Approved Documents as if they were completed by Trellis.
      // Go ahead and run the full fl-sync flow
      let msg = `Document not pending, approval status not set by Trellis. Skipping. Document: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
      info(msg);
      return;
    }

  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'queueJob Failed',
      data._id
    );
  }
}

export interface FlAssessment {
  _id: string;
  state: string;
  assessmentTemplate: {
    _id: string;
  }
  sections: Array<{
    subsections: Array<{
      questions: Array<{
        productEvaluationOptions: {
          columns: Array<{
            type: string;
            acceptanceType: string;
            acceptanceValueNumericPrimary: number;
            name: string,
            statisticsNumeric: {
              average: number
            }
            statisticsCommon: {
              percentWithinTolerance: number;
            }
          }>
          answerRows: Array<{
            answers: Array<{
              answerNumeric: number
            }>
          }>
        }
      }>
    }>
  }>
}

export interface JobConfig {
  _rev: number;
  type: string;
  key: string;
  bid: string;
  masterid: string;
  mirrorid: string;
  bname: string;
  name: string;
}

export interface FlObject {
  name: string;
  _id: string;
  state: string;
  lastUpdate: {
    userId: string
  }
  assessmentTemplate: {
    _id: string;
    name: string;
  }
  performedOnBusiness: {
    _id: string
  }
  shareSource: {
    approvalInfo: {
      status: string
    }
    shareSpecificAttributes: {
      effectiveDate: string;
    }
    type: {
      name: string
    }
    sourceBusiness: {
      name: string;
      _id: string;
      address: {
        addressLineOne: string;
        postalCode: string;
        city: string;
        region: string;
        country: string;
      }
    }
  }
  expirationDate: string
}

interface Link {
  _id: string;
  _rev?: number | string
}

interface Links {
  [key: string]: Link
}

export function isObj(thing: any) {
  return (typeof thing === 'object' && !Buffer.isBuffer(thing) && !Array.isArray(thing))
}

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

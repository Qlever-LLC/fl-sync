if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const axios = require('axios');
const ksuid = require('ksuid');
const debug = require('debug');
import oError from '@overleaf/o-error';
let Promise = require('bluebird');
const moment = require('moment');
const _ = require('lodash');
const pointer = require('json-pointer');
const jszip = require('jszip');
const config = require('./config').default;
let tree = require('./tree.js');
let mirrorTree = require('./tree.mirrorWatch');
let checkAssessments = require('./checkAssessments');
const indexStuff = require('./index')
const { linkAssessmentToDocument, spawnAssessment } = require('./assessments');
import type { WorkerFunction } from '@oada/jobs';
import type { OADAClient } from '@oada/client';
const {postUpdate} = require('@oada/jobs');
const {ListWatch} = require('@oada/list-lib');
const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const FL_TRELLIS_USER = config.get('foodlogiq.trellisUser');
const CO_ID = config.get('foodlogiq.community.owner.id');
//const flTypes = config.get('foodlogiq.supportedTypes');

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');
const trace = debug('fl-sync:mirror-watchtrace');

let SERVICE_PATH = config.get('service.path');
let SERVICE_NAME = config.get('service.name');
let MASTERID_INDEX_PATH = `/bookmarks/trellisfw/trading-partners/masterid-index`;
let targetJobToFlSyncJob = {};
let assessmentToFlId = {};
let promises = new Map();
tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
mirrorTree.bookmarks.services[SERVICE_NAME] = mirrorTree.bookmarks.services['fl-sync'];
let CONNECTION;
//let flList = ['documents', 'products', 'locations', 'assessments'];
let flTypes = {
  'Certificate of Insurance': {
    assessments: {
      'Certificate of Insurance (COI) Requirements': ASSESSMENT_TEMPLATE_ID,
    }
  }
}

function mostRecentKsuid(keys) {
  return keys.map(k => ksuid.parse(k))
  .reduce((a, b) => a.compare(b) > 0 ? a : b).string
}

/**
 * searching and assigning target jobs to FL documents
 * @param {*} item 
 * @param {*} key 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/no-shadow
async function getLookup(item: any, key: string) {
  try {
    let targetJobKey = key;
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return;
    let trellisId = item.config.pdf._id;
    if (!trellisId) return;
    info(`New target job [${targetJobKey}]: Trellis pdf: [${trellisId}]`);

    //Store a mapping to the fl-sync job
    let data = await CONNECTION.get({
      path: `/${trellisId}/_meta`,
    }).then(r => JSON.parse(r.data.toString()))

    let flJobKeys = Object.keys(data?.services?.['fl-sync']?.jobs || {})

    let jobKey = mostRecentKsuid(flJobKeys);

    let jobId = data?.services?.['fl-sync']?.jobs?.[jobKey]!._id
      
    targetJobToFlSyncJob[targetJobKey] = {
      jobKey,
      jobId,
    }
    
    let {key:flId, bid } = await CONNECTION.get({
      path: `/${jobId}`
    }).then(r => r.data.config);

    await CONNECTION.put({
      path: `/${jobId}/target-jobs`,
      data: {
        [key.replace(/^\//, '')]: {
          _id: `resources${key}`
        }
      }
    })

    // Store the job with the FL document
    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${flId}/_meta`,
      data: {
        services: {
          target: {
            jobs: {
              [key.replace(/^\//, '')]: {
                _id: item._id
              }
            }
          }
        }
      }
    })
  } catch (err) {
    error(`Error associating new target job to FL documents`)
    error(err);
  }
}//getLookup

/**
 * handling an update from target
 * @param {*} c 
 * @param {*} targetJobId 
 * @returns 
 */
async function onTargetUpdate(change, targetJobKey) {
  trace(`Recieved update for job [${targetJobKey}]`);
  try {
    let job = await CONNECTION.get({
      path: `/resources${targetJobKey}`
    }).then(r => r.data.config);

    if (!targetJobToFlSyncJob[targetJobKey]) {
      info(`No target job lookup for ${targetJobKey}`);
      return;
    }
    let {jobId} = targetJobToFlSyncJob[targetJobKey];
    let {key} = await CONNECTION.get({
      path: `/${jobId}`
    }).then(r => r.data.config);

    // Handle finished target results 
    let status = pointer.has(change, `/body/status`) ? pointer.get(change, `/body/status`) : undefined;
    if (status === 'success') {
      await postUpdate(
        CONNECTION, 
        jobId, 
        'Target extraction completed. Handling result...',
        'in-progress'
      )
      await handleScrapedResult(targetJobKey)
      delete targetJobToFlSyncJob[targetJobKey];
    } else if (status === 'failure') {
      await postUpdate(
        CONNECTION, 
        jobId, 
        'Target extraction failed',
        'in-progress'
      )
      // Only reject certain target failures. Others we'll need to review!
      if (job.targetError.includes('multi-COI')) {
        await rejectFlDoc(key, job.targetError);
      }
      resolvePromise(key, false);
      delete targetJobToFlSyncJob[targetJobKey];
    }
      
    // Provide select update messages to FL
    await Promise.each(Object.values(change && change.body && change.body.updates || {}), async val => {

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
  } catch (err) {
    error('onTargetUpdate error: ');
    error(err);
    throw err;
  }
}//onTargetUpdate

/**
 * approves fl document
 * @param {*} docId 
 */
async function approveFlDoc(docId) {
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
 * checks assessment
 * @param {*} assessment 
 * @returns 
 */
function checkAssessment(assessment) {
  info(`Checking assessment ${assessment._id}`);

  let {_id} = assessment?.assessmentTemplate;

  if (checkAssessments[_id]) {
    return checkAssessments[_id](assessment);
  }
  let reasons : string[] = [];
  let failed = assessment.sections.map(section => {
    return section.subsections.map(subsection => {
      return subsection.questions.map(question => {
        return question.productEvaluationOptions.columns.map(column => {
          // Handle columns that aren't scored
          if (column.acceptanceType === "none") return false;
          let res = column.statisticsCommon.percentWithinTolerance < 100
          if (res) {
            let reason = `${column.name}(${column.statisticsNumeric.average}) did not meet the requirement (${column.acceptanceValueNumericPrimary})`
            reasons.push(reason);
          }
          return res
        })
      })
    });
  }).flat(5).some(i => i)
  return {failed, reasons}
}//checkAssessment

/**
 * handles queued assessment-type jobs. Assessments should be treated as separate from the 
   documents as much as possible. 
 */
//@ts-ignore
export const handleAssessment: WorkerFunction = async (job: any, {oada, jobId: jobKey}) => {
  info(`Handling Assessment job ${jobKey}`);
  try {
    let jobId = `resources/${jobKey}`;
    let {bid, key, flDocId } = job.config;
    let item = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`
    }).then(r => r.data!['food-logiq-mirror'])

    if (Buffer.isBuffer(item) || Array.isArray(item) || item === undefined || item === null || typeof item !== 'object') return {};

    //Document the relationships here. Redundancy should not affect anything.

    await CONNECTION.put({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}/_meta`,
      data: {
        services: {
          'fl-sync': {
             documents: {
               flDocId
             }
          }
        }
      }
    })

    let aaa = indexStuff.getAutoApprove();
    info(`Autoapprove Assessments Configuration: [${aaa}]`)
    if (aaa) {
      let {failed, reasons} = checkAssessment(item);
      item!.state = failed ? 'Rejected' : 'Approved';
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${flDocId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        data: {
          services: {
            'fl-sync': {
              'assessments': {
                [ASSESSMENT_TEMPLATE_ID]: {
                  approval: !failed
                }
              }
            }
          }
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
        'in-progress'
      )
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
      promises.set(item._id, {
        resolve,
        reject
      })
    })
  } catch (err) {
    error('Error handleAssessment', err);
    throw err;
  }
}//handleAssessment

/**
 * handles documents pending approval
 * @param {*} item 
 * @param {*} bid 
 * @param {*} masterid 
 * @param {*} status 
 * @param {*} _rev
 */
export const handlePendingDocument: WorkerFunction = async (job: any, {oada, jobId: jobKey}) => {
  try {
    let {bid, key, masterid } = job.config;
    info(`handlePendingDocument processing pending FL document [${key}]`);

    let item = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}`
    }).then(r => r!.data!['food-logiq-mirror'])

    if (Buffer.isBuffer(item) || Array.isArray(item) || item === undefined || item === null || typeof item !== 'object') {
      return {};
    }

    //1. Retrieve relevant job info and store a reference to the job in the fl doc
    let response = await oada.get({
      path: `${SERVICE_PATH}/jobs/${jobKey}`
    }).then(r => r.data)

    if (Buffer.isBuffer(response) || Array.isArray(response) || response === undefined || response === null || typeof response !== 'object') {
      throw new Error('Job was not a resource (had no _id)')
    }

    let jobId = response!._id

    // retrieve the attachments and unzip
    let file = await axios({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item!._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseEncoding: 'binary'
    }).then(r => r.data)
    .catch(err => {
      if (err.status === 404) {
        throw new Error('Failed to retrieve attachments')
      } else throw err;
    })

    let zip = await new jszip().loadAsync(file);

    let files = Object.keys(zip.files)

    //TODO: Make this a typed thing perhaps; e.g., maybe non-CoIs allow multiple pdfs
    if (files.length !== 1) {
      let message = 'Multiple files attached. Please upload a single PDF per Food LogiQ document.'
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta/services/fl-sync`,
        data: {
          services: {
            'fl-sync': {
              valid: {
                status: false,
                message
              }
            }
          }
        }
      })
      rejectFlDoc(item!._id, message)
      return new Promise((resolve, reject) => {
        promises.set(item._id, {
          resolve,
          reject
        })
      })
    }

    let fKey = files[0];
    if (!fKey) throw new Error(`Failed to acquire file key while handling pending document`)

    let mirrorid = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_id`,
    }).then(r => r.data)

    let _id = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta/vdoc/pdf`,
    }).then(r => {
      return r.data[fKey!]._id
    }).catch((err) => {
      if (err.status !== 404) throw err;
    });

    // If it doesn't exist, create a new PDF resource
    _id = _id || `resources/${ksuid.randomSync().string}`;

    let ab = await zip.file(fKey).async("uint8array")
    let zdata = Buffer.alloc(ab.byteLength);
    for (var i = 0; i < zdata.length; ++i) {
      zdata[i] = ab[i];
    }
    await CONNECTION.put({
      path: `/${_id}`,
      data: zdata,
      contentType: 'application/pdf',
    })

    await CONNECTION.put({
      path: `${_id}/_meta`,
      //TODO: How should this be formatted?
      data: {
        filename: fKey,
        services: {
          'fl-sync': {
            //@ts-ignore
            [item!._id]: {
              _ref: mirrorid,
            }
          }
        }
      },
      headers: { 'content-type': 'application/json' },
    });

    // Create a link from the FL mirror to the trellis pdf
    // First, overwrite what is currently there if previous pdfs vdocs had been linked
    await axios({
      method: 'put',
      url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item!._id}/_meta`,
      data: {
        vdoc: {
          pdf: 0
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
            [fKey]: { _id }
          }
        }
      },
      headers: { 
        'content-type': 'application/json',
        authorization: `Bearer ${TRELLIS_TOKEN}`
      },
    });

    let resId = _id.replace(/resources\//, '');

    //link the file into the documents list
    //!!! Making this a tree PUT (sometimes reintroduced to fix a broken tree) will break this link
    info(`Linking file to documents list at ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${resId}`);
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents`,
      data: { 
        [resId]: {_id, _rev: 0 }
      },
      tree
    })

    // Create a link from trellis pdf to the fl-sync job
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${resId}/_meta`,
      data: { 
        services: {
          'fl-sync': {
            jobs: {
              [jobKey]: {
                _id: jobId, 
                _rev: 0
              }
            }
          }
        }
      }
    })

    //Lazy create an index of trading partners' documents resources for monitoring.
    await CONNECTION.head({
      path: `${SERVICE_PATH}/monitors/tp-docs/${masterid}`
    }).catch(async (err) => {
      if (err.status === 404) {
        let tpDocsId = await CONNECTION.head({
          path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/documents/${resId}`,
        }).then(r => r.headers['content-location']!.replace(/^\/resources\//,''));

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
      promises.set(item._id, {
        resolve,
        reject
      })
    })
  } catch (err) {
    error(`Error occurred while fetching FL attachments`);
    error(err);
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
async function finishDoc(item, bid, masterid, status) {
  info(`Finishing doc: [${item._id}] with status [${status}] `);

  if (status === 'approved') {
    //1. Get reference of corresponding pending scraped pdf
    let keys = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs`,
    }).then(r => Object.keys(r.data));

    let jobKey = mostRecentKsuid(keys);

    let result = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/target/jobs/${jobKey}`,
    }).then(r => r.data.result)

    let type = Object.keys(result || {})[0];
    if (!type) return;
    let key = Object.keys(result[type])[0];
    if (!key) return;

    //2. Move approved docs to trading partner /bookmarks
    info(`Moving approved document to [${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/${type}/${key}]`);
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/${type}`,
      data: {},
      tree
    });
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/bookmarks/trellisfw/${type}/${key}`,
      data: { _id: result[type][key]._id },
    })
    resolvePromise(item._id, false)
  } else {
    resolvePromise(item._id, true)
    throw new Error(`Document had status [${status}]`);
  }
}//finishDoc

/**
 * resolves promises such that jobs get succeeded
 * @param {*} flId - the food logiq _id of the promise entry
 * @param {*} reject - whether or not to reject; otherwise it'll resolve
 * @return 
 */
async function resolvePromise(flId, reject?: boolean) {
  info(`Removing ${flId} from fl-sync job-promises index`);
  trace(`All promises: ${promises}`);
  let prom = promises.get(flId)
  if (reject) {
    prom.reject(flId)
  } else {
    prom.resolve(flId)
  }
  promises.delete(flId);
  return;
}

/**
 * validates documents that have not yet been approved
 * @param {*} trellisDoc 
 * @param {*} flDoc 
 * @param {*} type 
 * @returns 
 */
async function validateResult(trellisDoc, flMirror, type) {
  info(`Validating pending doc [${trellisDoc._id}]`);
  let message;
  let status = true;
  try {
    switch (type) {
      case 'cois':
        let flExp = moment(flMirror.expirationDate).format('YYYY-MM-DD');
        let policiesExp : any[] = Object.values(trellisDoc.policies)
          .map((obj:any) => moment(obj.expire_date).utcOffset(0))
        if (!policiesExp || !policiesExp[0]) return;
        let minimumExp = policiesExp.reduce(
          (prevExp, currentExp) => prevExp < currentExp ? prevExp : currentExp,
          policiesExp[0]
        ).format('YYYY-MM-DD');
//        let trellisExp = moment(policies[0].expire_date).utcOffset(0).format('YYYY-MM-DD');
        let now = moment().utcOffset(0).format('YYYY-MM-DD');

        if (flExp !== minimumExp) {
          message = `Expiration date submitted in Food Logiq (${flExp}) does not match the minimum expiration date found in the PDF document (${minimumExp}).`;
          status = false;
        }
        if (moment(flExp) <= now || minimumExp <= now) {
          message = `Document is already expired: ${flExp}`;
          status = false;
        }
        if (message) info(message);
        break;
      default:
        break;
    }
  } catch(err) {
    error('validateResult Errored: ', err);
    status = false;
    message = `validateResult Errored: ` + err.message;
  }
  info(`Validation of pending document [${trellisDoc._id}]: ${status}`);
  await CONNECTION.put({
    path: `/${trellisDoc._id}/_meta/services/fl-sync`,
    data: {
      valid: {
        status,
        message
      }
    }
  }).catch((err) => {
    error('validateResult PUT failed: ', err);
  })

  return { message, status };
}//validateResult

/**
 * builds assessment
 * @param {*} job 
 * @param {*} result 
 * @param {*} updateFlId 
 * @returns 
 */
async function constructCOIAssessment(flId, name, bid, bname, result, updateFlId) {
  let policies = Object.values(result.policies);
  let cgl = _.find(policies, ['type', 'Commercial General Liability']) || {};
  let general = parseInt(cgl.each_occurrence || 0);
  let aggregate = parseInt(cgl.general_aggregate || 0);
  let product = parseInt(cgl["products_-_compop_agg"] || 0);

  let al = _.find(policies, ['type', 'Automobile Liability']) || {};
  let auto = parseInt(al.combined_single_limit || 0);

  let ul = _.find(policies, ['type', 'Umbrella Liability']) || {};
  let umbrella = parseInt(ul.each_occurrence || 0);

  let wc = _.find(policies, ['type', `Worker's Compensation`]);
  let worker = wc ? true : false;

  let el = _.find(policies, ['type', `Employers' Liability`]) || {};
  let employer = parseInt(el.el_each_accident || 0);

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
 * handles scraped result
 * @param {*} targetJobKey 
 */
async function handleScrapedResult(targetJobKey) {
  let {jobId} = targetJobToFlSyncJob[targetJobKey];

  try {
    let targetResult = await CONNECTION.get({
      path: `/resources${targetJobKey}/result`
    }).then(r => r.data);

    // TODO: Assumes there is just one
    let type = Object.keys(targetResult || {})[0];
    if (!type) return;
    let key = Object.keys(targetResult[type])[0];
    if (!key) return;
//      job.result = { type, key, _id: targetResult[type][key]._id };
    if (type && key) {
      info(`Job result: [type: ${type}, key: ${key}, _id: ${targetResult[type][key]._id}]`);
    }

    // Follow the link
    let result = await CONNECTION.get({
      path: `/resources${targetJobKey}/result/${type}/${key}`,
    }).then(r => r.data)

    let {key: flId, name, bid, mirrorid, masterid, bname} = await CONNECTION.get({
      path: `/${jobId}`
    }).then(r => r.data.config)

    let data : any = {
      services: {
        'fl-sync': {
          document: { _id: mirrorid },
          flId, 
        }
      }
    };

    let flMirror = await CONNECTION.get({
      path: `/${mirrorid}`
    }).then(r => r.data['food-logiq-mirror'])

    let validationResult = await validateResult(result, flMirror, type);

    // If it passes validation, move on to the assessment
    if (validationResult && validationResult.status) {

      let assessmentId = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}/id`,
      }).then(r => r.data)
      .catch(err => {
        if (err.status !== 404) throw err;
      })

      if (assessmentId) info(`Assessment with id [${assessmentId}] already exists for document _id [${flId}].`)
      if (!assessmentId) info(`Assessment does not yet exist for document _id [${flId}.`)

      let assess = await constructCOIAssessment(flId, name, bid, bname, result, assessmentId);
      assessmentId = assessmentId || assess.data._id;

      await postUpdate(
        CONNECTION, 
        jobId, 
        `Assessment spawned with id ${assess.data._id} and link at /_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        'in-progress'
      )

      data.services['fl-sync'].assessments = {
        [ASSESSMENT_TEMPLATE_ID]: assessmentId
      }

      assessmentToFlId[assessmentId] = {jobId, mirrorid, flId};

      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${flId}/_meta`,
        data: {
          services: {
            'fl-sync': {
              assessments: {
                [ASSESSMENT_TEMPLATE_ID]: assessmentId
              }
            }
          }
        }
      })

      info(`Spawned assessment [${assessmentId}] for business id [${bid}]`);
    } else {
      await postUpdate(
        CONNECTION, 
        jobId, 
        `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejected FL Doc ${flId}: ${validationResult!.message}`,
        'in-progress'
      )
      await rejectFlDoc(flId, validationResult!.message)
      throw new Error(validationResult!.message)
    }

    info(`Job result stored at trading partner ${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/${type}/${key}`)

    // Add meta data to the trellis result document
    await CONNECTION.put({
      path: `${MASTERID_INDEX_PATH}/${masterid}/shared/trellisfw/${type}/${key}/_meta`,
      data
    })

  } catch (err) {
    error(err);
    throw err;
  }
}//handleScrapedResult


/**
 * rejects fl document
 */
async function rejectFlDoc(docId, message) {
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

async function startJobCreator(oada: OADAClient) {
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
      onAddItem: queueJob,
      onChangeItem: queueJob,
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

async function queueAssessmentJob(data, path) {
  try {
    info(`queueAssessmentJob processing mirror change`);
    let pieces = pointer.parse(path);
    let bid = pieces[0];
    let key = pieces[2];

    let fullData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/assessments/${key}`
    }).then(r => r.data)
    let item = fullData['food-logiq-mirror'];

    let { jobId } = assessmentToFlId[key];

    let {key: flDocId, type: flDocType} = await CONNECTION.get({
      path: `/${jobId}`
    }).then(r => r.data.config)
    if (!flDocType) {
      info(`Assessment [${item._id}] could not find fl doc type prior to queueing. Ignoring.`);
      return;
    }
    let assessmentType = item?.assessmentTemplate?.name;
    let docs = flTypes[flDocType];
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

      const { headers } = await CONNECTION.post({
        path: '/resources',
        contentType: 'application/vnd.oada.job.1+json',
        data: {
          'type': 'assessment-mirrored',
          'service': SERVICE_NAME,
          'config': {
            type: assessmentType,
            key,
            bid,
            rev: data._rev,
            flDocId,
            flDocType,
            flDocJobId: jobId,
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
        path: `${SERVICE_PATH}/jobs`,
        tree,
        data: {
          [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
        },
      });
      info('Posted assessment job resource, jobkey = %s', jobkey);
      trace('Posted new fl-sync mirrored assessment job');

      // Add it to the parent fl-sync job
      await CONNECTION.put({
        path: `/${jobId}/assessment-jobs`,
        data: {
          [jobkey]: {
            _id: `resources/${key}`
          }
        }
      })

    //} else if (status === 'Approved' && approvalUser === FL_TRELLIS_USER) {
    } else if (status === 'Approved') {
      resolvePromise(item._id, false);
      // approve any linked jobs
      return approveFlDoc(flDocId);
    //} else if (item!.state === 'Rejected' && approvalUser === FL_TRELLIS_USER) {
    } else if (item!.state === 'Rejected') {
      let message = `A supplier Assessment associated with this document has been rejected. Please resubmit a document that satisfies supplier requirements.`
      resolvePromise(item._id, true);
      return rejectFlDoc(flDocId, message);
    } else {
      let msg = `Assessment not pending, approval status not set by Trellis. Skipping. Assessment: [${item._id}] User: [${approvalUser}] Status: [${status}]`;
      info(msg);
      return;
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'queueAssessmentJob Failed',
      data._id
    );
  }
}

async function queueJob(data: any, path: string) {
  try {
    info(`queueJob processing mirror change`);
    let pieces = pointer.parse(path);
    let bid = pieces[0];
    let type = pieces[1];
    let key = pieces[2];

    let fullData = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`
    }).then(r => r.data)

    let bus : any = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`
    }).then(r =>r.data);

    if (!bus || !bus.masterid) error(`No trading partner found for business ${bid}.`)
    if (!bus || !bus.masterid) return;
    let {masterid} = bus;

    if (!masterid) error(`No trading partner found for business ${bid}.`)
    if (!masterid) return;
    info(`Found trading partner masterid [${masterid}] for FL business ${bid}`)

    let item = fullData['food-logiq-mirror'];
    let documentType = pointer.has(item, `/shareSource/type/name`) ? pointer.get(item, `/shareSource/type/name`) : undefined;
    if (documentType && !(Object.keys(flTypes).includes(documentType))) {
      info(`Document [${item._id}] was of type [${documentType}]. Ignoring.`);
      return;
    }
    let status = item.shareSource && item.shareSource.approvalInfo.status;
    let approvalUser = pointer.has(item, `/shareSource/approvalInfo/setBy/_id`) ?  pointer.get(item, `/shareSource/approvalInfo/setBy/_id`) : undefined;
    info(`approvalInfo user: [${approvalUser}]. Trellis user: [${FL_TRELLIS_USER}]. Status: [${status}].`);

    if (status === 'awaiting-review') {

      const { headers } = await CONNECTION.post({
        path: '/resources',
        contentType: 'application/vnd.oada.job.1+json',
        data: {
          'type': 'document-mirrored',
          'service': SERVICE_NAME,
          'config': {
            type: documentType,
            key,
            bid,
            rev: data._rev,
            masterid,
            mirrorid: fullData._id,
            bname: item.shareSource.sourceBusiness.name,
            name: item.name,
          },
        },
      });
      const jobkey = headers['content-location']!.replace(
        /^\/resources\//,
        ''
      );

      await CONNECTION.put({
        path: `${SERVICE_PATH}/jobs`,
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
                [jobkey]: {_ref: `resources/${jobkey}`}
              }
            }
          }
        }
      })

      info('Posted document job resource, jobkey = %s', jobkey);
      trace('Posted new fl-sync mirrored document job');

    } else if (approvalUser === FL_TRELLIS_USER) {
      // Approved or rejected by us. Finish up the automation
      return finishDoc(item, bid, masterid, status);
    } else {
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

function setConnection(conn) {
  CONNECTION = conn;
}

module.exports = {
  onTargetUpdate,
  getLookup,
  checkAssessment,
  validateResult,
  startJobCreator,
  handlePendingDocument,
  handleAssessment
}

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
const { getAutoApprove } = require('./index')
const { linkAssessmentToDocument, spawnAssessment } = require('./assessments');
import type { WorkerFunction } from '@oada/jobs';
import type { OADAClient } from '@oada/client';
const {postUpdate} = require('@oada/jobs');

const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const FL_TRELLIS_USER = config.get('foodlogiq.trellisUser');
const CO_ID = config.get('foodlogiq.community.owner.id');
const flTypes = config.get('foodlogiq.supportedTypes');

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');
const trace = debug('fl-sync:mirror-watchtrace');

let SERVICE_PATH = `/bookmarks/services/fl-sync`;
let TP_MPATH = `/bookmarks/trellisfw/trading-partners/masterid-index`;
let FL_SYNC_JOBS = new Map();// index of trellis pdf documents mapped to FL documents
let TARGET_JOBS = new Map();// index of target jobs mapped to FL documents
let docPromises = new Map();
let CONNECTION;

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
    info(`New target job [${targetJobKey}]: Trellis pdf: [${trellisId}]`);

    if (!trellisId) return;
    let pdfEntry = FL_SYNC_JOBS.get(trellisId);
    let flId = pdfEntry ? pdfEntry.flId : undefined;

    if (!flId) info(`No FL id found to associate to job [${targetJobKey}]`);
    if (!flId) return false;

    let obj = {
      targetJobKey,
      trellisId,
      targetJobId: item._id
    }
    Object.assign(obj, pdfEntry)
    TARGET_JOBS.set(targetJobKey, obj);
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
  let job = TARGET_JOBS.get(targetJobKey);

  if (!(job && job.flId)) info(`No FoodLogiQ document associated to job [${targetJobKey}]. Ignoring`)
  if (!(job && job.flId)) return;

  try {
    // Handle finished target results 
    let status = pointer.has(change, `/body/status`) ? pointer.get(change, `/body/status`) : undefined;
    if (status === 'success') {
      await postUpdate(
        CONNECTION, 
        job.jobId, 
        'Target extraction completed. Handling result...',
        'in-progress'
      )
      await handleScrapedResult(targetJobKey)
    } else if (status === 'failure') {
      await postUpdate(
        CONNECTION, 
        job.jobId, 
        'Target extraction failed',
        'in-progress'
      )
      if (job.targetError.includes('multi-COI')) {
        if (job.flStatus === 'awaiting-review') {
//          await rejectFlDoc(job.flId, job.targetError, job.flType);
        }
      }
      resolveDocument(job.trellisId, targetJobKey);
    }
      
    // Provide select update messages to FL
    await Promise.each(Object.values(change && change.body && change.body.updates || {}), async val => {

      let details;
      switch (val.status) {
        case 'started':
          break;
        case 'error':
          details = val.information;
          job.targetError = val.information;
          TARGET_JOBS.set(targetJobKey, job);
          break;
        case 'identified':
          break;
        case 'success':
          break;
        default:
          break;
      }
      if (details && job.flType && flTypes.includes(job.flType)) {
        info(`Posting new update to FL docId ${job.flId}: ${details}`);
        await axios({
          method: 'post',
          url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${job.flId}/capa`,
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
 * handles FL Location
 * @param {*} item 
 * @returns 
 */
async function handleFlLocation(item) {
  info(`Handling FL location ${item._id}. No handlers currently.`);
  return
}//handleFlLocation

/**
 * handles FL Product
 * @param {*} item 
 * @returns 
 */
async function handleFlProduct(item) {
  info(`Handling FL product ${item._id}. No handlers currently.`);
  return
}//handleFlProduct

/**
 * handling FL document
 * @param {*} item 
 * @param {*} bid businessid
 * @param {*} tp trading-partner
 * @param {*} bname business name
 */
async function handleFlDocument(item, bid, tp, bname, _rev, jobId) {
  info(`Handling fl document ${item._id}`)

  let flType = pointer.has(item, `/shareSource/type/name`) ? pointer.get(item, `/shareSource/type/name`) : undefined;
  if (flType && !flTypes.includes(flType)) {
    info(`Document [${item._id}] was of type [${flType}]. Ignoring.`);
    return;
  }

  let status = item.shareSource && item.shareSource.approvalInfo.status;

  let approvalUser = pointer.has(item, `/shareSource/approvalInfo/setBy/_id`) ?  pointer.get(item, `/shareSource/approvalInfo/setBy/_id`) : undefined;
  info(`approvalInfo user: [${approvalUser}]. Trellis user: [${FL_TRELLIS_USER}]`);

  if (status === 'awaiting-review') {
    return handlePendingDoc(item, bid, tp, bname, status, _rev, jobId)
  } else if (approvalUser === FL_TRELLIS_USER) {
    // Approved or rejected by us. Finish up the automation
    return finishDoc(item, bid, tp, bname, status, _rev);
  } else {
    // Process the document despite being handled by a SF user 
    info(`Document not pending, approval status not set by Trellis. Document: [${item._id}] User: [${approvalUser}] Status: [${status}]`);
    return handlePendingDoc(item, bid, tp, bname, status, _rev, jobId)
  }
}//handleFlDocument

/**
 * handles content mirrored into trellis via pollFL
 * TODO: Get rid of the GET in this handler; it should go away if change feeds are more consistent under
 * correct fix of tree PUT
 * @param {*} change 
 * @returns 
 */
export const jobHandler: WorkerFunction = async (job: any, {oada, jobId: jobKey}) => {
  try {
    info(`jobHandler processing FL resource`);
    let {bid, type, key, rev } = job.config;

    let response = await oada.get({
      path: `${SERVICE_PATH}/jobs/${jobKey}`
    }).then(r => r.data)
    let jobId;
    if (typeof response === 'object' && !Array.isArray(response) && !Buffer.isBuffer(response)) {
      jobId = response!._id
    } else throw new Error('Job was not a resource (had no _id)')


    let data = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`
    }).then(r => r.data)

    if (data && !data['food-logiq-mirror']) {
      error(`Business [${bid}] does not contain FL mirror data`)
      return;
    }

    let item = data && data['food-logiq-mirror'];

    let bus : any = await oada.get({
      path: `${SERVICE_PATH}/businesses/${bid}`
    }).then(r => r.data)
      .catch(() => {
        error(`TP masterid entry not found for business ${bid}`);
        return;
      });
    if (!bus || !bus.masterid) error(`No trading partner found for business ${bid}.`)
    if (!bus || !bus.masterid) return;
    let tp = bus.masterid;

    if (!tp) error(`No trading partner found for business ${bid}.`)
    if (!tp) return;
    info(`Found trading partner masterid [${tp}] for FL business ${bid}`)

    switch (type) {
      case 'documents':
        if (!pointer.has(data, '/food-logiq-mirror/shareSource/sourceBusiness/name')) {
          error('change does not have bname')
          return;
        }
        const bname = pointer.get(data, '/food-logiq-mirror/shareSource/sourceBusiness/name');
        return handleFlDocument(item, bid, tp, bname, rev, jobId);
        break;
      case 'locations':
        await handleFlLocation(item);
        break;
      case 'assessments':
        await handleAssessment(item)
        break;
      case 'product':
        await handleFlProduct(item);
        break;
      default:
        return;
    }//switch
  } catch (err) {
    error('Error handling mirror change', err);
    throw err;
  }
}//handleMirrorChange

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
 * checks COI assessment
 * @param {*} assessment 
 * @returns 
 */
function checkCoIAssessment(assessment) {
  info(`Checking COI assessment ${assessment._id}`);
  return assessment.sections.map(section => {
    return section.subsections.map(subsection => {
      return subsection.questions.map(question => {
        let umbrella = _.findIndex(question.productEvaluationOptions.columns, ['name', "Umbrella Coverage"])
        return question.productEvaluationOptions.columns.map((column, i) => {
          // Handle columns that aren't scored
          if (column.acceptanceType === "none") return false;
          if (column.statisticsCommon.percentWithinTolerance < 100 && column.name !== "Umbrella Coverage" && column.type === 'numeric') {
            let value = question.productEvaluationOptions.answerRows[0].answers[i].answerNumeric;
            let umbCov = question.productEvaluationOptions.answerRows[0].answers[umbrella].answerNumeric;
            let requirement = column.acceptanceValueNumericPrimary;
            // if umbrella only pertains to specific insurance types
            //            if (types.Handling assessmentindexOf(column.name) > -1) {}
            if (value !== undefined && umbCov !== undefined && requirement !== undefined) {
              return (value + umbCov < requirement);
            } else return true
          }
          return column.statisticsCommon.percentWithinTolerance < 100
        })
      })
    })
  }).flat(5).some(i => i)

}//checkCoIAssessment

/**
 * checks assessment
 * @param {*} assessment 
 * @returns 
 */
function checkAssessment(assessment) {
  info(`Checking assessment ${assessment._id}`);
  if (assessment.assessmentTemplate._id === ASSESSMENT_TEMPLATE_ID) {
    return checkCoIAssessment(assessment);
  }
  return assessment.sections.map(section => {
    return section.subsections.map(subsection => {
      return subsection.questions.map(question => {
        return question.productEvaluationOptions.columns.map(column => {
          // Handle columns that aren't scored
          if (column.acceptanceType === "none") return false;
          return column.statisticsCommon.percentWithinTolerance < 100
        })
      })
    });
  }).flat(5).some(i => i)
}//checkAssessment

/**
 * handles assessment
 */
async function handleAssessment(item) {
  info(`Handling assessment [${item._id}]`)

  let found = _.filter(Array.from(TARGET_JOBS.values()), (o) => _.has(o, ['assessments', item._id])) || [];
  await Promise.each(found, async (job) => {
    if (item.state === 'Approved') {
      job.assessments[item._id] = true;
      TARGET_JOBS.set(job.targetJobKey, job)
      await approveFlDoc(job.flId);
      await postUpdate(
        CONNECTION,
        job.jobId,
        `Approved FL Doc ${job.flId}`,
        'in-progress'
      )
    } else if (item.state === 'Rejected') {
      job.assessments[item._id] = false;
      TARGET_JOBS.set(job.targetJobKey, job)
      let message = `A supplier Assessment associated with this document has been rejected. Please resubmit a document that satisfies supplier requirements.`
      // TODO: Only do this if it has a current status of 'awaiting-review'
      if (job.flStatus === 'awaiting-review') {
        await rejectFlDoc(job.flId, message, job.flType);
        await postUpdate(
          CONNECTION,
          job.jobId,
          `Rejected FL Doc ${job.flId} because associated assessment [${item._id}] was rejected.`,
          'in-progress'
        )
      }
    } else if (item.state === 'Submitted') {
      let aaa = getAutoApprove();
      info(`Autoapprove Assessments Configuration: [${aaa}]`)
      if (aaa) {
        try {
          let failed = checkAssessment(item);
          item.state = failed ? 'Rejected' : 'Approved';
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
            data: {approval: !failed}
          })
          // Auto-approve only, do not auto-reject
//          if (!failed) {
            info(`Assessment Auto-${item.state}. [${item._id}]`);
            await axios({
              method: 'put',
              url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${item._id}/${failed ? 'reject' : 'approve'}spawnedassessment`,
              headers: { Authorization: FL_TOKEN },
              data: item
            })
            await postUpdate(
              CONNECTION,
              job.jobId,
              {},
              `Assessment auto-${item.state}. [${item._id}]`,
              'in-progress'
            )
          //} else info(`Assessment ${item._id} failed checkAssessment`);
        } catch (err) {
          error(err)
          throw err;
        }
      } else {
        resolveDocument(job.trellisId, job.targetJobKey);
      }
    }
  })
}//handleAssessment

/**
 * handles documents pending approval
 * @param {*} item 
 * @param {*} bid 
 * @param {*} tp 
 * @param {*} bname 
 * @param {*} status 
 * @param {*} _rev
 */
async function handlePendingDoc(item, bid, tp, bname, status, _rev, jobId) {
  info(`Handling pending document [${item._id}]`);
  try {
    let flType = pointer.has(item, `/shareSource/type/name`) ? pointer.get(item, `/shareSource/type/name`) : undefined;

    // retrieve the attachments and unzip
    let file = await axios({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseEncoding: 'binary'
    }).then(r => r.data);

    let zip = await new jszip().loadAsync(file);

    let files = Object.keys(zip.files)

    if (files.length !== 1) {
      let message = 'Multiple files attached. Please upload a single PDF per Food LogiQ document.'
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/fl-sync`,
        data: {
          valid: {
            status: false,
            message
          },
        }
      })
      if (status === 'awaiting-review') {
        return rejectFlDoc(item._id, message, flType)
      }
    }

    let key = files[0];
    if (!key) throw new Error(`Failed to acquire file key while handling pending document`)

    let mirrorId = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_id`,
    }).then(r => r.data)

    let _id = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/vdoc/pdf`,
    }).then(r => {
      return r.data[key!]._id
    })
    .catch((err) => {
      if (err.status !== 404) throw err;
    });

    // If it doesn't exist, create a new PDF resource
    _id = _id || `resources/${ksuid.randomSync().string}`;

    let ab = await zip.file(key).async("uint8array")
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
        filename: key,
        services: {
          'fl-sync': {
            [item._id]: {
              _ref: mirrorId,
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
      url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
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
      url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
      data: {
        vdoc: {
          pdf: {
            [key]: { _id }
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
    await CONNECTION.put({
      path: `${TP_MPATH}/${tp}/shared/trellisfw/documents/${resId}`,
      data: { _id, _rev: 0 }
    })

    // Create a lookup in order to track target updates
    info(`Creating lookup: Trellis: [${_id}]; FL: [${item._id}]`)
    FL_SYNC_JOBS.set(_id, {
      jobId,
      name: item.name,
      tp,
      flId: item._id,
      pdfId: _id,
      mirrorId,
      bid,
      bname,
      trellisDocKey: resId,
      trellisId: _id,
      flType,
      flStatus: status,
      statusUser: item.shareSource.approvalInfo.setBy,
    })
    info(`Linking file to documents list at ${TP_MPATH}/${tp}/shared/trellisfw/documents/${resId}: ${JSON.stringify(FL_SYNC_JOBS.get(_id), null, 2)}`);
    info(`Time is: ${moment().format('X')}`);

    return new Promise((resolve, reject) => {
      docPromises.set(_id, {
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
 * @param {*} tp 
 * @returns 
 */
async function finishDoc(item, bid, tp, bname, status, _rev) {
  info(`Finishing doc: [${item._id}] with status [${status}] `);
  //1. Get reference of corresponding pending scraped pdf
  let job = _.find(Array.from(TARGET_JOBS.values()), ['flId', item._id])

  if (!job || !job.result) {
    info(`Document not currently actively being processed: [${item._id}]. Sending back through the flow...`);
    await handlePendingDoc(item, bid, tp, bname, status, _rev, job.jobId)
  }
  job.approved = status === 'approved';
  TARGET_JOBS.set(job.targetJobKey, job);

  if (status === 'approved') {
    try {
      //2. 
      info(`Moving approved document to [${TP_MPATH}/${tp}/bookmarks/trellisfw/${job.result.type}/${job.result.key}]`);

      await CONNECTION.put({
        path: `${TP_MPATH}/${tp}/bookmarks/trellisfw/${job.result.type}`,
        data: {},
        tree
      });
      await CONNECTION.put({
        path: `${TP_MPATH}/${tp}/bookmarks/trellisfw/${job.result.type}/${job.result.key}`,
        data: { _id: job.result._id },
      })
    } catch (err) {
      error('Error moving document result into trading-partner indexed docs')
      throw err;
    }
  }

  resolveDocument(job.trellisId, job.targetJobKey);
}//finishDoc

async function resolveDocument(trellisId, targetJobKey) {
  info(`Removing ${trellisId} from fl-sync PDF index`);
  info(`Removing ${targetJobKey} from fl-sync Jobs index`);
  let job = FL_SYNC_JOBS.get(trellisId);
  await postUpdate(
    CONNECTION,
    job.jobId,
    `Removing from fl-sync internal memory under trellisId ${trellisId}`,
    'in-progress'
  )
  FL_SYNC_JOBS.delete(trellisId)
  TARGET_JOBS.delete(targetJobKey)
  let prom = docPromises.get(trellisId)
  prom.resolve(trellisId)
  docPromises.delete(trellisId);
}

/**
 * validates documents that have not yet been approved
 * @param {*} trellisDoc 
 * @param {*} flDoc 
 * @param {*} type 
 * @returns 
 */
async function validatePending(trellisDoc, flDoc, type) {
  info(`Validating pending doc [${trellisDoc._id}]`);
  let message;
  let status = true;
  try {
    switch (type) {
      case 'cois':
        let flExp = moment(flDoc['food-logiq-mirror'].expirationDate).format('YYYY-MM-DD');
        let policies : any[] = Object.values(trellisDoc.policies);
        if (!policies || !policies[0]) return;
        let trellisExp = moment(policies[0].expire_date).utcOffset(0).format('YYYY-MM-DD');
        let now = moment().utcOffset(0).format('YYYY-MM-DD');

        if (flExp !== trellisExp) {
          message = `Expiration date (${flExp}) does not match PDF document (${trellisExp}).`;
          status = false;
        }
        if (moment(flExp) <= now) {
          message = `Document is already expired: ${flExp}`;
          status = false;
        }
        if (message) info(message);
        break;
      default:
        break;
    }
  } catch(err) {
    error('validatePending Errored: ', err);
    status = false;
    message = `validatePending Errored: ` + err.message;
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
    error('validatePending PUT failed: ', err);
  })

  return { message, status };
}//validatePending

/**
 * builds assessment
 * @param {*} job 
 * @param {*} result 
 * @param {*} updateFlId 
 * @returns 
 */
async function constructCOIAssessment(job, result, updateFlId) {
  let { bid, bname } = job;

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
      "_id": job.flId,
      "name": job.name,
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
  let job = TARGET_JOBS.get(targetJobKey);
  let flDoc;

  try {
    let targetResult = await CONNECTION.get({
      path: `/resources${targetJobKey}/result`
    }).then(r => r.data);

    // TODO: Assumes there is just one
    let type = Object.keys(targetResult || {})[0];
    if (!type) return;
    let key = Object.keys(targetResult[type])[0];
    if (!key) return;
    if (!job.result) {
      job.result = { type, key, _id: targetResult[type][key]._id };
      TARGET_JOBS.set(targetJobKey, job);
      if (type && key) {
        info(`Job result: [type: ${type}, key: ${key}, _id: ${targetResult[type][key]._id}]`);
      }

      let result = await CONNECTION.get({
        path: `/${job.targetJobId}/result/${type}/${key}`,
      }).then(r => r.data)

      flDoc = await CONNECTION.get({
        path: `${job.mirrorId}`
      }).then(r => r.data)

      let data : any = {
        services: {
          'fl-sync': {
            document: { _id: job.mirrorId },
            flId: job.flId
          }
        }
      };

      let validationResult = await validatePending(result, flDoc, job.result.type);

      if (validationResult && validationResult.status) {

        let assessmentId = await CONNECTION.get({
          path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}/id`,
        }).then(r => r.data)
          .catch(err => {
            if (err.status !== 404) throw err;
          })

        if (assessmentId) info(job, 'Assessment already exists.')
        if (!assessmentId) info(job, 'Assessment does not yet exist.')


        let assess = await constructCOIAssessment(job, result, assessmentId);


        if (!assessmentId) {
          assessmentId = assess.data._id;
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
            data: {id: assessmentId}
          })
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${job.bid}/assessments/${assess.data._id}/_meta/services/fl-sync/documents/${job.flId}`,
            data: job.flId
          })
        }

        await postUpdate(
          CONNECTION, 
          job.jobId, 
          `Assessment spawned with id ${assess.data._id} and link at /_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          'in-progress'
        )

        data.services['fl-sync'].assessments = {
          [ASSESSMENT_TEMPLATE_ID]: assessmentId
        }

        job.assessments = {
          [assessmentId]: false
        }
        TARGET_JOBS.set(job.targetJobKey, job)

        info(`Spawned assessment [${assessmentId}] for business id [${job.bid}]`);
      } else {
        if (job.flStatus === 'awaiting-review') {
          await rejectFlDoc(job.flId, validationResult!.message, job.flType)
          await postUpdate(
            CONNECTION, 
            job.jobId, 
            `Rejected FL Doc ${job.flId}: ${validationResult!.message}`,
            'in-progress'
          )
        }
        await CONNECTION.post({
          path: `/${job.targetJobId}/updates`,
          data: {
            time: moment().format('X'),
            information: `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejecting FL Document`,
          },
          contentType: tree.bookmarks.services['fl-sync'].jobs['*']._type,
        })
      }

      info(`Job result stored at trading partner ${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`)

      // Add meta data to the trellis result document
      await CONNECTION.put({
        path: `${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}/_meta`,
        data
      })
    }
  } catch (err) {
    error(err);
    throw err;
  }
}//handleScrapedResult


/**
 * rejects fl document
 */
async function rejectFlDoc(docId, message, flType) {
  if (flType && flTypes.includes(flType)) {
    info(`Rejecting FL document [${docId}]. ${message}`);
    //reject to FL
    await axios({
      method: 'put',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/approvalStatus/rejected`,
      headers: { Authorization: FL_TOKEN },
      data: { status: "Rejected" }
    });

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
  }
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
    
    await CONNECTION.watch({
      path: `${SERVICE_PATH}`,
      tree,
      watchCallback: async (change) => {
        try {
          if (/\/businesses\/(.)+\/(.)+\/(.)+/.test(change.path)) {
            if (change.body['food-logiq-mirror']) {
              // Queue up a new job
              await queueJob(change);
            } 
          }
        } catch (err) {
          error('mirror watchCallback error');
          error(err);
          throw err;
        }
      }
    }).then(() => {
      info(`startJobCreator watch started`);
    }).catch(err => {
      error(err);
      throw err;
    });
  } catch (err) {
    error(err);
    throw err;
  }
}//watchFlSyncConfig

async function queueJob(change) {
  info(`queueJob processing mirror change`);
  let pieces = pointer.parse(change.path);
  let bid = pieces[1];
  let type = pieces[2];
  let key = pieces[3];
  console.log(bid, type, key, change.body._rev);

  let data = await CONNECTION.get({
    path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`
  }).then(r => r.data)

  if (!data['food-logiq-mirror']) {
    error(`Business [${bid}] does not contain FL mirror data`)
    return;
  }
  let item = data['food-logiq-mirror'];

  try {
    const { headers } = await CONNECTION.post({
      path: '/resources',
      contentType: 'application/vnd.oada.job.1+json',
      data: {
        'type': 'mirror-watch',
        'service': 'fl-sync',
        'config': {
          type,
          key,
          bid,
          rev: change.body._rev
        },
      },
    });
    const jobkey = headers['content-location']!.replace(
      /^\/resources\//,
      ''
    );

    try {
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/jobs`,
        tree,
        data: {
          [jobkey]: { _id: `resources/${jobkey}`, _rev: 0 },
        },
      });
      info('Posted job resource, jobkey = %s', jobkey);
      trace('Posted new fl-sync mirrored document job');
    } catch (cError: any) {
      console.log(cError);
      throw oError.tag(
        cError as Error,
        'Failed to PUT job link under fl-sync job queue for job key ',
        jobkey
      );
    }
  } catch (cError: unknown) {
    throw oError.tag(
      cError as Error,
      'Failed to create new job resource for item ',
      item._id
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
  validatePending,
  startJobCreator,
  jobHandler,
}

if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const axios = require('axios');
const ksuid = require('ksuid');
const debug = require('debug');
const trace = debug('fl-sync:trace');
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');
let Promise = require('bluebird');
const moment = require('moment');
const urlLib = require('url');
const _ = require('lodash');
const pointer = require('json-pointer');
const uuid = require('uuid');
const oada = require('@oada/client');
let config = require('./config').default;
const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const jszip = require('jszip');
const StreamZip = require('node-stream-zip');
const oadalist = require('@oada/list-lib');
//const sampleDocs = require('./sampleDocs.js');
const ListWatch = oadalist.ListWatch;
//const axios = mockFL;
let BUSINESSES = {};
let TradingPartners = {};
const FL_MIRROR = "food-logiq-mirror";
let tree = require('./tree.js');
const TL_TP = config.get('trellis.endpoints.tps');
const TL_UTP = config.get('trellis.endpoints.utps');
const TL_FL_BS = config.get('trellis.endpoints.fl-bus');
const JUST_TPS = config.get('trellis.justTps');
const MAX_RETRIES = 10;

// ======================  ASSESSMENTS ============================== {
const ASSESSMENT_BID = config.ASSESSMENT_BID;
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const ASSESSMENT_TEMPLATE_NAME = config.get('foodlogiq.assessment-template.name');
const CO_ID = config.get('foodlogiq.community.owner.id');
const CO_NAME = config.get('foodlogiq.community.owner.name');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const COMMUNITY_NAME = config.get('foodlogiq.community.name');
const CONCURRENCY = config.get('trellis.concurrency');
const flTypes = config.get('foodlogiq.supportedTypes');
const HANDLE_INCOMPLETE_INTERVAL = config.get('trellis.handleIncompleteInterval');
const LOCAL = process.env.LOCAL;
let PATH_DOCUMENTS = `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents`;
let ASSESSMENT_TEMPLATES = {};
let COI_ASSESSMENT_TEMPLATE_ID = null;
let AUTO_APPROVE_ASSESSMENTS;
let FL_WS;
let times = {};

const AssessmentType = Object.freeze(
  { "SupplierAudit": "supplier_audit", },
  { "SupplierQuestionnaire": "supplier_questionnaire" },
  { "InternalAudit": "internal_audit" },
);

// TODO: need to polish this code
// left here for reference
let assessment_template = {
  "assessmentTemplate": {
    "_id": ASSESSMENT_TEMPLATE_ID,
    "name": ASSESSMENT_TEMPLATE_NAME
  },
  "availableInCommunity": {
    "community": {
      "_id": COMMUNITY_ID,
      "name": COMMUNITY_NAME
    },
    "communityOwnerBusiness": {
      "_id": CO_ID,
      "name": CO_NAME
    }
  },
  "initiatedByBusiness": {
    "_id": CO_ID,
    "name": CO_NAME
  },
  "performedOnBusiness": {
    "_id": "605249563a720a000e4154ad",
    "name": "Centricity Test"
  },

  "name": "Insurance Requirements",
  "type": AssessmentType.SupplierAudit
};

// TODO: need to polish this code
// left here for reference
let answer_content = {
  "_id": "6091a3bed4e9d21beb000001",
  "answers": [
    {
      "column": "606cc7eff8014707de000012",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc83bf8014788eb000013",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc860f801475f03000014",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "6091a7361b70862ee2000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc887f80147f255000015",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606f661d2914d0eaff000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606f664b2914d09a5f000002",
      "answerText": null,
      "answerNumeric": null
    }
  ]
};

// ======================  ASSESSMENTS ============================== }

let trellisTPTemplate = {
  sapid: "",
  masterid: "",
  name: "",
  address: "",
  city: "",
  state: "",
  type: "CUSTOMER",
  coi_emails: "",
  fsqa_emails: "",
  email: "",
  phone: ""
};

let trellisfw_tp_tree = require('./trellis_tp_tree.js');
let TL_TP_PATH = TL_TP;
let TL_TP_UNIDENTIFIED_PATH = TL_UTP;

//const { getToken } = require(SHARED_PATH+'/service-user');

//const DOMAIN = config.get('fl-shared:domain') || 'https://localhost'
let TOKEN;
let CURRENTLY_POLLING = false;
let INTERVAL_MS = config.get('foodlogiq.interval') * 1000; //FL polling interval
let checkInterval = INTERVAL_MS / 2; //check OADA to determine if its time to poll
let lastPoll;
info(`Polling FL every ${INTERVAL_MS / 1000}s. Checking OADA if its time to poll every ${checkInterval / 1000}s.`);

let SERVICE_PATH = `/bookmarks/services/fl-sync`;
let TP_PATH = `/bookmarks/trellisfw/trading-partners`;
let TP_MPATH = `/bookmarks/trellisfw/trading-partners/masterid-index`;
let TPs;
let CONNECTION;

let TARGET_PDFS = {};// index of trellis pdf documents mapped to FL documents
let TARGET_JOBS = {};// index of target jobs mapped to FL documents

async function getToken() {
  return TRELLIS_TOKEN;
}

async function checkTime() {
  info('Checking OADA to determine whether to poll.');
  if (CURRENTLY_POLLING) {
    info('Currently polling already. Skipping this poll loop');
  } else {
    info('Not already polling. Starting now...');
    setCurrentlyPolling(true);

    let manualPoll;

    //Get last poll date
    try {
      let response = await CONNECTION.get({ path: `${SERVICE_PATH}` })

      let demoCleanup = response.data.cleanup || false;
      if (demoCleanup) {
        await cleanUpFlDocuments();
      }

      manualPoll = response.data.manualPoll || process.env.MANUAL_POLL;

      let freshPoll = process.env.FRESH_POLL;

      info(`/lastPoll endpoint found; last update was: ${response.data.lastPoll}`);
      if (!freshPoll && response.data.lastPoll) lastPoll = moment(response.data.lastPoll).utc();
    } catch (err) {
      if (err.status === 404) {
        info(`/lastPoll does not exist. Omitting versionUpdate param for a fresh poll.`);
      } else {
        error('An error occurred while fetching lastPoll date');
        setCurrentlyPolling(false);
        throw err;
      }
    }

    let current = moment().utc();
    let nextUpdate = (lastPoll ? lastPoll.clone() : current.clone()).add(INTERVAL_MS)
    info(`currentTime is ${current}, nextUpdate is ${nextUpdate}. ${!lastPoll ? 'lastPoll was undefined. Polling.' : current > nextUpdate ? 'Polling' : 'Not Polling'}`);
    if (manualPoll) info(`Manual poll detected. Getting changes since last poll`);
    if (!lastPoll || current > nextUpdate || manualPoll) {
      //    if (lastPoll) lastPoll = lastPoll.format('ddd, DD MMM YYYY HH:mm:ss +0000');
      current = current.format();
      try {
        info('Polling FL...')
        await pollFl();
      } catch (err) {
        error('An error occurred while polling');
        error(err);
        setCurrentlyPolling(false);
        throw err;
      }
      // 3. Success. Now store update the last checked time.
      info(`Storing new "lastPoll" value: ${current}. Next run will occur on or after this time.`);

      if (manualPoll) info(`Resetting manualPoll to false`)

      if (manualPoll) await CONNECTION.put({
        path: SERVICE_PATH,
        tree,
        data: { manualPoll: false }
      })

      setCurrentlyPolling(false);
      return CONNECTION.put({
        path: SERVICE_PATH,
        tree,
        data: { lastPoll: current }
      })
    }
    setCurrentlyPolling(false);
  }
}//checkTime

/**
 * searching and assigning target jobs to FL documents
 * @param {*} item 
 * @param {*} key 
 * @returns 
 */
async function getLookup(item, key) {
  try {
    let jobId = key;
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return;
    let trellisId = item.config.pdf._id;
    info(`New target job [${key}]: Trellis pdf: [${trellisId}]`);

    if (!trellisId) return;
    let flId = TARGET_PDFS[trellisId] && TARGET_PDFS[trellisId].flId;

    if (!flId) info(`No FL id found to associate to job [${jobId}]`);
    if (!flId) return false;

    TARGET_JOBS[key] = {
      jobId: key,
      trellisId,
    };
    Object.assign(TARGET_JOBS[key], TARGET_PDFS[trellisId])
    await CONNECTION.put({
      path: `${SERVICE_PATH}/process-queue/jobs${key}`,
      data: TARGET_JOBS[key]
    });

  } catch (err) {
    error(`Error associating new target job to FL documents`)
    error(err);
  }
}//getLookup


/**
 * manages message creation in FL, avoiding duplication 
 */
async function handleMessaging() {
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



/**
 * handling an update from target
 * @param {*} c 
 * @param {*} jobId 
 * @returns 
 */
async function onTargetUpdate(c, jobId) {
  info(`Recieved update for job [${jobId}]`);
  let job = TARGET_JOBS[jobId];

  if (!(job && job.flId)) info(`No FoodLogiQ document associated to job [${jobId}]. Ignoring`)
  if (!(job && job.flId)) return;

  try {
    // Handle finished target results 
    await Promise.each(Object.keys(c.body && c.body.result || {}), async type => {
      await Promise.each(Object.keys(c.body.result[type]), async key => {
        if (!TARGET_JOBS[jobId].result) {
          TARGET_JOBS[jobId].result = { type, key, _id: c.body.result[type][key]._id };
          await CONNECTION.put({
            path: `${SERVICE_PATH}/process-queue/jobs${jobId}`,
            data: { result: { type, key, _id: c.body.result[type][key]._id } }
          })
          await handleScrapedResult(jobId)
        }
      })
    })


    // Provide select update messages to FL
    await Promise.each(Object.values(c && c.body && c.body.updates || {}), async val => {

      let details;
      switch (val.status) {
        case 'started':
          details = 'PDF data extraction started...';
          break;
        case 'error':
          details = val.information
          break;
        case 'identified':
          if (val.type) {
            details = `PDF successfully identified as document type: ${val.type}`
          }
          break;
        case 'success':
          if (/^Runner/.test(val.meta)) details = 'Trellis automation complete.';
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
    await CONNECTION.put({
      path: `${SERVICE_PATH}/process-queue/jobs${jobId}`,
      data: {
        status: 'failed',
      }
    })
    throw err;
  }
}//onTargetUpdate

/**
 * watches FL config
 */
async function watchFlSyncConfig() {
  let data = await CONNECTION.get({
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
        await CONNECTION.put({
          path: `${SERVICE_PATH}/process-queue`,
          data: {},
          tree
        })
        return {};
      } else throw err;
    })
  info('Watching bookmarks/services/fl-sync.');
  setAutoApprove(data['autoapprove-assessments']);

  await CONNECTION.watch({
    path: `${SERVICE_PATH}`,
    tree,
    watchCallback: async (change) => {
      try {
        if (_.has(change.body, 'autoapprove-assessments')) {
          setAutoApprove(change.body['autoapprove-assessments']);
        } else if (/\/businesses\/(.)+\/(.)+\/(.)+/.test(change.path)) {
          if (change.body['food-logiq-mirror']) await handleMirrorChange(change)
        }
      } catch (err) {
        error('mirror watchCallback error');
        error(err);
      }
    }
  }).catch(err => {
    error(err);
  });
}//watchFlSyncConfig

/**
 * watches target jobs
 */
async function watchTargetJobs() {
  info(`Started ListWatch on jobs of the target service...`)
  const watch = new ListWatch({
    path: `/bookmarks/services/target/jobs`,
    name: `target-jobs-fl-sync`,
    conn: CONNECTION,
    resume: true,
    onAddItem: getLookup,
    onChangeItem: onTargetUpdate
  })
}//watchTargetJobs


/**
 * populates target pdfs and jobs - incomplete
 */
async function populateIncomplete() {
  let data = await CONNECTION.get({
    path: `${SERVICE_PATH}/process-queue`
  }).catch((err) => {
    if (err.status === 404) return;
    throw err;
  }).then(r => r.data);

  await Promise.map(Object.keys(data.pdfs), async key => {
    let item = data.pdfs[key];
    TARGET_PDFS[`resources/${key}`] = item;
  });

  await Promise.map(Object.keys(data.jobs), async key => {
    let item = data.jobs[key];
    TARGET_JOBS[key] = item;
  });

}//populateIncomplete

/**
 * handles incomplete
 */
async function handleIncomplete() {
  info(`handleIncomplete: CURRENTLY_POLLING: [${CURRENTLY_POLLING}]`);
  if (CURRENTLY_POLLING) return;

  let pq = await CONNECTION.get({
    path: `${SERVICE_PATH}/process-queue`
  }).catch((err) => {
    if (err.status === 404) return
    throw err;
  }).then(r => r.data);

  //a) resubmit as a mirrored FL doc
  await Promise.map(Object.keys(pq.pdfs), async key => {
    let item = pq.pdfs[key];
    //1. Fetch the fl item
    let path = `${SERVICE_PATH}/businesses/${item.bid}/documents/${item._id}/food-logiq-mirror`;
    let data = await CONNECTION.get({ path })
      .then(r => r.data)
      .catch(err => {
        if (err.status === 404) info(`handleIncomplete failed to fetch mirror data missing for path: ${path}`)
      })

    await CONNECTION.delete({
      path
    })

    await CONNECTION.put({
      path,
      data
    })
  })

  //b) submit for reprocessing by target
  await Promise.map(Object.keys(pq.jobs), async key => {
    //1. Fetch the trellis doc
    let item = pq.jobs[key];

    let path = `${TP_MPATH}/${item.tp}/shared/trellisfw/documents/${item.trellisDocKey}`;
    let data = await CONNECTION.get({ path })
      .then(r => r.data)

    await CONNECTION.delete({
      path
    })

    await CONNECTION.put({
      path,
      data,
    })
  })
}//handleIncomplete

/**
 * handles FL Location
 * @param {*} item 
 * @param {*} bid 
 * @param {*} tp 
 * @returns 
 */
async function handleFlLocation(item, bid, tp) {
  info(`Handling FL location ${item._id}. No handlers currently.`);
  return
}//handleFlLocation

/**
 * handles FL Product
 * @param {*} item 
 * @param {*} bid 
 * @param {*} tp 
 * @returns 
 */
async function handleFlProduct(item, bid, tp) {
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
async function handleFlDocument(item, bid, tp, bname) {
  info(`Handling fl document ${item._id}`)
  let status = item.shareSource && item.shareSource.approvalInfo.status;
  switch (status) {
    case 'approved':
      await handleApprovedDoc(item, bid, tp);
      break;
    case 'rejected':
      info(`Doc [${item._id}] rejected. Awaiting supplier action`);
      break;
    case 'awaiting-review':
      await handlePendingDoc(item, bid, tp, bname)
      break;
    default:
      break;
  }
}//handleFlDocument

/**
 * handles content mirrored into trellis via pollFL
 * TODO: Get rid of the GET in this handler; it should go away if change feeds are more consistent under
 * correct fix of tree PUT
 * @param {*} change 
 * @returns 
 */
async function handleMirrorChange(change) {
  try {
    info('handleMirrorChange processing FL resource');
    let pieces = pointer.parse(change.path);
    let bid = pieces[1];
    let type = pieces[2];
    let key = pieces[3];

    let data = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}/${type}/${key}`
    }).then(r => r.data)

    if (!data['food-logiq-mirror']) return;
    let item = data['food-logiq-mirror'];

    if (!data['food-logiq-mirror']) {
      error(`Business [${bid}] does not contain FL mirror data`)
      return;
    }

    let bus = await CONNECTION.get({
      path: `${SERVICE_PATH}/businesses/${bid}`
    }).then(r => r.data)
      .catch(err => {
        error(`TP masterid entry not found for business ${bid}`);
        return;
      });
    if (!bus.masterid) error(`No trading partner found for business ${bid}.`)
    if (!bus.masterid) return;
    let tp = bus.masterid;

    //    let tp = BUSINESSES[bus.masterid];
    //    let mid = bus['food-logiq-mirror']._id
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
        await handleFlDocument(item, bid, tp, bname);
        break;
      case 'locations':
        await handleFlLocation(item, bid, tp);
        break;
      case 'assessments':
        await handleAssessment(item, bid, tp)
        break;
      case 'product':
        await handleFlProduct(item, bid, tp);
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
 * fetches community resources
 * @param {*} param0 pageIndex, type, date
 */
async function fetchCommunityResources({ pageIndex, type, date }) {
  pageIndex = pageIndex || 0;
  let url = type === 'assessments' ? `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment?lastUpdateAt=${date}..`
    : `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?sourceCommunities=${COMMUNITY_ID}&versionUpdated=${date}..`;
  let request = {
    method: `get`,
    url,
    headers: { 'Authorization': FL_TOKEN },
  }
  if (pageIndex) request.params = { pageIndex };
  let response = await axios(request);
  if (pageIndex) console.log({ pageIndex }, 'current item:', (pageIndex) * 50, 'total items:', response.data.totalItemCount);
  let delay = 0;

  // Manually check for changes; Only update the resource if it has changed!
  await Promise.map(response.data.pageItems, async (item) => {
    let sync;
    let bid;
    if (type === 'assessments') {
      bid = _.has(item, 'performedOnBusiness._id') ? item.performedOnBusiness._id : undefined;
    } else {
      bid = _.has(item, 'shareSource.sourceBusiness._id') ? item.shareSource.sourceBusiness._id : undefined
    }

    if (!bid) {
      error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
      return;
    }
    let path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
    let _id;
    try {
      let resp = await CONNECTION.get({ path })

      // Check for changes to the resources
      let equals = _.isEqual(resp.data['food-logiq-mirror'], item)
      if (!equals) info(`Document difference in FL doc [${item._id}] detected. Syncing...`);
      if (!equals) {
        delay += 20000;
        sync = true;
        _id = resp.data._id;
      }
    } catch (err) {
      if (err.status !== 404) throw err;
      info(`Resource is not already on trellis. Syncing...`);
      sync = true;
      let _id = (await ksuid.random()).string;
      await CONNECTION.put({
        path,
        data: {
          _id,
          "_rev": 0
        }
      });
      delay += 20000;
    }

    // Now, sync
    if (sync) {
      let resp = await CONNECTION.put({
        path: `/${_id}`,
        data: { 'food-logiq-mirror': item }
      })
      info(`Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`);
    }
  }, { concurrency: CONCURRENCY })
  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(`Finished page ${pageIndex}. Item ${response.data.pageItemCount * (pageIndex + 1)}/${response.data.totalItemCount}`);
    if (type === 'documents') info(`Pausing for ${delay / 60000} minutes`)
    if (type === 'documents') await Promise.delay(delay)
    await fetchCommunityResources({ type, date, pageIndex: pageIndex + 1 })
  }
}

/**
 * gets resources
 */
async function getResources() {
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    info(`Fetching community ${type}`);
    await fetchCommunityResources({ type, date })
  })
  // Now get assessments (slightly different syntax)
  info(`Fetching community assessments`);
  await fetchCommunityResources({ type: 'assessments', date })
}

/**
 * gets resources by member
 */
async function getResourcesByMember(member) {
  let bid = member.business._id;
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?sourceCommunities=${COMMUNITY_ID}&sourceBusinesses=${bid}&versionUpdated=${date}..`,
      to: (i) => {
        return `${SERVICE_PATH}/businesses/${bid}/${type}/${i._id}`
      }
    })
  })
  // Now get assessments (slightly different syntax)
  try {
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment?performedOnBusinessIds=${bid}&lastUpdateAt=${date}..`,
      to: `${SERVICE_PATH}/businesses/${bid}/assessments`,
    })
    return;
  } catch (err) {
    throw err;
  }
}//getResourcesByMember

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
  info(`Checking assessment ${assessment._id}`);
  let types = ['']
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
async function handleAssessment(item, bid, tp) {
  info(`Handling assessment [${item._id}]`)
  let found = _.filter(Object.values(TARGET_JOBS), (o) => _.has(o, ['assessments', item._id])) || [];
  await Promise.each(found, async (job) => {
    if (item.state === 'Approved') {
      TARGET_JOBS[job.jobId].assessments[item._id] = true;
      await CONNECTION.put({
        path: `${SERVICE_PATH}/process-queue/jobs/${job.jobId}`,
        data: {
          assessments: {
            [item._id]: true
          }
        }
      });
      await approveFlDoc(job.flId);
    } else if (item.state === 'Rejected') {
      TARGET_JOBS[job.jobId].assessments[item._id] = false;
      await CONNECTION.put({
        path: `${SERVICE_PATH}/process-queue/jobs/${job.jobId}`,
        data: {
          assessments: {
            [item._id]: false
          }
        }
      })
      let message = `A supplier Assessment associated with this document has been rejected. Please resubmit a document that satisfies supplier requirements.`
      // TODO: Only do this if it has a current status of 'awaiting-review'
      await rejectFlDoc(job.flId, message, job.flType);
    } else if (item.state === 'Submitted') {
      info(`Autoapprove Assessments Configuration: [${AUTO_APPROVE_ASSESSMENTS}]`)
      if (AUTO_APPROVE_ASSESSMENTS) {
        try {
          let failed = checkAssessment(item);
          item.state = failed ? 'Rejected' : 'Approved';
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
            data: {approval: !failed}
          })
          // Auto-approve only, do not auto-reject
          if (!failed) {
            info(`Assessment Auto-${item.state}. [${item._id}]`);
            await axios({
              method: 'put',
              url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${item._id}/${failed ? 'reject' : 'approve'}spawnedassessment`,
              headers: { Authorization: FL_TOKEN },
              data: item
            })
          } else info(`Assessment ${item._id} failed checkAssessment`);
        } catch (err) {
          error(err)
          throw err;
        }
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
 */
async function handlePendingDoc(item, bid, tp, bname) {
  info(`Handling pending document [${item._id}]`);
  try {
    let flType = pointer.has(item, `/shareSource/type/name`) ? pointer.get(item, `/shareSource/type/name`) : undefined;

    // retrieve the attachments and unzip
    let file = await axios({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      //      responseType: 'arrayBuffer',
      responseEncoding: 'binary'
    }).then(r => r.data);

    let zip = await new jszip().loadAsync(file);

    let files = Object.keys(zip.files)

    if (files.length !== 1) {
      let message = 'Multiple files attached. Please upload a single a single PDF per Food LogiQ document.'
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/services/fl-sync`,
        data: {
          valid: false,
          message
        }
      })
      return rejectFlDoc(item._id, message, flType)
    }

    // create oada resources for each attachment
    let key = files[0];
    //await Promise.map(files || {}), async (key) => {

      let mirrorId = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_id`,
      }).then(r => r.data)

      let _id = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta/vdoc/pdf/${key}/_id`,
      }).then(r => r.data)
      .catch(err => {});

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
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_meta`,
        data: {
          vdoc: {
            pdf: {
              [key]: { _id }
            }
          }
        },
        headers: { 'content-type': 'application/json' },
      });

      let resId = _id.replace(/resources\//, '');

      // Create a lookup in order to track target updates
      info(`Creating lookup: Trellis: [${_id}]; FL: [${item._id}]`)
      let data = {
        name: item.name,
        tp,
        flId: item._id,
        pdfId: _id,
        mirrorId,
        bid,
        bname,
        trellisDocKey: resId,
        flType,
      };
      await CONNECTION.put({
        path: `${SERVICE_PATH}/process-queue/pdfs/${resId}`,
        data,
      });
      TARGET_PDFS[_id] = data;

      //link the file into the documents list
      info(`Linking file to documents list at ${TP_MPATH}/${tp}/shared/trellisfw/documents/${resId}: ${JSON.stringify(data, null, 2)}`);
      await CONNECTION.put({
        path: `${TP_MPATH}/${tp}/shared/trellisfw/documents/${resId}`,
        data: { _id, _rev: 0 }
      })
    //});
  } catch (err) {
    error(`Error occurred while fetching FL attachments`);
    error(err);
    throw err;
  }
}//handlePendingDoc

/**
 * moves approved documents into final location
 * TODO: No need to rescrape if accepted? Lookup and link in the already-scraped
 * @param {*} item 
 * @param {*} bid 
 * @param {*} tp 
 * @returns 
 */
async function handleApprovedDoc(item, bid, tp) {
  info(`Handling approved document resource [${item._id}]`)
  //1. Get reference of corresponding pending scraped pdf
  let found = _.find(Object.values(TARGET_JOBS, ['flId', item._id]))

  if (!found) return;
  if (!found.result) return;

  TARGET_JOBS[found.jobId].approved = true;
  await CONNECTION.put({
    path: `${SERVICE_PATH}/process-queue/jobs/${found.jobId}`,
    data: { approved: true }
  });

  //2. 
  info(`Moving approved document to [${TP_MPATH}/${tp}/bookmarks/trellisfw/${found.result.type}/${found.result.key}]`);

  try {
    //ensure parent exists
    await CONNECTION.put({
      path: `${TP_MPATH}/${tp}/bookmarks/trellisfw/${found.result.type}`,
      data: {},
      tree
    });
    //TODO: test this part also when trying to remove axios requests to trellis
    await CONNECTION.put({
      path: `${TP_MPATH}/${tp}/bookmarks/trellisfw/${found.result.type}/${found.result.key}`,
      data: { _id: found.result._id },
    })
    info(`Removing ${TARGET_JOBS[found.jobId].trellisId} from fl-sync PDF index`);
    info(`Removing ${found.jobId} from fl-sync Jobs index`);

    let tid = TARGET_JOBS[found.jobId]
    let resId = tid.trellisId.replace(/resources\//, '');

    await CONNECTION.delete({
      path: `${SERVICE_PATH}/process-queue/pdfs/${resId}`
    })
    delete TARGET_PDFS[tid.trellisId]
    await CONNECTION.delete({
      path: `${SERVICE_PATH}/process-queue/jobs/${tid}`
    })
    delete TARGET_JOBS[tid]
  } catch (err) {
    error('Error moving document result into trading-partner indexed docs')
    error(err)
  }
}//handleApprovedDoc

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
  switch (type) {
    case 'cois':
      //TODO: current fix to timezone stuff:
      let offset = LOCAL ? 8 : 12;
      let flExp = moment(flDoc['food-logiq-mirror'].expirationDate).subtract(offset, 'hours');
      let trellisExp = moment(Object.values(trellisDoc.policies)[0].expire_date);
      let now = moment();

      if (!flExp.isSame(trellisExp)) {
        message = `Expiration date (${flExp}) does not match PDF document (${trellisExp}).`;
        status = false;
      }
      if (flExp <= now) {
        message = `Document is already expired: ${trellisExp}`;
        status = false;
      }
      if (message) info(message);
      break;
    default:
      break;
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

  });

  return { message, status };
}//validatePending

/**
 * builds assessment
 * @param {*} job 
 * @param {*} result 
 * @param {*} updateFlId 
 * @returns 
 */
async function constructAssessment(job, result, updateFlId) {
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

  let assess = await spawnAssessment(bid, bname, general, aggregate, auto, product, umbrella, employer, worker, updateFlId);

  if (!updateFlId) {
    let linkResponse = await linkAssessmentToDocument(CO_ID, {
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
 * @param {*} jobId 
 */
async function handleScrapedResult(jobId) {
  let job = TARGET_JOBS[jobId];
  let flDoc;

  info(`--> job type [${job.result.type}]`);
  info(`--> job key [${job.result.key}]`);
  let url = `https://${DOMAIN}${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`;
  info(`--> url [${url}]`);
  try {
    let request = {
      path: `${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`,
    };
    let result = null;
    let retries = 0;

    // retrying ...
    while (result === null && retries++ < MAX_RETRIES) {
      await Promise.delay(2000);
      result = await CONNECTION.get(request)
        .then(r => r.data)
        .catch(err => {
          if (retries === MAX_RETRIES) {
            error(err);
            throw err;
          }
          return null;
        });
    }//while 

    info(`--> result ${result}`);
    info(`--> retries ${retries}`);

    flDoc = await CONNECTION.get({
      path: `${job.mirrorId}`
    }).then(r => r.data)

    info(`--> flDoc ${flDoc}`);
    let data = {
      services: {
        'fl-sync': {
          document: { _id: job.mirrorId },
          flId: job.flId
        }
      }
    };

    let { status, message } = await validatePending(result, flDoc, job.result.type);

    if (status) {

      let assessmentId = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}/id`,
      }).then(r => {
        return r.data
      }).catch(err => { })

      if (assessmentId) info(job, 'Assessment already exists.')
      if (!assessmentId) info(job, 'Assessment does not yet exist.')

      let assess = await constructAssessment(job, result, assessmentId);
      //assessmentId = assess.data._id;

      if (!assessmentId) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${job.bid}/documents/${job.flId}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          data: {id: assess.data._id}
        })
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${job.bid}/assessments/${assess.data._id}/_meta/services/fl-sync/documents/${flId}`,
          data: flId
        })
      }

      await CONNECTION.post({
        path: `/resources/${job.jobId}/updates`,
        data: {
          time: moment().format('X'),
          information: `Trellis-extracted PDF data matches FoodLogiQ form data`,
        }
      }).catch(err => {
        error(err);
        throw err;
      });

      await CONNECTION.post({
        path: `/resources/${job.jobId}/updates`,
        data: {
          time: moment().format('X'),
          information: `A FoodLogiQ Assessment has been created and associated with this document`,
        }
      }).catch(err => {
        error(err);
        throw (err);
      })

      data.services['fl-sync'].assessments = {
        [ASSESSMENT_TEMPLATE_ID]: assessmentId
      }

      TARGET_JOBS[jobId].assessments = {
        [assessmentId]: false
      }
      await CONNECTION.put({
        path: `${SERVICE_PATH}/process-queue/jobs/${jobId}`,
        data: {
          assessments: {
            [assessmentId]: false
          }
        }
      })

      info(`Spawned assessment [${assessmentId}] for business id [${job.bid}]`);
    } else {
      await rejectFlDoc(job.flId, message, job.flType)

      await CONNECTION.post({
        path: `/resources/${job.jobId}/updates`,
        data: {
          time: moment().format('X'),
          information: `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejecting FL Document`,
        }
      })
    }

    info(`Job result stored at trading partner ${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`)

    // Add meta data to the trellis result document
    let resp = await CONNECTION.put({
      path: `${TP_MPATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}/_meta`,
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

async function fetchAssessmentTemplates() {
  await fetchAndSync({
    from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/assessmenttemplate`,
    to: `${SERVICE_PATH}/assessment-templates`,
  })
}

/**
 * fetches assessment templates from trellis
 * looks for COI "Certificate of Insurance (COI) Requirements" in particular
 */
async function fetchCOIAssessmentTemplateFromTrellis() {
  try {
    let _templates = [];
    let coi_template = await CONNECTION.get({
      path: `${SERVICE_PATH}/assessment-templates`,
    }).then(async (r) => {
      for (const key in r.data) {
        if (key[0] !== '_') {
          _templates.push(key);
        }
      }//for
      await Promise.map(_templates, async function (template) {
        await CONNECTION.get({
          path: `${SERVICE_PATH}/assessment-templates/${template}`,
        }).then((result) => {

          if (typeof result.data["food-logiq-mirror"]._id !== 'undefined') {
            ASSESSMENT_TEMPLATES[result.data["food-logiq-mirror"]._id] = result.data["food-logiq-mirror"];
            if (result.data["food-logiq-mirror"].name === "Certificate of Insurance (COI) Requirements") {
              COI_ASSESSMENT_TEMPLATE_ID = result.data["food-logiq-mirror"]._id;
            }//if #2
          }// if #1

        });
      });
    });
  } catch (err) {
    error("Error when fetching COI template from trellis.");
    error(err);
    throw err;
  }
}//fetchCOIAssessmentTemplateFromTrellis

/**
 * the main routine to check for food logiq updates
 */
async function pollFl() {
  try {
    // Sync list of suppliers
    let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()
    info(`Fetching FL community members with date: [${date}]`)

    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/memberships?createdAt=${date}..`,
      to: (i) => `${SERVICE_PATH}/businesses/${i.business._id}`,
      forEach: async (i) => {
        await Promise.each(['products', 'locations', 'documents', 'assessments'], async (type) => {
          await CONNECTION.head({
            path: `${SERVICE_PATH}/businesses/${i.business._id}/${type}`,
          }).catch(async err => {
            if (err.status !== 404) throw err;
            let _id = await CONNECTION.post({
              path: `/resources`,
              data: {}
            }).then(r => r.headers['content-location'].replace(/^\//, ''))

            await CONNECTION.put({
              path: `${SERVICE_PATH}/businesses/${i.business._id}/${type}`,
              data: { _id, _rev: 0 }
            })
          })
        })

      }
    })
    // Now fetch community resources
    info(`JUST_TPS set to ${!!JUST_TPS}`)
    if (!JUST_TPS) await getResources();
  } catch (err) {
    throw err;
  }
}//pollFl

/**
 * fetches and synchronizes
 * @param {*} param0 
 * @returns 
 */
async function fetchAndSync({ from, to, pageIndex, forEach }) {
  pageIndex = pageIndex || 0;
  try {
    let request = {
      method: `get`,
      url: from,
      headers: { 'Authorization': FL_TOKEN },
    }
    if (pageIndex) request.params = { pageIndex };
    let response = await axios(request);

    // Manually check for changes; Only update the resource if it has changed!
    await Promise.map(response.data.pageItems, async (item) => {
      let sync;
      if (to) {
        let path = typeof (to) === 'function' ? await to(item) : `${to}/${item._id}`
        try {
          let resp = await CONNECTION.get({ path })

          // Check for changes to the resources
          let equals = _.isEqual(resp.data['food-logiq-mirror'], item)
          if (equals) info(`Resource difference in FL item [${item._id}] not detected. Skipping...`);
          if (!equals) info(`Resource difference in FL item [${item._id}] detected. Syncing...`);
          if (!equals) {
            sync = true;
          }
        } catch (err) {
          if (err.status === 404) {
            info(`Resource is not already on trellis. Syncing...`);
            sync = true;
          } else {
            error(err);
            throw err
          }
        }

        if (sync) {
          let resp = await CONNECTION.post({
            path: `/resources`,
            data: { 'food-logiq-mirror': item }
          });
          await CONNECTION.put({
            path,
            data: {
              "_id": resp.headers['content-location'].replace(/^\//, ''),
              "_rev": 0
            }
          });
        }
      }
      if (forEach) await forEach(item)
    });

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      info(`fetchAndSync Finished page ${pageIndex}. Item ${response.data.pageItemCount * (pageIndex + 1)}/${response.data.totalItemCount}`);
      await fetchAndSync({ from, to, pageIndex: pageIndex + 1, forEach })
    }
    return;
  } catch (err) {
    info('getBusinesses Error', err.response ? err.response.status : 'Please check error logs');
    throw err;
  }
}//fetchAndSync

/**
 * deletes the Centricity Test Account documents from FL
 * @param path url 
 */
async function cleanUpFlDocuments() {
  info("--> demo cleanup in process ... ");
  try {
    await CONNECTION.put({
      path: SERVICE_PATH,
      tree: tree,
      data: { cleanup: false }
    }).then((update_result) => {
      info("--> cleanup updated.");
    }).catch((error) => {
      info("--> error when updating cleanup flag ", error);
    });

    await axios({
      method: "get",
      url: PATH_DOCUMENTS,
      headers: { Authorization: FL_TOKEN }
    }).then(async (result) => {
      await Promise.map(result.data.pageItems, async function (document) {
        let _path = PATH_DOCUMENTS + `/${document._id}`
        return await axios({
          method: "delete",
          url: _path,
          headers: { Authorization: FL_TOKEN }
        }).then(async (del_result) => {
          info("--> document deleted.");
        });
      });
    }).catch((e) => {
      error("--> Error when retrieving documents. ", e);
      return [];
    });
  } catch (e) {
    error("--> Error when demo cleanup ", e);
  }
}//cleanUpFlDocuments

/** ====================== ASSESSMENTS ===================================== {
 * updates the content of a spawned assessment
 * @param path spawned assessment url 
 * @param data complete content of the assessment
 */
async function updateAssessment(path, data) {
  trace(`Updating assessment [${data._id}] after creation`);
  await axios({
    method: "put",
    url: path,
    headers: { 'Authorization': FL_TOKEN },
    data: data
  }).then((result) => {
    info("--> assessment created. ", result.data._id);
    return result;
  }).catch((err) => {
    error("--> Error when updating the assessment.");
    error(err);
    throw err;
  });
}//updateAssessment

/**
 * creates the links between assessments and documents 
 * @param bid business_id
 * @param assessment info 
 * @param document info 
 */
async function linkAssessmentToDocument(bid, assessment, doc) {
  let PATH_LINK_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/links/assessment/${assessment._id}`;
  trace(`Creating FL Link from assessment [${assessment._id}] to document [${doc._id}]`)

  return axios({
    method: "post",
    url: PATH_LINK_ASSESSMENT,
    headers: { "Authorization": FL_TOKEN },
    data: [{
      "businessId": bid,
      "from": assessment,
      "linkType": "SOURCES",
      "linkTypeDisplay": "Sources",
      "to": doc,
    }]
  }).catch(err => {
    error(err);
  })
}// linkAssessmentToDocument

/**
 * builds array of answers from "Certificate of Insurance (COI) Requirements" assessment template
 */
async function buildAnswerArrayFromAssessmentTemplate() {
  let answers = [];
  let _answer_content = _.cloneDeep(answer_content);
  if (COI_ASSESSMENT_TEMPLATE_ID !== null) {
    let coi_template = ASSESSMENT_TEMPLATES[COI_ASSESSMENT_TEMPLATE_ID];
    let columns = coi_template["sections"][0]["subsections"][0]["questions"][0]["productEvaluationOptions"]["columns"];
    if (typeof columns !== 'undefined') {
      columns.forEach((col) => {
        let answer_template = {
          "column": col._id,
          "answerText": null,
          "answerBool": null,
          "answerNumeric": 2000000
        };
        switch (col.type) {
          case "numeric":
            answer_template["answerNumeric"] = col["acceptanceValueNumericPrimary"];
            break;
          case "bool":
            answer_template["answerBool"] = true;
            answer_template["answerNumeric"] = col["acceptanceValueNumericPrimary"];
            break;
          default:
            error("type not defined for COI Assessment.");
            break;
        }
        answers.push(answer_template);
      });
    }//if #2
  }//if #1
  if (answers.length > 0)
    _answer_content["answers"] = answers;
  return _answer_content;
}//buildAnswerArrayFromAssessmentTemplate

/**
 * spawns and updates assessments automating the spawning process
 * @param bid business_id
 * @param general general liability insurance
 * @param aggregate general aggregate
 * @param auto auto liability
 * @param umbrella coverage
 * @param employer liability
 * @param worker compensation
 */
async function spawnAssessment(bid, bname, general, aggregate, auto, product, umbrella, employer, worker, updateFlId) {
  let PATH_SPAWN_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment`;
  let PATH_TO_UPDATE_ASSESSMENT = PATH_SPAWN_ASSESSMENT;
  let _assessment_template = _.cloneDeep(assessment_template);
  _assessment_template["performedOnBusiness"]["_id"] = bid;
  _assessment_template["performedOnBusiness"]["name"] = bname;

  //spawning the assessment with some (not all) values 
  let result = await axios({
    method: updateFlId ? "get" : "post",
    url: updateFlId ? `${PATH_SPAWN_ASSESSMENT}/${updateFlId}` : PATH_SPAWN_ASSESSMENT,
    headers: { 'Authorization': FL_TOKEN },
    data: _assessment_template
  }).catch((err) => {
    error("--> Error when spawning an assessment.");
    error(err);
    throw err;
  });

  //setting the assessment if to be modified
  let SPAWNED_ASSESSMENT_ID = result ? result.data._id : updateFlId;
  let ASSESSMENT_BODY = result.data;
  let answers_template = [];

  //populating answers in the COI assessment
  answer_content["answers"][0]["answerNumeric"] = general;
  answer_content["answers"][1]["answerNumeric"] = aggregate;
  answer_content["answers"][2]["answerNumeric"] = auto;
  answer_content["answers"][3]["answerNumeric"] = product;
  answer_content["answers"][4]["answerNumeric"] = umbrella;
  answer_content["answers"][5]["answerNumeric"] = employer;
  answer_content["answers"][6]["answerBool"] = worker;

  //including the answers in the answer array
  answers_template.push(answer_content);
  //attaching the answers into the assessment template body
  ASSESSMENT_BODY["sections"][0]["subsections"][0]["questions"][0]["productEvaluationOptions"]["answerRows"] = answers_template;
  // updating percentage completed
  ASSESSMENT_BODY["state"] = "In Progress";
  ASSESSMENT_BODY["questionInteractionCounts"]["answered"] = 1;
  ASSESSMENT_BODY["questionInteractionCounts"]["percentageCompleted"] = 100;
  // creating the path for a specific assessment (update/put)
  PATH_TO_UPDATE_ASSESSMENT = PATH_TO_UPDATE_ASSESSMENT + `/${SPAWNED_ASSESSMENT_ID}`;
  //updating assessment
  ASSESSMENT_BODY["state"] = "Submitted";
  let response = await updateAssessment(PATH_TO_UPDATE_ASSESSMENT, ASSESSMENT_BODY);
  return response || result
}//spawnAssessment
// ======================  ASSESSMENTS ============================== }

function setConnection(conn) {
  CONNECTION = conn;
}

function setTree(t) {
  tree = t;
}

function setPath(newPath) {
  SERVICE_PATH = newPath;
}

function setAutoApprove(value) {
  info(`Setting Autoapprove to ${value}`)
  AUTO_APPROVE_ASSESSMENTS = value;
}

function setCurrentlyPolling(value) {
  CURRENTLY_POLLING = value;
}

async function mockFL({ url }) {
  //1. Strip query parameters
  let u = urlLib.parse(url);
  let path = u.pathname.replace(/\/businesses\/\S*?\//, '/businesses/{{BusinessID}}/')
  path = path.replace(/\/communities\/\S*?\//, '/communities/{{CommunityID}}/');
  path = path.replace(/\/documents\/\S*?\//, '/documents/{{DocumentID}}/');

  if (u.search) path += u.search;
  path = path.replace(/sourceBusinesses=\S*?\&/, 'sourceBusinesses={{SupplierID}}&')
  path = path.replace(/versionUpdated=\S*?$/, 'versionUpdated={{Date}}')

  let string = `{{Host}}${path}`

  //  return { data: sampleDocs[string] };
}

async function testMock() {
  let url = `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/abc123/attachments`
  let res = mockFL({ url });
}

/**
 * initializes service
 */
async function initialize() {
  try {
    info(`<<<<<<<<<       Initializing fl-sync service. [v1.1.23]       >>>>>>>>>>`);
    info(`Initializing fl-poll service. This service will poll on a ${INTERVAL_MS / 1000} second interval`);
    TOKEN = await getToken();
    // Connect to oada
    try {
      var conn = await oada.connect({
        domain: 'https://' + DOMAIN,
        token: TOKEN,
        concurrency: CONCURRENCY,
      })
    } catch (err) {
      error(`Initializing Trellis connection failed`);
      error(err)
    }
    // Run populateIncomplete first so that the change feeds coming in will have
    // the necessary in-memory items for them to continue being processed.
    setConnection(conn);
    //await populateIncomplete()
    await watchTargetJobs();
    await watchFlSyncConfig();
    await checkTime();
    setInterval(checkTime, checkInterval);
//    setInterval(handleIncomplete, HANDLE_INCOMPLETE_INTERVAL);
  } catch (err) {
    error(err);
    throw err;
  }
}//initialize

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
});

initialize();

module.exports = (args) => {
  if (args && args.initialize === false) {
    info("Importing fl-sync and omitting initialization.")
  } else {
    initialize();
  }
  return {
    pollFl,
    spawnAssessment,
    initialize,
    testing: {
      setPath,
      setConnection,
      setTree,
      SERVICE_PATH,
      tree,
    },
    checkAssessment,
    validatePending,
  }
}

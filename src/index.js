if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
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

// ======================  ASSESSMENTS ============================== {
const ASSESSMENT_BID = config.ASSESSMENT_BID;
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const ASSESSMENT_TEMPLATE_NAME = config.get('foodlogiq.assessment-template.name');
const CO_ID = config.get('foodlogiq.community.owner.id');
const CO_NAME = config.get('foodlogiq.community.owner.name');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const COMMUNITY_NAME = config.get('foodlogiq.community.name');
const LOCAL = process.env.LOCAL;
const SCALE = (process.env.SCALE);
let PATH_DOCUMENTS = `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents`;
let ASSESSMENT_TEMPLATES = {};
let COI_ASSESSMENT_TEMPLATE_ID = null;
let CONCURRENCY = 20;
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
    "_id": SCALE ? "61018c2541ae7b000e8ab6eb" : ASSESSMENT_TEMPLATE_ID,
    "name": SCALE ? "Trellis Test Certificate of Insurance (COI) Requirements" : ASSESSMENT_TEMPLATE_NAME
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
  "_id": SCALE ? "610a0130886afc8196000001" : "6091a3bed4e9d21beb000001",
  "answers": [
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6ef" : "606cc7eff8014707de000012",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f0" : "606cc83bf8014788eb000013",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f1" : "606cc860f801475f03000014",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f2" : "6091a7361b70862ee2000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f3" : "606cc887f80147f255000015",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f4" : "606f661d2914d0eaff000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": SCALE ? "61018c2541ae7b000e8ab6f5" : "606f664b2914d09a5f000002",
      "answerText": null,
      "answerNumeric": null
    }
  ]
};

if (SCALE) {
  answer_content.answers[7] = {
    "column": "6108520538d48cd7a5000001",
    "answerText": null,
    "answerNumeric": null
  }
}

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
let checkInterval = INTERVAL_MS/2; //check OADA to determine if its time to poll
let lastPoll;
info(`Polling FL every ${INTERVAL_MS/1000}s. Checking OADA if its time to poll every ${checkInterval/1000}s.`);

let SERVICE_PATH = `/bookmarks/services/fl-sync`;
let TP_PATH = `/bookmarks/trellisfw/trading-partners`;
let TPs;
let CONNECTION;

let TARGET_PDFS = {};// index of trellis pdf documents mapped to FL documents
let TARGET_JOBS = {};// index of target jobs mapped to FL documents

async function getToken() {
  return TRELLIS_TOKEN
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
        await cleanUpFLDocuments();
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
}

async function getLookup(item, key) {
  try {
    let jobId = key;
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return
    let trellisId = item.config.pdf._id;
    info(`New target job [${key}]: Trellis pdf: [${trellisId}]`);

    if (!trellisId) return;
    let flId = TARGET_PDFS[trellisId] && TARGET_PDFS[trellisId].flId;

    if (!flId) info(`No FL id found to associate to job [${jobId}]`);
    if (!flId) return false;

    TARGET_JOBS[key] = {
      jobId: key,
      trellisId,
      start: Date.now()
    };
    Object.assign(TARGET_JOBS[key], TARGET_PDFS[trellisId])
    await CONNECTION.put({
      path: `/bookmarks/services/fl-sync/process-queue/jobs/${key}`,
      data: TARGET_JOBS[key]
    })

  } catch (err) {
    error(`Error associating new target job to FL documents`)
    error(err);
  }
}

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
            path: `/bookmarks/services/fl-sync/process-queue/jobs/${jobId}`,
            data: {result: { type, key, _id: c.body.result[type][key]._id } }
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
          details = `PDF successfully identified as document type: ${val.type}`
          break;
        case 'success':
          if (/^Runner/.test(val.meta)) details = 'Trellis automation complete.';
          break;
        default:
          break;
      }
      if (details) {
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
}

async function watchFlSyncConfig() {
  let data = await CONNECTION.get({
    path: `/bookmarks/services/fl-sync`,
  }).then(r => r.data)
  .catch(async (err) => {
    if (err.status === 404) {
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync`,
        data: {},
        tree
      })
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/businesses`,
        data: {},
        tree
      })
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/process-queue`,
        data: {},
        tree
      })
      return {};
    } else throw err;
  })
  info('Watching bookmarks/services/fl-sync.');
  setAutoApprove(data['autoapprove-assessments']);

  await CONNECTION.watch({
    path: `/bookmarks/services/fl-sync`,
    tree,
    watchCallback: async (change) => {
      try { 
        if (_.has(change.body, 'autoapprove-assessments')) {
          setAutoApprove(change.body['autoapprove-assessments']);
        } else if (/\/businesses\/(.)+\/(.)+\/(.)+/.test(change.path)) {
          if (change.body['food-logiq-mirror']) console.log('CHANGE', change);
          if (change.body['food-logiq-mirror']) await handleMirrorChange(change)
        }
      } catch(err) {
        error('mirror watchCallback error')
        error(err)
      }
    }
  }).catch(err => {
    error(err);
  })
}

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
}

async function initialize() {
  try {
    info(`Initializing fl-poll service. This service will poll on a ${INTERVAL_MS/1000} second interval`);
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
    setConnection(conn);
    await watchTargetJobs();
    await watchFlSyncConfig();
    //  await createFlWebsocket();
    await checkTime();
    setInterval(checkTime, checkInterval);
  } catch (err) {
    error(err);
    throw err;
  }
}

async function handleFlLocation(item, bid, tp) {
  info(`Handling FL location ${item._id}. No handlers currently.`);
  return
}

async function handleFlProduct(item, bid, tp) {
  info(`Handling FL product ${item._id}. No handlers currently.`);
  return
}

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
}

// Handle content mirrored into trellis via pollFl
async function handleMirrorChange(change) {
  try {
    info('handleMirrorChange processing FL resource');
    let pieces = pointer.parse(change.path);
    let bid = pieces[1];
    let type = pieces[2];
    let key = pieces[3];

    // Fetch the associated business and 
    let data = await CONNECTION.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/${type}/${key}`
    }).then(r => r.data)
    
    if (!data['food-logiq-mirror']) return;
    let item = data['food-logiq-mirror'];

    if (!data['food-logiq-mirror']) { 
      error(`Business [${bid}] does not contain FL mirror data`)
      return;
    }
    let bname = data['food-logiq-mirror'].shareSource.sourceBusiness.name;
    let bus = await CONNECTION.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`
    }).then(r => r.data)
    .catch(err => {
      error(`TP masterid entry not found for business ${bid}`);
      return;
    })
    if (!bus.masterid) error(`No trading partner found for business ${bid}.`)
    if (!bus.masterid) return;
    let tp = BUSINESSES[bus.masterid];
    let mid = bus['food-logiq-mirror']._id
    if (!tp) error(`No trading partner found for business ${bid}.`)
    if (!tp) return;
    info(`Found trading partner [${tp}] for FL business ${bid}`)

    switch (type) {
      case 'documents':
        let handleDocStart = Date.now()
        await handleFlDocument(item, bid, tp, bname);
        //setTime('handleFlDoc', Date.now() - handleDocStart)
        break;
      case 'locations':
        await handleFlLocation(item, bid, tp);
        break;
      case 'assessments':
        let handleAssessStart = Date.now()
        await handleAssessment(item, bid, tp)
        //setTime('handleAssessment', Date.now() - handleAssessStart)
        break;
      case 'product':
        await handleFlProduct(item, bid, tp);
        break;
      default:
        return;
    }
  } catch(err) {
    error('Error handling mirror change', err);
    throw err;
  }
}

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
  if (pageIndex) console.log({pageIndex}, 'current item:', (pageIndex)*50, 'total items:', response.data.totalItemCount);

  // Manually check for changes; Only update the resource if it has changed!
  await Promise.map(response.data.pageItems, async (item) => {
    let sync;
    let bid;
    if (type === 'assessments') {
      bid = _.has(item, 'performedOnBusiness._id') ? item.performedOnBusiness._id : undefined;
//      if (_.has(item, 'sections.0.subsections.0.questions.0.productEvaluationOptions.answerRows.0.answers.7.answerText')) {
//        bid = _.get(item, 'sections.0.subsections.0.questions.0.productEvaluationOptions.answerRows.0.answers.7.answerText')
//        console.log('found an assessment bid');
//      }
    } else {
      bid = _.has(item, 'shareSource.sourceBusiness._id') ? item.shareSource.sourceBusiness._id : undefined
//      if (_.has(item, 'shareSource.shareSpecificAttributes.customCentricityTest')) {
//        bid = item.shareSource.shareSpecificAttributes.customCentricityTest;
//        console.log('found a custom bid', bid);
//      }
    }

    if (!bid) {
      error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
      return;
    }
    let path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
    try {
      let resp = await CONNECTION.get({ path })

      // Check for changes to the resources
      let equals = _.isEqual(resp.data['food-logiq-mirror'], item)
      if (!equals) info(`Document difference in FL doc [${item._id}] detected. Syncing...`);
      if (!equals) {
        sync = true;
      }
    } catch (err) {
      if (err.status !== 404) throw err;
      info(`Resource is not already on trellis. Syncing...`);
      sync = true;
    }

    // Now, sync
    if (sync) {
      let _id = (await ksuid.random()).string;

      await CONNECTION.put({
        path,
        data: { 
          "_id": `resources/${_id}`,
          "_rev": 0
        }
      })
      let resp = await CONNECTION.put({
        path: `/resources/${_id}`,
        data: { 'food-logiq-mirror': item }
      })
      info(`Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`);
    }
  })
  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(`Finished page ${pageIndex}. Item ${response.data.pageItemCount*(pageIndex+1)}/${response.data.totalItemCount}`);
    await fetchCommunityResources({ type, date, pageIndex: pageIndex+1 })
  }
  if (pageIndex === 1000) info('stopping at page 1000')
}

async function getResources() {
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    info(`Fetching community ${type}`);
    await fetchCommunityResources({type, date})
  })
  // Now get assessments (slightly different syntax)
  await fetchCommunityResources({type: 'assessments', date})
}

async function getResourcesByMember(member) {
  let bid = member.business._id;
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?sourceCommunities=${COMMUNITY_ID}&sourceBusinesses=${bid}&versionUpdated=${date}..`,
      //to: `${SERVICE_PATH}/businesses/${bid}/${type}`,
      to: (i) => {
//        if (_.has(i, 'shareSource.shareSpecificAttributes.customCentricityTest')) {
//          bid = i.shareSource.shareSpecificAttributes.customCentricityTest;
//          console.log('found a custom bid', bid);
//          return `${SERVICE_PATH}/businesses/${bid}/${type}/${i._id}`
//        }
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
}

async function approveFLDoc(docId) {
  info(`Approving associated FL Doc ${docId}`);
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/approvalStatus/approved`,
    headers: { Authorization: FL_TOKEN },
    data: {
      status: "Approved"
    }
  })
}

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

          if (column.statusticsCommon.percentWithinTolerance < 100 && column.name !== "Umbrella Coverage" && column.type === 'numeric') {
            let value = question.productEvaluationOptions.answerRows[0].answers[i].answerNumeric;
            let umbCov = question.productEvaluationOptions.answerRows[0].answers[umbrella].answerNumeric;
            let requirement = column.acceptanceValueNumericPrimary;
            // if umbrella only pertains to specific insurance types
//            if (types.indexOf(column.name) > -1) {}
            if (value && umbCov && requirement) {
              return (value + umbCov < requirement);
            }
          }

          return column.statisticsCommon.percentWithinTolerance < 100
        })
      })
    })
  }).flat(5).some(i => i)

}

function checkAssessment(assessment) {
  info(`Checking assessment ${assessment._id}`);
  if (assessment.assessmentTemplate === COI_ASSESSMENT_TEMPLATE_ID) {
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
    })
  }).flat(5).some(i => i)
}

async function handleAssessment(item, bid, tp) {
  info(`Handling assessment [${item._id}]`)
  if (item.state === 'Approved') {
    let found = _.filter(Object.values(TARGET_JOBS), (o) => _.has(o, ['assessments', item._id])) || [];
    await Promise.each(found, async (job) => {
      TARGET_JOBS[job.jobId].assessments[item._id] = true;
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/process-queue/jobs/${job.jobId}`,
        data: {
          assessments: {
            [item._id]: true
          }
        }
      })
      await approveFLDoc(job.flId);

      //Create an update message
      await CONNECTION.post({
        path: `/resources/${job.jobId}`,
        data: {
          time: moment().format('X'),
          information: `FoodLogiQ Assessment has been approved`,
        }
      })
    })

  } else if (item.state === 'Rejected') {
    let found = _.filter(Object.values(TARGET_JOBS), (o) => _.has(o, ['assessments', item._id])) || [];
    await Promise.each(found, async (job) => {
      TARGET_JOBS[job.jobId].assessments[item._id] = false;
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/process-queue/jobs/${job.jobId}`,
        data: {
          assessments: {
            [item._id]: false 
          }
        }
      })
      let message = `A supplier Assessment associated with this document has been rejected. Please resubmit a document that satisfies supplier requirements.`
      // TODO: Only do this if it has a current status of 'awaiting-review'
      await rejectFLDoc(job.flId, message);
    })
  } else if (item.state === 'Submitted') {
    info(`Autoapprove Assessments Configuration: [${AUTO_APPROVE_ASSESSMENTS}]`)
    if (AUTO_APPROVE_ASSESSMENTS) {
      try {
        let failed = checkAssessment(item);
        item.state = failed ? 'Rejected' : 'Approved';
        // Auto-approve only, do not auto-reject
        if (!failed) {
          info(`Assessment Auto-${item.state}. [${item._id}]`);
          await axios({
            method: 'put',
            url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${item._id}/${failed ? 'reject' : 'approve'}spawnedassessment`,
            headers: { Authorization: FL_TOKEN },
            data: item
          })
        }
      } catch (err) {
        error(err)
        throw err;
      }
    }
  }
}

// Handle docs pending approval
async function handlePendingDoc(item, bid, tp, bname) {
  info(`Handling pending document [${item._id}]`);
  try {
    // retrieve the attachments and unzip
    let file = await axios({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseType: 'arrayBuffer',
      responseEncoding: 'binary'
    }).then(r => r.data);

    let zip = await new jszip().loadAsync(file);

    // create oada resources for each attachment
    await Promise.map(Object.keys(zip.files || {}), async (key) => {
      let zdata = await zip.file(key).async("arraybuffer");
      let response = await axios({
        method: 'post',
        url: `https://${DOMAIN}/resources`,
        data: zdata,
        headers: {
          'Content-Disposition': 'inline',
          'Content-Type': 'application/pdf',
          Authorization: 'Bearer ' + TRELLIS_TOKEN
        }
      })

      let _id = response.headers['content-location'];
      await CONNECTION.put({
        path: `${_id}/_meta`,
        //TODO: How should this be formatted?
        data: {
          filename: key,
          services: {
            'fl-sync': {
              [item._id]: {
                _ref: _id,
              }
            }
          }
        },
        headers: { 'content-type': 'application/json' },
      })

      _id = _id.replace(/^\//, '');

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
      })

      let mirrorId = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${item._id}/_id`,
      }).then(r => r.data)

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
      }
      let resId = _id.replace(/resources\//, '');
      await CONNECTION.put({
        path: `/bookmarks/services/fl-sync/process-queue/pdfs/${resId}`,
        data,
      })
      TARGET_PDFS[_id] = data;

      //link the file into the documents list
      data = { _id, _rev: 0 }
      info(`Linking file to documents list at ${TP_PATH}/${tp}/shared/trellisfw/documents/${_id}: ${JSON.stringify(data, null, 2)}`);
      await CONNECTION.put({
        path: `${TP_PATH}/${tp}/shared/trellisfw/documents/${resId}`,
        data,
      })
    })
  } catch (err) {
    error(`Error occurred while fetching FL attachments`);
    error(err)
    throw err;
  }
}



// Move approved docs into final location
//TODO No need to rescrape if accepted? Lookup and link in the already-scraped 
// result
async function handleApprovedDoc(item, bid, tp) {
  info(`Handling approved document resource [${item._id}]`)
  //1. Get reference of corresponding pending scraped pdf
  let found = _.find(Object.values(TARGET_JOBS, ['flId', item._id]))

  if (!found) return;
  if (!found.result) return;

  TARGET_JOBS[found.jobId].approved = true;
  await CONNECTION.put({
    path: `/bookmarks/services/fl-sync/process-queue/jobs/${job.jobId}`,
    data: { approved: false }
  })

  //2. 
  info(`Moving approved document to [${TP_PATH}/${tp}/bookmarks/trellisfw/${found.result.type}/${found.result.key}]`);

  try {
    //ensure parent exists
    await CONNECTION.put({
      path: `${TP_PATH}/${tp}/bookmarks/trellisfw/${found.result.type}`,
      data: {},
      tree
    })
    await axios({
      method: 'put',
      url: `https://${DOMAIN}${TP_PATH}/${tp}/bookmarks/trellisfw/${found.result.type}/${found.result.key}`,
      data: { _id: found.result._id },
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${TRELLIS_TOKEN}`
      },
    })
    info(`Removing ${TARGET_JOBS[found.jobId].trellisId} from fl-sync PDF index`);
    info(`Removing ${found.jobId} from fl-sync Jobs index`);
    //setTime('TargetJob', TARGET_JOBS[found.jobId].start - Date.now())

    let tid = TARGET_JOBS[found.jobId]
    let resId = tid.trellisId.replace(/resources\//, '');

    await CONNECTION.delete({
      path: `/bookmarks/services/fl-sync/process-queue/pdfs/${resId}`
    })
    delete TARGET_PDFS[tid.trellisId]
    await CONNECTION.delete({
      path: `/bookmarks/services/fl-sync/process-queue/jobs/${tid}`
    })
    delete TARGET_JOBS[tid]
  } catch (err) {
    error('Error moving document result into trading-partner indexed docs')
    error(err)
  }
}

// Validate documents that have not yet be approved
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
        message = 'Expiration date does not match PDF document.';
        status = false;
        info(`FoodLogiQ expiration [${flExp}] Trellis expiration [${trellisExp}]`)
      }
      if (flExp <= now) {
        message = 'Document is already expired.';
        status = false;
        info(`Document is already expired: ${trellisExp}]`)
      }
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

  })

  return { message, status }
}

async function constructAssessment(job, result) {
  let { bid, bname } = job;

  let policies = Object.values(result.policies);
  let cgl = _.find(policies, ['type', 'Commercial General Liability']) || {};
  let general = parseInt(cgl.each_occurrence || 0);
  let aggregate = parseInt(cgl.general_aggregate || 0);
  let product = parseInt(cgl["products_-_compop_agg"] || 0);

  let al = _.find(policies, ['type', 'Automobile Liability']) || {};
  let auto = parseInt(al.combined_single_limit || 0);

  let ul = _.find(policies, ['type', 'Umbrella Liability']) || {};
  let umbrella = parseInt(ul.each_occurence1 || 0);

  let wc = _.find(policies, ['type', `Worker's Compensation`]);
  let worker = wc ? true : false;

  let el = _.find(policies, ['type', `Employers' Liability`]) || {};
  let employer = parseInt(el.el_each_accident || 0);

  let assess = await spawnAssessment(bid, bname, general, aggregate, auto, product, umbrella, employer, worker, bid);

  let linkResponse = await linkAssessmentToDocument(CO_ID, {
    "_id": assess.data._id,
    "type": "assessment"
  }, {
    "_id": job.flId,
    "name": job.name,
    "type": "document"
  })

  return assess;
}

async function handleScrapedResult(jobId) {
  let job = TARGET_JOBS[jobId];
  let result;
  let flDoc;

  try {
    let request = {
      method: 'get',
      url: `https://${DOMAIN}${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`,
      headers: {
        Authorization: `Bearer ${TRELLIS_TOKEN}`,
      },
    }
    await Promise.delay(2000).then(async () => {
      try {
        result = await axios(request).then(r => r.data);
      } catch (err) {
        await Promise.delay(2000).then(async () => {
          result = await axios(request).then(r => r.data);
        })
      }
    })

    flDoc = await CONNECTION.get({
      path: `${job.mirrorId}`
    }).then(r => r.data)

    let data = {
      services: {
        'fl-sync': {
          document: { _id: job.mirrorId },
          flId: job.flId
        }
      }
    }

    let { status, message } = await validatePending(result, flDoc, job.result.type);

    if (status) {
      await axios({
        method: 'post',
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${job.flId}/capa`,
        headers: { Authorization: FL_TOKEN },
        data: {
          details: 'Document passed validation. Ready for approval.',
          type: "change_request",
        }
      })

      await CONNECTION.post({
        path: `/resources/${job.jobId}`,
        data: {
          time: moment().format('X'),
          information: `Trellis-extracted PDF data matches FoodLogiQ form data`,
        }
      }).catch(err => {
        error(err);
        throw err;
      })

      let assess = await constructAssessment(job, result);

      data.services['fl-sync'].assessment = assess.data._id;

      TARGET_JOBS[jobId].assessments = {
        [assess.data._id]: false
      }
      await CONNECTION.put({
          path: `/bookmarks/services/fl-sync/process-queue/jobs/${jobId}`,
          data: { 
            assessments: {
              [assess.data._id]: false
            }
          }
        })

      await CONNECTION.post({
        path: `/resources/${job.jobId}`,
        data: {
          time: moment().format('X'),
          information: `A FoodLogiQ Assessment has been created and associated with this document`,
        }
      }).catch(err => {
        error(err);
        throw(err);
      })

      info(`Spawned assessment [${assess.data._id}] for business id [${job.bid}]`);
    } else {
      await rejectFLDoc(job.flId, message)

      await CONNECTION.post({
        path: `/resources/${job.jobId}`,
        data: {
          time: moment().format('X'),
          information: `Trellis-extracted PDF data does not match FoodLogiQ form data; Rejecting FL Document`,
        }
      })
    }

    info(`Job result stored at trading partner ${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`)

    // Link to the original food-logiq document
    let resp = await CONNECTION.put({
      path: `${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}/_meta`,
      data
    })
    /*
    let resp = await axios({
      method: 'put',
      url: `https://${DOMAIN}${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}/_meta`,
      headers: {
        Authorization: `Bearer ${TRELLIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data
    })
    */
  } catch (err) {
    error(err);
    throw err;
  }

}

async function rejectFLDoc(docId, message) {
  info(`Rejecting FL document [${docId}]. ${message}`);
  //reject to FL
  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/approvalStatus/rejected`,
    headers: { Authorization: FL_TOKEN },
    data: { status: "Rejected" }
  })

  //Post message regarding error
  await axios({
    method: 'post',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/capa`,
    headers: { Authorization: FL_TOKEN },
    data: {
      details: `${message} Please correct and resubmit.`,
      type: "change_request",
    }
  })

  await axios({
    method: 'put',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${docId}/submitCorrectiveActions`,
    headers: { Authorization: FL_TOKEN },
    data: {}
  })


}

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

// The main routine to check for food logiq updates
async function pollFl() {
  try {
    let TPs = {};
    // Get known trading partners
    let resp = await CONNECTION.get({
      path: `${TP_PATH}/expand-index`,
    })
    .then(r => TPs = r.data)
    .catch(err => {
      if (err.status !== 404) throw err;
    })

    //TODO: this whole bit goes away under the new system
    await Promise.map(Object.keys(TPs || {}), async (i) => {
      // 1. Get business id
      let item = TPs[i];
      if (!item.masterid) return;
      BUSINESSES[item.masterid] = i;
    })

    //Get assessment templates
    let templates = await fetchAssessmentTemplates();

    // Sync list of suppliers
    let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()
    info(`Fetching FL community members with date: [${date}]`)
    
    let start = Date.now();
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/memberships`,
      to: (i) => `${SERVICE_PATH}/businesses/${i.business._id}`,
      forEach: async (i) => {
        await Promise.each(['products', 'locations', 'documents'], async (type) => {
          await CONNECTION.head({
            path: `/bookmarks/services/fl-sync/businesses/${i.business._id}/${type}`,
          }).catch(async err => {
            if (err.status !== 404) throw err;
            let _id = await CONNECTION.post({
              path: `/resources`,
              data: {}
            }).then(r => r.headers['content-location'].replace(/^\//, ''))

            await CONNECTION.put({
              path: `/bookmarks/services/fl-sync/businesses/${i.business._id}/${type}`,
              data: { _id, _rev: 0 }
            })
          })
        })
      }
    })
    let t = Date.now() - start;
    //setTime('SyncBusiness', t)
    // Now fetch community resources
    start = Date.now()
    if (JUST_TPS) info(`JUST_TPS set to true. Only processing businesses, not the resources`)
    if (!JUST_TPS) await getResources();
    t = Date.now() - start
    //setTime('GetDocs', t)
  } catch (err) {
    throw err;
  }
}

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
          })
          await CONNECTION.put({
            path,
            data: { 
              "_id": resp.headers['content-location'].replace(/^\//, ''),
              "_rev": 0
            }
          })
        }
      }
      if (forEach) await forEach(item)
    })

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      info(`fetchAndSync Finished page ${pageIndex}. Item ${response.data.pageItemCount*(pageIndex+1)}/${response.data.totalItemCount}`);
      await fetchAndSync({ from, to, pageIndex: pageIndex + 1, forEach})
    }
    return;
  } catch (err) {
    info('getBusinesses Error', err.response ? err.response.status : 'Please check error logs');
    throw err;
  }
}

/**
 * deletes the Centricity Test Account documents from FL
 * @param path url 
 */
async function cleanUpFLDocuments() {
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
}//cleanUpFLDocuments

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
  let PATH_LINK_ASSESSMENT = `https://sandbox-api.foodlogiq.com/v2/businesses/${CO_ID}/links/assessment/${assessment._id}`;
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
async function spawnAssessment(bid, bname, general, aggregate, auto, product, umbrella, employer, worker, customCentricityTest) {
  let PATH_SPAWN_ASSESSMENT = `https://sandbox-api.foodlogiq.com/v2/businesses/${CO_ID}/spawnedassessment`;
  let PATH_TO_UPDATE_ASSESSMENT = PATH_SPAWN_ASSESSMENT;
  let _assessment_template = _.cloneDeep(assessment_template);
  _assessment_template["performedOnBusiness"]["_id"] = bid;
  _assessment_template["performedOnBusiness"]["name"] = bname;

  //spawning the assessment with some (not all) values 
  return axios({
    method: "post",
    url: PATH_SPAWN_ASSESSMENT,
    headers: { 'Authorization': FL_TOKEN },
    data: _assessment_template
  }).then(async (result) => {
    //setting the assessment if to be modified
    let SPAWNED_ASSESSMENT_ID = result.data._id;
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
//    if (SCALE) answer_content["answers"][7]["answerText"] = customCentricityTest;

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
  }).catch((err) => {
    error("--> Error when spawning an assessment.");
    error(err);
    throw err;
  });
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

function setTime(key, value) {
  if (!times[key]) times[key] = 0;
  times[key] += value;
  console.log(JSON.stringify(times, null, 2))
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

initialize();

module.exports = (args) => {
  if (args && args.initialize === false) {
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
    }
  }
}

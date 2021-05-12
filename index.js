process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
//if (LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
const axios = require('axios');
const debug = require('debug');
const trace = debug('fl-sync:trace');
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');

//const SHARED_PATH = LOCAL ? '../shared' : '/code/fl-shared';
//let config = require(SHARED_PATH+'/config');

let Promise = require('bluebird');
const moment = require('moment');
const urlLib = require('url');
const _ = require('lodash');
const pointer = require('json-pointer');
const uuid = require('uuid');
const sha256 = require('sha256');
const oada = require('@oada/client');
let config = require('./config.default.js');
const { FL_TOKEN, FL_DOMAIN, DOMAIN, TRELLIS_TOKEN } = config;
const SF_FL_CID = config.sf_buyer.community_id;
const SF_FL_BID = config.sf_buyer.business_id;
const jszip = require('jszip');
const oadalist = require('@oada/list-lib');
//const sampleDocs = require('./sampleDocs.js');
const ListWatch = oadalist.ListWatch;
//const axios = mockFL;
let BUSINESSES = {};
let TradingPartners = {};
const FL_MIRROR = "food-logiq-mirror";
//let tree = require(SHARED_PATH+'/tree').mirrorTree;
let tree = require('./tree.js');
const TL_TP = config.TL_TP;
const TL_UTP = config.TL_UTP;
const TL_FL_BS = config.TL_FL_BS;

// ======================  ASSESSMENTS ============================== {
const BID = config.ASSESSMENT_BID;
const ASSESSMENT_TEMPLATE_ID = config.ASSESSMENT_TEMPLATE_ID;
const ASSESSMENT_TEMPLATE_NAME = config.ASSESSMENT_TEMPLATE_NAME;
const CO_ID = config.CO_ID;
const CO_NAME = config.CO_NAME;
const COMMUNITY_ID = config.COMMUNITY_ID;
const COMMUNITY_NAME = config.COMMUNITY_NAME;

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
    "_id": "605249563a720a000e4154ad",
    "name": "Centricity Test"
  },
  "performedOnBusiness": {
    "_id": "605249563a720a000e4154ad",
    "name": "Centricity Test"
  },

  "name": "Insurance Requirements",
  "type": "supplier_questionnaire"
};

// TODO: need to polish this code
// left here for reference
let answer_content = {
  "_id": "6091a3bed4e9d21beb000001",
  "answers": [
    {
      "column": "6086fa35f8960fafbf000003",
      "answerText": null,
      "answerBool": null,
      "answerNumeric": 2000000
    },
    {
      "column": "6086fa63f8960f9ab3000004",
      "answerText": null,
      "answerBool": null,
      "answerNumeric": 5000000
    },
    {
      "column": "6086fa9af8960f29c3000005",
      "answerText": null,
      "answerBool": null,
      "answerNumeric": 1000000
    },
    {
      "column": "6086facdf8960fcb85000006",
      "answerText": null,
      "answerBool": null,
      "answerNumeric": 1000000
    },
    {
      "column": "6086fadcf8960fac16000007",
      "answerText": null,
      "answerBool": null,
      "answerNumeric": 1000000
    },
    {
      "column": "6086fb0cf8960f5046000008",
      "answerText": null,
      "answerBool": true,
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
let checkInterval = 10 * 1000; //check oada every 1 minute
let INTERVAL_MS = 20 * 1000; //1 min in ms
let lastPoll;

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
  let manualPoll;

  //Get last poll date
  try {
    let response = await CONNECTION.get({ path: `${SERVICE_PATH}` })

    manualPoll = response.data.manualPoll || process.env.MANUAL_POLL;

    let freshPoll = process.env.FRESH_POLL;

    info(`/lastPoll endpoint found; last update was: ${response.data.lastPoll}`);
    if (!freshPoll && response.data.lastPoll) lastPoll = moment(response.data.lastPoll).utc();
  } catch (err) {
    if (err.status === 404) {
      info(`/lastPoll does not exist. Omitting versionUpdate param for a fresh poll.`);
    } else throw err;
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
      error(err);
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

    return CONNECTION.put({
      path: SERVICE_PATH,
      tree,
      data: { lastPoll: current }
    })
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

    if (!flId) info(`No FL id found to associate to this particular job`);
    if (!flId) return false;
    TARGET_JOBS[key] = {
      jobId: key,
      flId,
      trellisId,
      tp: TARGET_PDFS[trellisId].tp,
      mirrorId: TARGET_PDFS[trellisId].mirrorId
    }

    let docId = TARGET_JOBS[key].flId;
  } catch (err) {
    error(`Error associating new target job to FL documents`)
    error(err);
  }
}

async function onTargetUpdate(c, jobId) {
  info(`Recieved update for job [${jobId}]`);
  let job = TARGET_JOBS[jobId];

  if (!(job && job.flId)) info(`No Food Logiq document associated to this job. Ignoring`)
  if (!(job && job.flId)) return;

  try {

    // Handle finished target results 
    await Promise.each(Object.keys(c.body && c.body.result || {}), async type => {
      await Promise.each(Object.keys(c.body.result[type]), async key => {
        console.log('putting _id', c.body.result[type][key]._id);
        TARGET_JOBS[jobId].result = { type, key, _id: c.body.result[type][key]._id };
        await handleScrapedResult(jobId)
      })
    })

    // Provide select update messages to FL
  await Promise.each(Object.values(c && c.body && c.body.updates || {}), async val => {

    let details;
    switch(val.status) {
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
        if (/^Runner/.test(val.meta))details = 'Trellis automation complete.';
        break;
      default:
        break;
    }
    if (details) {
      info(`Posting new update to FL docId ${job.flId}: ${details}`);
      await axios({
        method: 'post',
        url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/capa`,
        headers: {Authorization: FL_TOKEN},
        data: {
          details,
          type: "change_request",
        }
      })
    }
    // Use success and failure as signals of a completed job
    if (val.status === 'success' || val.status === 'failure') {
//      delete TARGET_PDFS[TARGET_JOBS[jobId].trellisId];
//      delete TARGET_JOBS[jobId];
    }
  })
  } catch(err) {
    console.log('on target update', err);
  }


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
  info('Initializing fl-poll service');
  TOKEN = await getToken();
  // Connect to oada
  try {
    var conn = await oada.connect({
      domain: 'https://' + DOMAIN,
      token: TOKEN,
    })
  } catch (err) {
    error(`Initializing Trellis connection failed`);
    error(err)
  }
  setConnection(conn);
  await watchTargetJobs();
  await checkTime();
  await watchTrellisFLBusinesses();
  setInterval(checkTime, checkInterval);
  //await spawnAssessment(BID, 2000001, 5000001, 1000001, 1000001, 1000002);
}

async function handleFlLocation(item, bid, tp) {
  info(`Handling FL location ${item._id}. No handlers currently.`);
  return
}

async function handleFlProduct(item, bid, tp) {
  info(`Handling FL product ${item._id}. No handlers currently.`);
  return
}

async function handleFlDocument(item, bid, tp) {
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
      await handlePendingDoc(item, bid, tp)
      break;
    default:
      break;
  }
}

async function getResourcesByMember(member) {
  let bid = member.business._id;
  let tp = await businessToTp(member);

  if (!tp) error(`No trading partner found for business ${bid}`)
  if (!tp) return;
  info(`Found trading partner [${tp}] for FL business ${bid}`)
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    info(`Retrieving Food Logiq ${type} for supplier ${member._id} with date ${date}`)
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/${type}?sourceCommunities=${SF_FL_CID}&sourceBusiness=${bid}&versionUpdated=${date}..`,
      to: `${SERVICE_PATH}/businesses/${bid}/${type}`,
      forEach: async function handleItems(item) {
        switch (type) {
          case 'locations':
            await handleFlLocation(item, bid, tp);
            break;
          case 'documents':
            await handleFlDocument(item, bid, tp);
            break;
          case 'products':
            await handleFlProduct(item, bid, tp);
            break;
          default:
            break;
        }
      }
    })
  })
  return;
}

// Handle docs pending approval
async function handlePendingDoc(item, bid, tp) {
  info(`Handling pending document [${item._id}]`);
  try {
    // retrieve the attachments and unzip
    let file = await axios({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseType: 'arrayBuffer',
      responseEncoding: 'binary'
    }).then(r => r.data);

    let zip = await new jszip().loadAsync(file);

    // create oada resources for each attachment
    await Promise.map(Object.keys(zip.files || {}), async (key) => {
      let data = await zip.file(key).async("arraybuffer");
      let response = await axios({
        method: 'post',
        url: `https://${DOMAIN}/resources`,
        data,
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
      TARGET_PDFS[_id] = {
        tp,
        flId: item._id,
        pdfId: _id,
        mirrorId
      }

      //link the file into the documents list
      info(`Linking file to documents list at ${TP_PATH}/${tp}/shared/trellisfw/documents`);
      data = { _id, _rev: 0 }
      await CONNECTION.post({
        path: `${TP_PATH}/${tp}/shared/trellisfw/documents`,
        data,
        tree,
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

  if (!found) console.log('not found', item, TARGET_JOBS);
  if (!found) return;
  if (!found) console.log('not found222');
  if (!found.result) return;

  //2. 
  info(`Moving approved document to [${TP_PATH}/${tp}/bookmarks/trellisfw/${found.result.type}/${found.result.key}]`);
  console.log('FOUND RESULT', found.result);
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
    delete TARGET_PDFS[TARGET_JOBS[found.jobId].trellisId];
    delete TARGET_JOBS[found.jobId];
  } catch (err) {
    error('Error moving document result into trading-partner indexed docs')
    error(err)
  }
}

// Validate documents that have not yet be approved
async function validatePending(trellisDoc, flDoc, type) {
  info(`Validating pending doc [${trellisDoc._id}]`);
  let message;
  let status;
  switch(type) {
    case 'cois':
      //TODO: current fix to timezone stuff:
      let flExp = moment(flDoc['food-logiq-mirror'].expirationDate).subtract(12, 'hours');
      let trellisExp = moment(Object.values(trellisDoc.policies)[0].expire_date);

      if (flExp.isSame(trellisExp)) {
        status = true;
      } else {
        message = 'Expiration date does not match PDF document.';
        status = false;
      }

      if (!status) info(`Food logiq expiration [${flExp}] Trellis expiration [${trellisExp}]`)
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

  return {message, status}
}

async function businessToTp(member) {
  let sap_id = member.internalId || sha256(JSON.stringify(member));
  let tp = BUSINESSES[sap_id];
  return tp;
  //Some magical fuzzy search of trading partners to match to the given
  //business if we don't know the sap id;

};

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
    } catch(err) {
      await Promise.delay(2000).then(async () => {
        result = await axios(request).then(r => r.data);
      })
    }
  })

  flDoc = await CONNECTION.get({
    path: `${job.mirrorId}`
  }).then(r => r.data)

  // Link to the original food-logiq document
  let resp = await axios({
    method: 'put',
    url: `https://${DOMAIN}${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}/_meta`,
    headers: {
      Authorization: `Bearer ${TRELLIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    data: {
      services: {
        'fl-sync': {
          document: {_id: job.mirrorId}
        }
      }
    }
  })
  let bid = BUSINESSES[job.tp].sap_id;
    console.log(bid);

  //let assess = await spawnAssessment(BID, 2000001, 5000001, 1000001, 1000001, 1000002);

  let {status, message} = await validatePending(result, flDoc, job.result.type);

  if (status) {
    await axios({
      method: 'post',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/capa`,
      headers: {Authorization: FL_TOKEN},
      data: {
        details: 'Document passed validation. Ready for approval.',
        type: "change_request",
      }
    })
  } else {
    //reject to FL
    await axios({
      method: 'put',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/approvalStatus/rejected`,
      headers: { Authorization: FL_TOKEN },
      data: { status: "Rejected" }
    })

    //Post message regarding error
    await axios({
      method: 'post',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/capa`,
      headers: { Authorization: FL_TOKEN },
      data: {
        details: `${message} Please correct and resubmit.`,
        type: "change_request",
      }
    })

    await axios({
      method: 'put',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/submitCorrectiveActions`,
      headers: { Authorization: FL_TOKEN },
      data: {}
    })
  }

  info(`Job result stored at trading partner ${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`)
  } catch (err) {
    console.log(err);
  }

}

async function fetchAssessmentTemplates() {
  await fetchAndSync({
    from: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/assessmenttemplate`,
    to: `${SERVICE_PATH}/assessment-templates`,
//    forEach: async (item) => {
//      console.log(item);
      
//    }
  })
}

// The main routine to check for food logiq updates
async function pollFl() {
  try {
    // Get known trading partners
    let resp = await CONNECTION.get({
      path: `${TP_PATH}/expand-index`,
    })
    TPs = resp.data;

    await Promise.each(Object.keys(TPs || {}), async (i) => {
      // 1. Get business id
      let item = TPs[i];
      if (!item.sap_id) return;
      BUSINESSES[item.sap_id] = i;
    })

    //Get assessment templates
    let templates = await fetchAssessmentTemplates();

    if (!CURRENTLY_POLLING) {
      CURRENTLY_POLLING = true;

      // Sync list of suppliers
      info(`Fetching FL community members...`)
      await fetchAndSync({
        from: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/communities/${SF_FL_CID}/memberships`,
        to: (i) => `${SERVICE_PATH}/businesses/${i.business._id}`,
        forEach: async (item) => {
          await getResourcesByMember(item);
        }
      })
      CURRENTLY_POLLING = false;
    }
  } catch (err) {
    CURRENTLY_POLLING = false;
    error(err);
    throw err;
  }
}

async function fetchAndSync({ from, to, pageIndex, forEach }) {
  try {
    let request = {
      method: `get`,
      url: from,
      headers: { 'Authorization': FL_TOKEN },
    }
    if (pageIndex) request.params = { pageIndex };
    response = await axios(request);


    // Manually check for changes; Only update the resource if it has changed!
    await Promise.each(response.data.pageItems, async (item) => {
      let sync;
      if (to) {
        let path = typeof (to) === 'function' ? await to(item) : `${to}/${item._id}`
        try {
          let resp = await CONNECTION.get({ path })

          // Check for changes to the resources
          let equals = _.isEqual(resp.data['food-logiq-mirror'], item)
          if (!equals) info('Document difference detected. Syncing...');
          if (!equals) {
            sync = true;
          }
        } catch (err) {
          if (err.status === 404) {
            error(`Corresponding resource is not already on trellis. Syncing...`);
            sync = true;
          } else {
            error(`An error occurred during fetchAndSync`);
            error(err);
            throw err
          }
        }
        // Now, sync
        if (sync) await CONNECTION.put({
          path,
          tree,
          data: { 'food-logiq-mirror': item },
        })
      }
      if (forEach) await forEach(item)
    })

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      await fetchAndSync({ from, to, pageIndex: pageIndex ? pageIndex++ : 1 })
    }
    return;
  } catch (err) {
    info('getBusinesses Error', err.response ? err.response.status : 'Please check error logs');
    throw err;
  }
}

/**
 * assigns item data (new business) into the trading partner template
 * @param {*} data 
 * @param {*} item 
 * @returns 
 */
async function assignData(data, item) {
  data.name = item[FL_MIRROR]["business"]["name"] ? item[FL_MIRROR]["business"]["name"] : "";
  data.address = item[FL_MIRROR]["business"]["address"]["addressLineOne"] ? item[FL_MIRROR]["business"]["address"]["addressLineOne"] : "";
  data.city = item[FL_MIRROR]["business"]["address"]["city"] ? item[FL_MIRROR]["business"]["address"]["city"] : "";
  data.email = item[FL_MIRROR]["business"]["email"] ? item[FL_MIRROR]["business"]["email"] : "";
  data.phone = item[FL_MIRROR]["business"]["phone"] ? item[FL_MIRROR]["business"]["phone"] : "";
  data.foodlogiq = item[FL_MIRROR] ? item[FL_MIRROR] : "";
  return data;
}//assignData

/**
 * adds a trading-partner to the trellisfw when
 * a new business is found under services/fl-sync/businesses
 * @param {*} item 
 * @param {*} key 
 */
async function addTP2Trellis(item, key) {
  let _path_tp_id = TL_TP_PATH + key;
  try {
    if (typeof TradingPartners[key] === 'undefined') {//adds the business as trading partner
      let data = _.cloneDeep(trellisTPTemplate);

      if (typeof item["masterid"] === 'undefined' || item["masterid"] === "") {
        _path_tp_id = TL_TP_UNIDENTIFIED_PATH + key;
      } else {
        data.sapid = item["masterid"];
        data.masterid = item["masterid"];
      }//if

      if (typeof item[FL_MIRROR] === 'undefined') {
        let _path = item["_id"];
        await CONNECTION.get({
          path: _path
        }).then(async (result) => {
          data = await assignData(data, result.data);
        }).catch((error) => {
          info("--> error when retrieving business ", error);
          console.log("--> Error: when retrieving business. ", error);
        });
      } else {//if
        data = await assignData(data, item);
      }//if

      await CONNECTION.put({
        path: _path_tp_id,
        tree: trellisfw_tp_tree,
        data: data
      }).then((result) => {
        info("--> business mirrored. ", result);
        console.log("--> business mirrored. Path: ", _path_tp_id);
      }).catch((error) => {
        info("--> error when mirroring ", error);
      });
      TradingPartners[key] = data;
    } else {
      console.log("--> do nothing.");
    }//if
  } catch (error) {
    info("--> error ", error);
    throw error;
  }
}//addTP2Trellis

/**
 * watches for changes in the fl-sync/businesses
 */
async function watchTrellisFLBusinesses() {
  info(`Started ListWatch on Trellis FL Businesses ...`)
  const watch = new ListWatch({
    path: TL_FL_BS,
    name: `trellis-fl-businesses-trellis-tp-mirror`,
    conn: CONNECTION,
    resume: true,
    onAddItem: addTP2Trellis
  });
}//watchTrellisFLBusinesses

/** ====================== ASSESSMENTS ===================================== {
 * updates the content of a spawned assessment
 * @param path spawned assessment url 
 * @param data complete content of the assessment
 */
async function updateAssessment(path, data) {
  await axios({
    method: "put",
    url: path,
    headers: { 'Authorization': FL_TOKEN },
    data: data
  }).then((result) => {
    info("--> assessment created. ", result);
  }).catch((error) => {
    error("--> Error when updating the assessment.");
    //console.log("--> Error when updating the assessment. ", error);
  });
}//updateAssessment

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
async function spawnAssessment(bid, general, aggregate, auto, umbrella, employer, worker) {
  let PATH_SPAWN_ASSESSMENT = `https://sandbox-api.foodlogiq.com/v2/businesses/${bid}/spawnedassessment`;
  let PATH_TO_UPDATE_ASSESSMENT = PATH_SPAWN_ASSESSMENT;
  let _assessment_template = _.cloneDeep(assessment_template);
  _assessment_template["initiatedByBusiness"]["_id"] = bid;
  _assessment_template["performedOnBusiness"]["_id"] = bid;

  //spawning the assessment with some (not all) values 
  await axios({
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
    answer_content["answers"][3]["answerNumeric"] = umbrella;
    answer_content["answers"][4]["answerNumeric"] = employer;
    answer_content["answers"][5]["answerNumeric"] = worker;

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
    await updateAssessment(PATH_TO_UPDATE_ASSESSMENT, ASSESSMENT_BODY);
  }).catch((error) => {
    error("--> Error when spawning an assessment.");
    //console.log("--> Error when spawning an assessment.", error);
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

async function mockFL({ url }) {
  //1. Strip query parameters
  let u = urlLib.parse(url);
  let path = u.pathname.replace(/\/businesses\/\S*?\//, '/businesses/{{BusinessID}}/')
  path = path.replace(/\/communities\/\S*?\//, '/communities/{{CommunityID}}/');
  path = path.replace(/\/documents\/\S*?\//, '/documents/{{DocumentID}}/');

  if (u.search) path += u.search;
  path = path.replace(/sourceBusiness=\S*?\&/, 'sourceBusiness={{SupplierID}}&')
  path = path.replace(/versionUpdated=\S*?$/, 'versionUpdated={{Date}}')

  let string = `{{Host}}${path}`

  //  return { data: sampleDocs[string] };
}

initialize()

async function testMock() {
  let url = `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/abc123/attachments`
  let res = mockFL({ url });
}

module.exports = (args) => {
  if (args && args.initialize === false) {
  } else {
    initialize();
  }
  return {
    pollFl,
    initialize,
    testing: {
      mirror,
      setPath,
      setConnection,
      setTree,
      SERVICE_PATH,
      tree,
    }
  }
}

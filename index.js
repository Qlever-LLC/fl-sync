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
const TL_FL_BS = config.TL_FL_BS;

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
let TL_TP_PATH = "/bookmarks/trellisfw/trading-partners";
let TL_TP_UNIDENTIFIED_PATH = "/bookmarks/trellisfw/trading-partners/unidentified-trading-partners-index";

//const { getToken } = require(SHARED_PATH+'/service-user');

//const DOMAIN = config.get('fl-shared:domain') || 'https://localhost'
let TOKEN;
let CURRENTLY_POLLING = false;
let checkInterval = 10*1000; //check oada every 1 minute
let INTERVAL_MS = 20*1000; //1 min in ms
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
  } catch(err) {
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
      TARGET_JOBS[jobId].result = {type, key, _id: c.body.result[type][key]._id};
      await handleScrapedResult(jobId)
    })
  })

  // Provide select update messages to FL
  let details;
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
        details = `PDF identified as document type: ${val.type}`
        break;
      case 'success':
        details = 'PDF successfully extracted.';
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
  setInterval(checkTime, checkInterval)
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
      data = { _id, _rev: 0}
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
      data: {_id: found.result._id},
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${TRELLIS_TOKEN}`
      },
    })
    delete TARGET_PDFS[TARGET_JOBS[found.jobId].trellisId];
    delete TARGET_JOBS[found.jobId];
  } catch(err) {
    error('Error moving document result into trading-partner indexed docs')
    error(err)
  }
}

// Validate documents that have not yet be approved
async function validatePending(trellisDoc, flDoc, type) {
  info(`Validating pending doc [${trellisDoc._id}]`);
  let valid;
  switch(type) {
    case 'cois':
      //TODO: how to fix time zone stuff
      let flExp = moment(flDoc['food-logiq-mirror'].expirationDate).subtract(12, 'hours');
      let trellisExp = moment(Object.values(trellisDoc.policies)[0].expire_date);

      if (flExp.isSame(trellisExp)) valid = true;
      if (!valid) info(`Food logiq expiration [${flExp}] Trellis expiration [${trellisExp}]`)
      break;
    default:
      break;
  }
  info(`Validation of pending document [${trellisDoc._id}]: ${valid}`);
  return valid;
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
  let valid = await validatePending(result, flDoc, job.result.type);

  if (valid) {
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
      headers: {Authorization: FL_TOKEN},
      data: { status: "Rejected" }
    })

    //Post message regarding error
    await axios({
      method: 'post',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/capa`,
      headers: {Authorization: FL_TOKEN},
      data: {
        details: 'Expiration date does not match PDF document. Please correct and resubmit',
        type: "change_request",
      }
    })

    await axios({
      method: 'put',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${job.flId}/submitCorrectiveActions`,
      headers: {Authorization: FL_TOKEN},
      data: {}
    })

  }

  info(`Job result stored at trading partner ${TP_PATH}/${job.tp}/shared/trellisfw/${job.result.type}/${job.result.key}`)
  } catch(err) {
     console.log(err);
  }

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

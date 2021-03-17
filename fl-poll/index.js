// TODO: For config library, perhaps rework to use its NODE_CONFIG_DIR feature
process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
const LOCAL = process.env.LOCAL_WINFIELD;
//if (LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
const axios = require('axios');
const debug = require('debug');
const trace = debug('fl-sync:trace');
const  info = debug('fl-sync:info');
const  warn = debug('fl-sync:warn');
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
const sampleDocs = require('./sampleDocs.js');
const ListWatch = oadalist.ListWatch;
//const axios = mockFL;
let BUSINESSES = {};
//let tree = require(SHARED_PATH+'/tree').mirrorTree;
let tree = require('./tree.js');

//const { getToken } = require(SHARED_PATH+'/service-user');

//const DOMAIN = config.get('fl-shared:domain') || 'https://localhost'
let TOKEN;
let CURRENTLY_POLLING = false;
let checkInterval = 0.5*60*1000; //check oada every 1 minute
let INTERVAL_MS = 1*60*1000; //1 min in ms
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
    let response = await CONNECTION.get({path:`${SERVICE_PATH}`})

    manualPoll = response.data.manualPoll || process.env.MANUAL_POLL;

    let freshPoll = process.env.FRESH_POLL;

    info(`/lastPoll endpoint found; last update was: ${response.data.lastPoll}`);
    if (!freshPoll && response.data.lastPoll) lastPoll = moment(response.data.lastPoll);
  } catch (err) {
    if (err.status === 404) {
      info(`/lastPoll does not exist. Omitting versionUpdate param for a fresh poll.`);
    } else throw err;
  }

  let current = moment().utc();
  let nextUpdate = (lastPoll ? lastPoll.clone() : current.clone()).add(INTERVAL_MS)
  info(`currentTime is ${current}, nextUpdate is ${nextUpdate}. ${!lastPoll ? 'lastPoll was undefined. Polling.' :  current>nextUpdate ? 'Polling': 'Not Polling'}`);
  if (manualPoll) info(`Manual poll detected. Getting changes since last poll`);
  if (!lastPoll || current>nextUpdate || manualPoll) {
//    if (lastPoll) lastPoll = lastPoll.format('ddd, DD MMM YYYY HH:mm:ss +0000');
    current = current.format();
    try {
      await pollFl();
    } catch (err) {
      info('CheckTime Error', err);
      error(err);
    }
  // 3. Success. Now store update the last checked time.
    info(`Storing new "lastPoll" value: ${current}. Next run will occur on or after this time.`);
    
    if (manualPoll) info(`Resetting manualPoll to false`)

    if (manualPoll) await CONNECTION.put({
      path: SERVICE_PATH,
      tree,
      data: {manualPoll: false}
    })

    return CONNECTION.put({
      path: SERVICE_PATH,
      tree,
      data: {lastPoll: current}
    })
  }
}

async function getLookup(item, key) {
  console.log('getLookup', item, key);
  let jobId = key;
  let trellisId = item.config.pdf._id;

  console.log('getLookup trellisId', trellisId)
  if (!trellisId) return;
  let flId = TARGET_PDFs[trellisId];
  console.log('getLookup flId', flId);

  if (!flId) return false;
  console.log('got a fl id', flDocId)

  TARGET_JOBS[key] = {
    flId: TARGET_PDFS[trellisId],
    trellisId
  }

}

async function onTargetUpdate() {
  console.log('onTargetUpdate');

}

async function watchTargetJobs() {

  const watch = new ListWatch({
    path: `/bookmarks/services/target/jobs`,
    name: `target-jobs-fl-sync`,
    conn: CONNECTION,
    resume: true,
    //onAddItem: getLookup,
    onChangeItem: onTargetUpdate
  })
  console.log('listwatching target jobs');
}

async function initialize() {
  info('Initializing fl-poll service');
  TOKEN = await getToken();
  // Connect to oada
  try {
  var conn = await oada.connect({
    domain: 'https://'+DOMAIN,
    token: TOKEN,
  })
  } catch(err) {
     console.log(err);
  }
  setConnection(conn); 
//  await watchTargetJobs();
  await checkTime();
//  await pollFl();

  /*

  await checkTime();
  setInterval(checkTime, checkInterval)
  */
}

async function getResourcesByMember(member) {
  let bid = member.business._id;
  let tp = await businessToTp(member);
  if (!tp) return;
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    console.log('fetching ', type);
    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/${type}?sourceCommunities=${SF_FL_CID}&sourceBusiness=${bid}&versionUpdated=${date}..`,
      to: `${SERVICE_PATH}/businesses/${bid}/${type}`,
      forEach: async function handleItems(item) {
        console.log('handling items', type, item._id);
        if (type === 'locations') return console.log(item);
        if (type === 'documents') console.log(item.shareSource.approvalInfo.status)
        if (item.shareSource && item.shareSource.approvalInfo.status === "approved") {
          console.log('found an approved', item._id);
          await handleApproved(item, type, bid, tp)
        } else if (item.shareSource && item.shareSource.approvalInfo.status === 'rejected') {
          console.log("found a reject", item._id);
        } else if (item.shareSource && item.shareSource.approvalInfo.status === 'awaiting-review') {
          console.log('found a pending', item._id);
          await handlePending(item, type, bid, tp)
        }
      }
    })
  })
  return;
}

// Handle docs pending approval
async function handlePending(item, fltype, bid, tp) {
  //1. Post the documents to target
  if (fltype === 'documents') {
    // Retrieve the attachment(s)
    await fetchDocAttachments(item, bid, tp, 'shared');
  }
}

async function fetchDocAttachments(item, bid, tp, destination) {
    try {
  // retrieve the attachments and unzip
  let file = await axios({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${item._id}/attachments`,
    headers: {Authorization: FL_TOKEN},
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
        Authorization: 'Bearer '+TRELLIS_TOKEN
      }
    })

    /* TODO: Fix this in ?client?
    let response = await CONNECTION.post({
      path: `/resources`,
      data,
      headers: {
        'Content-Disposition': 'inline',
        'Content-Type': 'application/pdf'
      }
    })
    */

    let _id = response.headers['content-location'];
    await CONNECTION.put({
      path: `${_id}/_meta`,
      data: {filename: key},
      headers: {'content-type': 'application/json'},
    })

    _id = _id.replace(/^\//, '');

    // Create a lookup in order to track target updates
    console.log(`creating lookup from trellis ${_id} to fl ${item._id}`);
    TARGET_PDFS[_id] = item._id

    //link the file into the documents list
    console.log('putting to shared now', `${TP_PATH}/${tp}/${destination}/trellisfw/documents/${item._id}`);
      data = { _id}
    await CONNECTION.post({
      path: `${TP_PATH}/${tp}/${destination}/trellisfw/documents`,
      data,
      tree,
    })
  })
    } catch(err) {
      console.log(err);
    }
}

// Move approved docs into final location
//TODO No need to rescrape if accepted? Lookup and link in the already-scraped 
// result
async function handleApproved(item, type, bid, tp) {
  if (type === 'documents') {
    // Retrieve the attachment(s)
   // await fetchDocAttachments(item, type, bid, tp, 'bookmarks');
    // put FL data into the virtual doc

  }
}

// Validate documents that have not yet be approved
async function validatePending(item) {
  console.log('validating document result', item);
  return true;
  // 2. Access relevant internal system lookups
  // 3. Compare extracted data against Food Logiq fields
}



async function businessToTp(member) {
  let sap_id = member.business.sap_id || sha256(JSON.stringify(member));
  let tp = BUSINESSES[sap_id];
  return tp;
  //Some magical fuzzy search of trading partners to match to the given
  //business if we don't know the sap id;

};

async function handleScrapedFsqaAudit(tp) {
  return async function(item, key) {
    console.log('DETECTED FSQA audit');
    /*
    let valid = await validatePending(item);

    //Approve
    if (valid) await axios({
      method: 'put',
      url: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/${item._id}/approvalStatus/approved`,
      headers: {Authorization: FL_TOKEN},
      data: {}
    })
    */

  }
}

async function watchDocs(tp) {
  console.log('watching shared for tp', tp);

  // Ensure watch endpoint exists
  await CONNECTION.put({
    path: `${TP_PATH}/${tp}/shared/trellisfw/fsqa-audits`,
    data: {},
    tree,
  })

  let func = handleScrapedFsqaAudit(tp);
  /*
  const watch = new ListWatch({
    path: `${TP_PATH}/${tp}/shared/trellisfw/fsqa-audits`,
    name: `target-result-fsqa-audits-${tp}`,
    conn: CONNECTION,
    resume: true,
    onAddItem: func,
  })
  */

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

      // 2. Handle docs processed by target
      await watchDocs(i);
       
    })

    if (!CURRENTLY_POLLING) {
      CURRENTLY_POLLING = true;

    // Sync list of suppliers
      console.log('fetching trading partner businesses');
      await fetchAndSync({
        from: `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/communities/${SF_FL_CID}/memberships`,
        to: (i) => `${SERVICE_PATH}/businesses/${i.business._id}`,
        forEach: async (item) => {
          console.log('get resources', item.business.name);
          await getResourcesByMember(item);
        }
      })
    }
  } catch(err) {
    console.log(err);
  }
}

async function handleTargetUpdates() {
  console.log('got an update');
}

async function fetchAndSync({from, to, pageIndex, forEach}) {
  try {
    let request = {
      method: `get`,
      url: from,
      headers: {'Authorization': FL_TOKEN},
    }
    if (pageIndex) request.params = {pageIndex};
    response = await axios(request);
    info(`GET ${from}`)

    await Promise.each(response.data.pageItems, async (item) => {
      let sync;
      if (to) {
        let path = typeof(to) === 'function' ? await to(item) : `${to}/${item._id}`
        try {
          let resp = await CONNECTION.get({path})
          // Check for changes to the resources
          if (true) {
            sync = true;
          }
        } catch(err) {
          console.log(err);
          if (err.status === 404) {
            sync = true;
          } else throw err
        }
        // Now, sync
        if (sync) await CONNECTION.put({
          path,
          tree,
          data: {'food-logiq-mirror': item},
        })
      }
      if (forEach) await forEach(item)
    })

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      await fetchAndSync({from, to, pageIndex: pageIndex ? pageIndex++ : 1})
    }
    return;
  } catch(err) {
    info('getBusinesses Error', err.response ? err.response.status : 'Please check error logs');
    throw err;
  }
}

function setConnection(conn) {
  CONNECTION = conn;
}

function setTree(t) {
  tree = t;
}

function setPath(newPath) {
  SERVICE_PATH = newPath;
}

async function mockFL({url}) {
  console.log('running a mock', url);
  //1. Strip query parameters
  let u = urlLib.parse(url);
  let path = u.pathname.replace(/\/businesses\/\S*?\//, '/businesses/{{BusinessID}}/')
  path = path.replace(/\/communities\/\S*?\//, '/communities/{{CommunityID}}/');
  path = path.replace(/\/documents\/\S*?\//, '/documents/{{DocumentID}}/');

  if (u.search) path+=u.search;
  path = path.replace(/sourceBusiness=\S*?\&/, 'sourceBusiness={{SupplierID}}&')
  path = path.replace(/versionUpdated=\S*?$/, 'versionUpdated={{Date}}')

  let string = `{{Host}}${path}`

  return {data: sampleDocs[string]};
}

initialize()
async function testMock() {
  let url = `${FL_DOMAIN}/v2/businesses/${SF_FL_BID}/documents/abc123/attachments`
  let res = mockFL({url})
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

import test from 'ava';
import Promise from 'bluebird';
import { setTimeout } from 'timers/promises';
import { JsonObject, connect, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import moment from 'moment';
import axios from 'axios';
import tree from '../dist/tree.js';
import {initialize as service} from '../dist/index.js';
import {isObj, FlObject} from '../dist/mirrorWatch.js';
import { coi } from './documents/coi.js';
import config from "../dist/config.js";
//import {makeTargetJob, sendUpdate} from './dummyTarget.js'
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const SUPPLIER = config.get('foodlogiq.testSupplier.id')
const TOKEN = process.env.TOKEN || '';// || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
import type {TreeKey} from '@oada/list-lib/lib/tree';
let SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
let SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']){
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}
const INTERVAL_MS = config.get('foodlogiq.interval')*1000;
//const pending = `${SERVICE_PATH}/jobs/pending`
let oada: OADAClient

test.before(async (t) => {
  t.timeout(60000);
  oada = await connect({domain: DOMAIN, token: TOKEN});
  oada.put({
    path: `${SERVICE_PATH}/_meta/oada-poll/food-logiq-poll`,
    //tree,
    data: { lastPoll: moment().subtract(1, 'minutes').utc().format()}
  })
  // Blow away the existing jobs queue
  let jobKeys = await oada.get({
    path: `${SERVICE_PATH}/jobs/pending`
  }).then(r => Object.keys(r!.data || {}).filter(key => key.charAt(0) !== '_'))
  .catch(err => {
    if (err.status !== 404) throw err;
    return [];
  })
  await Promise.map(jobKeys, async (jobKey) => {
    await oada.delete({
      path: `${SERVICE_PATH}/jobs/pending/${jobKey}`
    })
  })

  //Blow away the existing coi docs created
  let keys = await oada.get({
    path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois`
  }).then(r => Object.keys(r!.data || {}).filter(key => key.charAt(0) !== '_'))
  .catch(err => {
    if (err.status !== 404) throw err;
    return [];
  })
  await Promise.map(keys, async (key) => {
    await oada.delete({
      path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois/${key}`
    })
  })

  await service({
    polling: true,
    target: true,
    master: false,
    service: true,
    watchConfig: true
  })
});

test.skip('Should fail and warn suppliers when multiple PDFs are attached on COI documents.', async (t) => {
  t.timeout(200000);
  let data = coi;
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "multi-files-attached");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

//TODO: Find an example of this and get the flId
test.skip('Should allow suppliers to upload multiple files attached on some doc types.', async (t) => {
  t.timeout(200000);
  let data = await getFlDoc("");
  //TODO: This needs to be addressed when I get to it; rerunFlDoc is for failures
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "multi-files-attached");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

test.skip(`Should fail on Target fail due to multiple COIs in one pdf`, async (t) => {
  t.timeout(200000);
  let _id = "resources/205t2wh2G1a9UzEtxaPh0cDANr1";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-multiple-docs-combined");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

//Keep this one skipped until I can make attachments "bad"
//TODO: Find an example of this
test.skip('Should fail when attachments cannot be retrieved.', async (t) => {
  t.timeout(200000);
  let data = coi;
  data.attachments = [
    data.attachments[0]!
  ];
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "bad-fl-attachments");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

//TODO: The old examples of this no longer throw that particular error.
//Target may have fixed the issue and may no longer throw that error.
test.skip(`Should fail on Target validation failure (COI)`, async (t) => {
  t.timeout(200000);
  let _id = "resources/20xekuS2XiDWIQJBJfqau7tHTxF";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-validation");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

//TODO: Determine whether certain validation pieces regarding COI holder field are checked;
test.skip(`Should fail on Target validation failure (COI) - specific holder checks???`, async (t) => {
  t.timeout(200000);
  let _id = "resources/205t2sVsqFaMSZTcQLb5oTI2yFl";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-validation");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

test.skip(`Should fail on Target fail on unrecognized format`, async (t) => {
  t.timeout(200000);
  let _id = "resources/205z6XnG6iPcyw04yYLMSPkRSUr";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-unrecognized");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
});

//This now gets recognized as a nutrition information document
test(`Should fail on Target failure to identify doc`, async (t) => {
  t.timeout(200000);
  let _id = "resources/26ZgYWfzAvX87PR8Y9JKXium7mm";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-unrecognized");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
})

//File is not a Textual PDF,requires OCR to be processed
//These are now hanging. Inquire...
test.skip(`Should fail on Target failure due to not text pdf, needs OCR`, async (t) => {
  t.timeout(200000);
  let _id = "resources/206fbmvoqSwsgeclcHpTceT10kU";
  let data = await getFlDoc(_id);
  let {jobKeys, jobKey, keyCount} = await rerunFlDoc(data, "target-unrecognized");
  t.assert(jobKeys[jobKey])
  t.is(Object.keys(jobKeys).length, keyCount+1);
})

test.skip(`Should approve a valid COI document.`, async (t) => {
  t.timeout(300000)
  let data = coi;
  data.attachments.pop();
  let {jobKey} = await postAndPause(data, oada);
  await setTimeout(100000)
  console.log("CONTINUING", `${SERVICE_PATH}/jobs/success/day-index/${moment().format('YYYY-MM-DD')}/${jobKey}`);

  let job = await oada.get({
    path: `${SERVICE_PATH}/jobs/success/day-index/${moment().format('YYYY-MM-DD')}/${jobKey}`
  }).catch(err => {
    console.log(err);
    return {status: 0}
  })

  t.is(job.status, 200);
});

test.skip(`Should reject a COI with expirations that do not match the user-entered date.`, async (t) => {
  let _id = "";
  let data = await getFlDoc(_id);
  let flId = await postDoc(data, oada);
  await setTimeout(100000)

  let jobId = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta/services/fl-sync/jobs`
  }).then(r => {
    if (r && typeof r.data === 'object') {
      // @ts-ignore
      return Object.keys(r.data)[0]
    } else return undefined;
  })
  let jobKey = jobId!.replace(/^resources\//, '');

  let job = await oada.get({
    path: `${SERVICE_PATH}/jobs/success/day-index/${moment().format('YYYY-MM-DD')}/${jobKey}`
  })
  t.is(job.status, 200);

  let doc = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`
  }).then(r => r.data as JsonObject)
  if (!isObj(doc)) throw new Error("bad doc");
  let flDoc = doc["food-logiq-mirror"] as unknown as FlObject;
  t.is(flDoc.shareSource.approvalInfo.status, "rejected")
});

test.skip(`Should reject a COI with insufficient policy coverage.`, async (t) => {
  let _id = "";
  let data = await getFlDoc(_id);
  let flId = await postDoc(data, oada);
  await setTimeout(100000)

  let jobId = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta/services/fl-sync/jobs`
  }).then(r => {
    if (r && typeof r.data === 'object') {
      // @ts-ignore
      return Object.keys(r.data)[0]
    } else return undefined;
  })
  let jobKey = jobId!.replace(/^resources\//, '');

  let job = await oada.get({
    path: `${SERVICE_PATH}/jobs/failure/fl-validation/day-index/${moment().format('YYYY-MM-DD')}/${jobKey}`
  })
  t.is(job.status, 200);

});

test.skip(`Shouldn't queue a job if already approved by non-trellis user.`, async (t) => {
  let flId = '618ab8c04f52f0000eae7220';
  let { data } = await axios({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${flId}`,
    headers: {
    "Authorization": `${FL_TOKEN}`,
    }
  }).then(r => {
    console.log(r);
    return r
  })

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  console.log('putting', `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: {'food-logiq-mirror': data},
    tree
  })
  await setTimeout(15000)

  let result = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`
  }).then(r => r.data as JsonObject)
  t.is(result.status, 200);

//  t.assert(jobKeys[jobKey])
//  t.is(Object.keys(jobKeys).length, keyCount+1);
});

test.skip(`Shouldn't queue a job if already rejected by non-trellis user.`, async (t) => {
  let flId = '618ab8c04f52f0000eae7220';
  let { data } = await axios({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${flId}`,
    headers: {
    "Authorization": `${FL_TOKEN}`,
    }
  }).then(r => {
    console.log(r);
    return r
  })

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  console.log('putting', `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: {'food-logiq-mirror': data},
    tree
  })
  await setTimeout(15000)

  let result = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`
  }).then(r => r.data as JsonObject)
  t.is(result.status, 200);
  //t.assert(jobKeys[jobKey])
  //t.is(Object.keys(jobKeys).length, keyCount+1);
});

/*
it(`Should handle an fl-sync job that is queued on startup.`, async () => {
  //Post a dummy job to the job queue

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  console.log('putting', `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: {'food-logiq-mirror': data},
    tree
  })
  await setTimeout(jobwaittime)

  let result = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`
  }).then(r => r.data)

  //@ts-ignore
  expect(result?.services?.['fl-sync']?.jobs).to.equal(undefined);
});
 */

// I think this just occurs when the PDF is not a pdf because fl-sync didn't link it properly to the config
//test.skip(`Should fail on Target fail due to corrupted pdf`, async (t) => {
//});




test.after(async () => {
  /*
  let data = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`,
  }).then(r => r.data);
  // @ts-ignore
  let list = Object.keys(data).filter(k => k.charAt(0) !== '_')

  for (const i of list) {
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${i}`,
    })
  }

  let d = await oada.get({
    path: `${SERVICE_PATH}/businesses`,
  }).then(r => r.data);
  // @ts-ignore
  let l = Object.keys(d).filter(k => k.charAt(0) !== '_')
  l = l.filter(k => k !== '61c22e047953d4000ee0363f')

  for (const i of l) {
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${i}`,
    })
  }
 */
});




async function postDoc(data: Body, oada: OADAClient) {
  let result = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`
  }).then(r => r.data)
  .catch(err => {
    if (err.status === 404) {
      return {};
    } else throw err;
  })
  if (typeof result !== 'object') throw new Error('Bad data');
  // @ts-ignore
  let bef = Object.keys(result).filter(k => k.charAt(0) !== '_')
  await axios({
    method: 'post',
    url: `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents`,
    data,
    headers: {
      "Authorization": `${FL_TOKEN}`,
    }
  })
  await setTimeout(INTERVAL_MS+5000)
  let resp = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`
  }).then(r => r.data)
  if (typeof resp !== 'object') throw new Error('Bad data');
  // @ts-ignore
  let aft = Object.keys(resp).filter(k => k.charAt(0) !== '_')
  // @ts-ignore
  let flId = aft.filter(k => bef.indexOf(k) < 0)
  // @ts-ignore
  flId = flId[0];

  return flId
}

async function getFlDoc(_id: string) {
  let resp = await oada.get({
    path: `/${_id}`
  }).then(r => r.data as JsonObject)
  if (!resp["food-logiq-mirror"]) throw new Error("food-logiq-mirror")
  return trellisMirrorToFlInput(resp["food-logiq-mirror"]) as unknown as Body;
}

async function postAndPause(data: Body, oada: OADAClient) {
  let flId = await postDoc(data, oada);
  await setTimeout(15000)

  let jobId = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta/services/fl-sync/jobs`
  }).then(r => {
    if (r && typeof r.data === 'object') {
      // @ts-ignore
      return Object.keys(r.data)[0]
    } else return undefined;
  })
  let jobKey = jobId!.replace(/^resources\//, '');
  if (jobId === undefined) throw new Error('no job id')

  return {jobKey, jobId, flId}
}

async function rerunFlDoc(data: Body, failType: string) {
  let jobsResultPath = `${SERVICE_PATH}/jobs/failure/${failType}/day-index/${moment().format('YYYY-MM-DD')}`

  let keyCount = await oada.get({
    path: jobsResultPath
  }).then(r => Object.keys(r.data as JsonObject).length)
  .catch(err => {
    if (err.status === 404) {
      return 4; //number of internal _-prefixed keys of an empty resource
    } else throw err;
  })

  let {flId, jobId, jobKey} = await postAndPause(data, oada);
  await setTimeout(40000);

  let jobKeys = await oada.get({
    path: jobsResultPath
  }).then(r => r.data as JsonObject)

  return {jobKeys, jobKey, flId, jobId, keyCount}
}

async function trellisMirrorToFlInput(data: any) {
  let newData = coi as unknown as FlBody;

  newData.shareRecipients = [data.shareSource];
  newData.attachments = data.attachments;

  return newData as FlBody
}

interface FlBody extends FlObject {
  products: [];
  locations: [];
  attachments: {};
  shareRecipients: [{
    type: {};
    community: {};
    shareSpecificAttributes: {};
  }];
}

/*
interface TrellisFlMirror extends FlObject {
  attachments: {};
  community: {};
  shareSource: {
    community: {};
  };
}
*/

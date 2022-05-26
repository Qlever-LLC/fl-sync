import test from 'ava';
import Promise from 'bluebird';
import { setTimeout } from 'timers/promises';
import { connect, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import moment from 'moment';
import axios from 'axios';
import tree from '../dist/tree.js';
import {initialize as service} from '../dist/index.js';
import {types as flDocTypes} from './documents/s3Infos.js'
import { coi } from './documents/coi.js';
import config from "../dist/config.js";
//import {makeTargetJob, sendUpdate} from './dummyTarget.js'
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const SUPPLIER = config.get('foodlogiq.testSupplier.id')
const SF = config.get('foodlogiq.community.owner.id');
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
let doctypes : any;

test.before(async (t) => {
  t.timeout(60000);
  doctypes = await fetchFlDocTypes();
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

test('Run new doc types', async (t) => {
  t.timeout(200000);
  //1. grab the document from FL
  let jobKey = await testFlDoc("100g Nutritional Information");
  let job = await oada.get({
    path: `${SERVICE_PATH}/jobs/success/day-index/${moment().format('YYYY-MM-DD')}/${jobKey}`
  }).catch(err => {
    console.log(err);
    return {status: 0}
  })

  t.is(job.status, 200);

});

async function testFlDoc(docType: keyof typeof flDocTypes) {
  let data = coi;
  data.name = `Automated Test ${docType}`;
  // Modify attachments to use the ones from s3Infos
  let key = Object.keys(flDocTypes[docType])[0];
  //@ts-ignore
  data.attachments = [flDocTypes[docType][key]];
  //@ts-ignore
  data.shareRecipients[0].type = doctypes[docType];

  let {jobKey} = await postAndPause(data, oada);
  await setTimeout(100000);

  return jobKey
}

async function fetchFlDocTypes() {
  let response = await axios({
    method: 'get',
    url: `${FL_DOMAIN}/businesses/${SF}/documenttypes`,
    headers: {
      "Authorization": `${FL_TOKEN}`,
    }
  }).then(r => r.data)
  //@ts-ignore
  let doctypes = Object.fromEntries(response.pageItems.map(i => [i.name, i]))
  return doctypes;
}

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

/*
async function getFlDoc(_id: string) {
  let resp = await oada.get({
    path: `/${_id}`
  }).then(r => r.data as JsonObject)
  if (!resp["food-logiq-mirror"]) throw new Error("food-logiq-mirror")
  return trellisMirrorToFlInput(resp["food-logiq-mirror"]) as unknown as Body;
}
*/

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

/*
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
*/

/*
interface TrellisFlMirror extends FlObject {
  attachments: {};
  community: {};
  shareSource: {
    community: {};
  };
}
*/

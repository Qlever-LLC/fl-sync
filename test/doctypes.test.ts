import { expect } from 'chai';
import Promise from 'bluebird';
import { setTimeout } from 'timers/promises';
import { connect, OADAClient } from '@oada/client';
import moment from 'moment';
import axios from 'axios';

import tree from '../src/tree';
import {test} from '../src/index';
const { coi } = require('./documents/coi');

import config from "../src/config";
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const SUPPLIER = config.get('foodlogiq.testSupplier.id')
const TOKEN = process.env.TOKEN || '';// || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
let SERVICE_PATH = config.get('service.path') || '';
let SERVICE_NAME = config.get('service.name') || '';
tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
const INTERVAL_MS = config.get('foodlogiq.interval')*1000;

const jobwaittime = 10000; // ms to wait for job to complete, tune to your oada response time

async function postDoc(data, oada) {
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
  await setTimeout(INTERVAL_MS+1000)
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

describe('End-to-end tests of various FL documents: docs.test.js', function() {
  this.timeout(jobwaittime*10);
  let oada: OADAClient

  before(async () => {
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

    test({
      polling: true,
      target: true,
      master: false,
      service: true,
      watchConfig: true 
    })
    await setTimeout(15000/2)
  });

  after(async () => {
  });

  it(`Should approve a valid COI document.`, async () => {
    let data = coi;
    data.attachments.pop();
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
      path: `${SERVICE_PATH}/jobs/success/${moment().format('YYYY-MM-DD')}/${jobKey}`
    })

    expect(job.status).to.equal(200); 
  });
});

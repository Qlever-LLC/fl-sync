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

/*
async function postDoc(data, oada) {
  let fldata = await axios({
    method: 'post',
    url: `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents`,
    data,
    headers: {
      "Authorization": `${FL_TOKEN}`,
    }
  }).then(r => r.data)
  let flid = fldata._id;

  let _id = await oada.post({
    path: '/resources',
    contentType: "application/json",
    data: {
      'food-logiq-mirror': fldata
    }
  }).then(r => r.headers['content-location'].replace(/^\//, ''))

  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flid}`,
    data: {
      _id,
      _rev: 0
    }
  })

  return flid;
}
*/

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

  /*
  it('Should fail and warn suppliers when multiple PDFs are attached.', async () => {
    let data = coi;
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

    let job = await oada.get({
      path: `${SERVICE_PATH}/jobs-failure/${moment().format('YYYY-MM-DD')}/${jobKey}`
    })

    expect(job.status).to.equal(200); 
  });
 */

/* Lost the document that originally exposed this failure mode
  it('The job should fail when attachments cannot be retrieved.', async () => {
    let data = coi;
    data.attachments.pop();
    //Make the attachments unretrievable
    // ????

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

    let job = await oada.get({
      path: `${SERVICE_PATH}/jobs-failure/${moment().format('YYYY-MM-DD')}/${jobKey}`
    })

    expect(job.status).to.equal(200); 
  });

  // Really this tests startup conditions where the initial poll may include lots of 
  // already manually-handled jobs
  it(`Shouldn't queue a job if it is of an unsupported document type.`, async () => {
    let flId = '60ee425678bfbb000e7448f0';
    let data = await oada.get({
      path: `/bookmarks/services/fl-sync/businesses/60d0f623a49a43000ec2e70d/documents/${flId}`
    }).then(r => r!.data!['food-logiq-mirror'])

    // Mock the mirroring of the doc
    data.shareSource.sourceBusiness._id = SUPPLIER;
    await oada.put({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/food-logiq-mirror`,
      data
    })
    await setTimeout(15000)

    let result = await oada.get({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`
    }).then(r => r.data)

    //@ts-ignore
    expect(result?.services?.['fl-sync']?.jobs).to.equal(undefined); 
  });


  // Really this tests startup conditions where the initial poll may include lots of 
  // already manually-handled jobs
  it(`Shouldn't queue a job if already approved or rejected by non-trellis user.`, async () => {
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
    }).then(r => r.data)

    //@ts-ignore
    expect(result?.services?.['fl-sync']?.jobs).to.equal(undefined); 
  });
 */

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

  /*
  it(`Should reject a COI with insufficient policy coverage.`, async () => {
    let data = coi;
    data.attachments.unshift();
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

    //@ts-ignore
    expect(result?.services?.['fl-sync']?.jobs).to.equal(undefined); 
  });
 */
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
});

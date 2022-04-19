import { expect } from 'chai';
import { setTimeout } from 'timers/promises';
import { connect, OADAClient } from '@oada/client';
//import debug from 'debug';
import {test} from '../src/index';

import config from "../src/config";
const SUPPLIER = config.get('foodlogiq.testSupplier.id')
const TOKEN = process.env.TOKEN || '';// || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
let SERVICE_PATH = config.get('service.path') || '';

describe('Overall functional tests: masterData.test.js', function() {
  this.timeout(30_000);
  let oada: OADAClient

  before(async () => {
    oada = await connect({domain: DOMAIN, token: TOKEN});
    test({
      polling: false,
      target: false,
      service: false,
      watchConfig: false,
      master: true,
    })
    await setTimeout(5000)
  });

  after(async () => {
    
  });

  it('Should produce a new trading partner and masterid for a new FL business.', async () => {
    let businesses = await oada.get({
      path: `${SERVICE_PATH}/businesses`,
    }).then(r => r.data)

    if (!businesses) throw new Error('Missing businesses endpoint in Food Logiq mirror: ${SUPPLIER}')
    if (!businesses[SUPPLIER]) throw new Error('Missing test supplier in Food Logiq mirror: ${SUPPLIER}')
     
    let _id = businesses[SUPPLIER]._id;

    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/masterid`,
    })
    
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
    })

    await oada.put({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
      data: {
        _id,
        _rev: 0
      }
    })

    await setTimeout(5000)

    let bus = await oada.get({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
    }).then(r => r.data)

    expect(bus).to.have.own.property('masterid')

  });

  /*
  it('Should produce a new trading partner and masterid for a new FL business.', async () => {
    let businesses = await oada.get({
      path: `${SERVICE_PATH}/businesses`,
    }).then(r => r.data)

    if (!businesses) throw new Error('Missing businesses endpoint in Food Logiq mirror: ${SUPPLIER}')
    if (!businesses[SUPPLIER]) throw new Error('Missing test supplier in Food Logiq mirror: ${SUPPLIER}')
     
    let _id = businesses[SUPPLIER]._id;

    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/masterid`,
    })
    
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
    })

    await oada.put({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
      data: {
        _id,
        _rev: 0
      }
    })

    await setTimeout(5000)

    let bus = await oada.get({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
    }).then(r => r.data)

    expect(bus).to.have.keys(['masterid'])

  });
 */

/* TODO: THIS IS UNTESTED
  it(`Should not infinite loop with 'ListWatch did not return a complete object. Retrying...' if a business resource is created without a 'food-logiq-mirror'.`, async () => {
     //1. Create a new business under /bookmarks/services/fl-sync/businesses
     //without the 'food-logiq-mirror' populated
  });
 */
});

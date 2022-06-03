/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import _ from 'lodash';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import oada from '@oada/client';
import Promise from 'bluebird';
import moment from 'moment';
import debug from 'debug';
import axios from 'axios';
import SHA256 from 'js-sha256';

// Configuration details
import config from '../config.default.js';
import business_tree from './business_tree.js';
import business_template from './business_template.js';
const { sha256 } = SHA256;

const trace = debug('fl-sync:trace');
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');

let con = false;
const day = moment().format('YYYY-MM-DD');
chai.use(chaiAsPromised);
const { expect } = chai;

const { FL_TOKEN, FL_DOMAIN, DOMAIN, TRELLIS_TOKEN, TEST_DOC_ID } = config;
const SF_FL_CID = config.sf_buyer.community_id;
const SF_FL_BID = config.sf_buyer.business_id;
const DOC_ID = TEST_DOC_ID;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const BID = 'bs-0017';
const BS_DEMO = `/bookmarks/services/fl-sync/businesses/${BID}`;
const BS_DEMO_MASTERID = `/bookmarks/services/fl-sync/businesses/${BID}-masterid`;
const TL_TP_DEMO = `/bookmarks/trellisfw/trading-partners/unidentified-trading-partners-index/${BID}`;
const TL_TP_DEMO_MASTERID = `/bookmarks/trellisfw/trading-partners/${BID}-masterid`;
const business_hash =
  '78c3b3991fe6085a6db8dacbe94957194a072f0afa386be7f2baf4bfe500729c';

const PATHS = [BS_DEMO, BS_DEMO_MASTERID, TL_TP_DEMO, TL_TP_DEMO_MASTERID];

const trellisTPTemplate = {
  sapid: '',
  masterid: '',
  name: '',
  address: '',
  city: '',
  state: '',
  type: 'CUSTOMER',
  coi_emails: '',
  fsqa_emails: '',
  email: '',
  phone: '',
};

const trellisfw_tp_tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.trellis.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.trellisfw.trading-partners.1+json',
        '_rev': 0,
        '*': {
          _type: 'application/vnd.trellisfw.trading-partner.1+json',
          _rev: 0,
        },
        'unidentified-trading-partners': {
          '_type': 'application/vnd.trellisfw.trading-partners.1+json',
          '_rev': 0,
          '*': {
            _type: 'application/vnd.trellisfw.trading-partner.1+json',
            _rev: 0,
          },
        },
      },
    },
  },
};

const FL_MIRROR = 'food-logiq-mirror';

/**
 * Cleans up the demo business data
 * @param OADA
 */
async function cleanUp(OADA) {
  try {
    Promise.map(PATHS, async (path) => {
      await OADA.delete({ path });
    });
  } catch (error) {
    console.log(
      '--> error when deleting a business or trading partner:',
      error
    );
  }
} // CleanUp

/**
 * populates test business in FL branch
 * @param OADA
 */
async function putData(OADA) {
  const _data = _.cloneDeep(business_template);
  const _path = BS_DEMO;
  _data.masterid = '';
  _data.sapid = '';

  await OADA.put({
    path: _path,
    tree: business_tree,
    data: _data,
  })
    .then((result) => {
      console.log('--> business created', _path);
    })
    .catch((error) => {
      console.log('--> error when creating a business', error);
    });

  _data.masterid = business_hash;
  _data.sapid = business_hash;
  await OADA.put({
    path: BS_DEMO_MASTERID,
    tree: business_tree,
    data: _data,
  })
    .then((result) => {
      console.log('--> business created', BS_DEMO_MASTERID);
    })
    .catch((error) => {
      console.log('--> error when creating a business', error);
    });
} // PutData

/**
 * Retrieves all businesses from the fl-sync
 * then, it mirrors all businesses as trading-partners under
 * trellisfw
 * @param OADA connection
 */
async function flBusinessesMirror(OADA) {
  const _path = '/bookmarks/services/fl-sync/businesses';
  const _path_tp = '/bookmarks/trellisfw/trading-partners/';
  const _result = await OADA.get({ path: _path });

  for (const [k, v] of Object.entries(_result.data)) {
    if (k.slice(0, 1) !== '_' && k === 'bs-0002') {
      const _dataString = JSON.stringify(_result.data);
      console.log(_dataString);
      console.log('--> key', k);
      console.log('--> value', v);
      const _business_path = `${_path}/${k}`;
      const _business = await OADA.get({ path: _business_path });
      const hash = sha256(JSON.stringify(_business.data[FL_MIRROR]));
      console.log('--> key hash', hash);
      const _path_tp_id = _path_tp + k;
      console.log(JSON.stringify(_business.data[FL_MIRROR]));
      console.log(_business.data[FL_MIRROR].business);
      const data = _.cloneDeep(trellisTPTemplate);
      data.sapid = hash;
      data.masterid = hash;
      data.name = _business.data[FL_MIRROR].business.name;
      data.address = _business.data[FL_MIRROR].business.address.addressLineOne;
      data.city = _business.data[FL_MIRROR].business.address.city;
      data.email = _business.data[FL_MIRROR].business.email;
      data.phone = _business.data[FL_MIRROR].business.phone;
      console.log('--> data', data);
      const _tp = await OADA.put({
        path: _path_tp_id,
        tree: trellisfw_tp_tree,
        data,
      })
        .then((result) => {
          console.log('--> business mirrored. ');
        })
        .catch((error) => {
          console.log('--> error when mirroring', error);
        });
    } // If
  } // For
} // FlBusinessesMirror

describe('testing mirror - creating a business.', () => {
  before(async function () {
    this.timeout(60_000);
    con = await oada.connect({ domain: DOMAIN, token: TRELLIS_TOKEN });
    // Await cleanUp(con);
    await putData(con);
    // Await flBusinessesMirror(con);
    await Promise.delay(2000);
  });

  it('should exist a business in fl-sync/businesses ', async () => {
    const path = BS_DEMO;
    const _result = await con.get({ path }).catch((error) => {
      console.log(error);
    });
    expect(_result.status).to.equal(200);
  });

  it('should exist a business in trellisfw/trading-partners/unidentified ', async () => {
    const path = TL_TP_DEMO;
    const _result = await con.get({ path }).catch((error) => {
      console.log(error);
    });
    expect(_result.status).to.equal(200);
  });

  it('should exist a business in trellisfw/trading-partners ', async () => {
    const path = TL_TP_DEMO_MASTERID;
    const _result = await con.get({ path }).catch((error) => {
      console.log(error);
    });
    expect(_result.status).to.equal(200);
  });

  it('sapid and masterid should match to sha256(content of food-logiq-mirror) ', async () => {
    const _path = TL_TP_DEMO_MASTERID;
    const _result_tp = await con.get({ path: _path }).catch((error) => {}); // Console.log(error) });
    expect(business_hash).to.equal(_result_tp.data.sapid);
    expect(business_hash).to.equal(_result_tp.data.masterid);
  });
});

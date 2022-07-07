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

import config from './config.masterdata.js';

import { setTimeout } from 'node:timers/promises';

import type { JsonObject, OADAClient } from '@oada/client';
import { ListWatch } from '@oada/list-lib';
import SHA256 from 'js-sha256';
import type { TreeKey } from '@oada/list-lib/dist/tree.js';
import _ from 'lodash';
import debug from 'debug';

import tree from './tree.masterData.js';

const { sha256 } = SHA256;

const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
// TL_TP: string = config.get('trellis.endpoints.service-tp');
const TL_TP = `/bookmarks/trellisfw/trading-partners`;
const TL_TP_MI = `${TL_TP}/masterid-index`;
const TL_TP_EI = `${TL_TP}/expand-index`;
const FL_MIRROR = `food-logiq-mirror`;

let CONNECTION: OADAClient;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

const info = debug('fl-sync:master-data:info');
const error = debug('fl-sync:master-data:error');
const trace = debug('fl-sync:master-data:trace');

enum SOURCE_TYPE {
  Vendor = 'vendor',
  Business = 'business',
}

/**
 * Watches for changes in the fl-sync/businesses
 */
export async function watchTrellisFLBusinesses(conn: OADAClient) {
  info(`Setting masterData ListWatch on FL Businesses`);
  setConnection(conn);
  // eslint-disable-next-line no-new
  new ListWatch({
    path: `${SERVICE_PATH}/businesses`,
    name: `fl-sync-master-data-businesses`,
    conn,
    tree,
    resume: true,
    onAddItem: addTP2Trellis,
  });
} // WatchTrellisFLBusinesses

/**
 * adds a trading-partner to the trellisfw when
 * a new business is found under services/fl-sync/businesses
 * @param {*} item
 * @param {*} key
 */
export async function addTP2Trellis(item: any, key: string, conn?: OADAClient) {
  info(
    `New FL business detected [${item._id}]. Mapping to trellis trading partner.`
  );
  if (!CONNECTION) {
    setConnection(conn!);
  }

  const _key: string = key.slice(1);
  try {
    if (typeof TradingPartners[key] === 'undefined') {
      // Adds the business as trading partner
      let data = _.cloneDeep(trellisTPTemplate);
      let expandData: ExpandIndexRecord = _.cloneDeep(expandIndexTemplate);
      // FIXME: need to include a flag when search engine is present

      trace(`Business item: ${item}`);
      const _path = item._id;
      if (typeof item[FL_MIRROR] === 'undefined') {
        info(`Getting ${_path} with delay.`);
        // FIXME: find a more robust way to retrieve business content
        let fl_mirror_content: unknown = item[FL_MIRROR];
        let tries = 0;
        // Retry until it gets a body with FL_MIRROR
        while (typeof fl_mirror_content === 'undefined') {
          // eslint-disable-next-line no-await-in-loop
          await setTimeout(500);
          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await CONNECTION.get({
              path: _path,
            });
            fl_mirror_content = (result.data as JsonObject)[FL_MIRROR];
            if (typeof fl_mirror_content === 'undefined') {
              info(
                `ListWatch did not return a complete object for business ${key}. Retrying ...`
              );
              if (tries > 10) {
                info(
                  `Giving up. No 'food-logiq-mirror' for business at ${item._id}.`
                );
                /*              Await fetchAndSync({
                  from:`${FL_DOMAIN/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/contacts/${}`,
                  to: ``,
                })*/
                fl_mirror_content = false;
                return;
              }

              tries++;
            } else {
              info(`Got a complete object.`);
              info(`assigning data after get.`);
              data = assignData(data, result.data);
              data.id = _path;
              expandData = assignDataExpandIndex(data, result.data);
            } // If
          } catch (error_: unknown) {
            error({ error: error_ }, '--> error when retrieving business ');
          }
        } // While FIXME: Verify consistency of this
      } else {
        // If
        data = assignData(data, item);
        data.id = _path;
        expandData = assignDataExpandIndex(data, item);
      } // If

      // mirroring the business into trading partners
      // 1. make the resource
      info('--> mirroring the business into trading partners.');
      trace('DATA', data);
      const resId = await CONNECTION.post({
        path: `/resources`,
        data,
        contentType: 'application/vnd.oada.service.1+json',
      }).then((r: any) => {
        if (r && r.headers && r.headers['content-location']) {
          return r.headers['content-location'].replace(/^\//, '');
        }
      });
      const _datum = { _id: resId, _rev: 0 };
      try {
        await CONNECTION.put({
          path: `${TL_TP}`,
          data: {
            [key.replace(/^\//, '')]: _datum,
          },
          tree,
        });
        info('----> business mirrored. ', `${TL_TP}${key}`);
        // Creating bookmarks endpoint under tp
        const { headers } = await CONNECTION.put({
          path: `${TL_TP}${key}/bookmarks`,
          data: {},
          tree,
        });
        const _bookmarks_id: string = headers?.['content-location'] ?? '';
        const _string_content = _bookmarks_id.slice(1);
        if (_bookmarks_id !== '') {
          const _bookmarks_data: Bookmarks = {
            bookmarks: {
              _id: _string_content,
            },
          };
          expandData.user = _bookmarks_data;
        } // If
      } catch (error_: unknown) {
        error({ error: error_ }, '--> error when mirroring ');
      }

      // Updating the expand index
      info('--> updating the expand-idex ', expandData.masterid);
      const expandIndexRecord: IExpandIndex = {};
      expandIndexRecord[_key] = expandData;
      await updateExpandIndex(expandData, _key);

      // Updating the fl-sync/businesses/<bid> index
      info('--> updating masterid-index, masterid ', expandData.masterid);
      await updateMasterId(_path, expandData.masterid, resId);

      TradingPartners[key] = data;
    } else {
      info('--> TP exists. The FL business was not mirrored.');
    } // If

    // return TradingPartners[key].masterid;
  } catch (error_: unknown) {
    error('--> error ', error_);
    throw error_ as Error;
  }
} // AddTP2Trellis

/**
 * assigns item data (new business) into the trading partner template
 * @param {*} data: TradingPartner
 * @param {*} item
 * @returns
 */
function assignData(data: TradingPartner, item: any) {
  // FIXME: NEED type for item
  try {
    let _id = sha256(JSON.stringify(item[FL_MIRROR]));
    if (
      typeof item[FL_MIRROR].internalid !== 'undefined' ||
      item[FL_MIRROR].internalid !== ''
    ) {
      _id = item[FL_MIRROR].internalid;
    } // If

    data.name = item[FL_MIRROR].business.name
      ? item[FL_MIRROR].business.name
      : '';
    data.address = item[FL_MIRROR].business.address.addressLineOne
      ? item[FL_MIRROR].business.address.addressLineOne
      : '';
    data.city = item[FL_MIRROR].business.address.city
      ? item[FL_MIRROR].business.address.city
      : '';
    data.email = item[FL_MIRROR].business.email
      ? item[FL_MIRROR].business.email
      : '';
    data.phone = item[FL_MIRROR].business.phone
      ? item[FL_MIRROR].business.phone
      : '';
    data.foodlogiq = item[FL_MIRROR] ? item[FL_MIRROR] : '';
    data.masterid = _id;
    data.internalid = _id;
  } catch (error_: unknown) {
    error({ error: error_ }, 'Error when assigning data.');
    error('This is the content of the item FL MIRROR = %o', item[FL_MIRROR]);
  }

  return data;
} // AssignData

/**
 * builds expand index entry
 * @param data TradingPartner
 * @returns
 */
function assignDataExpandIndex(data: TradingPartner, item: any) {
  // FIXME: NEED type for item
  const _expandIndexData: ExpandIndexRecord = _.cloneDeep(expandIndexTemplate);
  let _id = sha256(JSON.stringify(item[FL_MIRROR]));
  if (
    typeof item[FL_MIRROR].internalid !== 'undefined' &&
    item[FL_MIRROR].internalid !== ''
  ) {
    _id = item[FL_MIRROR].internalid;
  } // If

  _expandIndexData.name = data.name ?? '';
  _expandIndexData.address = data.address ?? '';
  _expandIndexData.city = data.city ?? '';
  _expandIndexData.state = '';
  _expandIndexData.email = data.email ?? '';
  _expandIndexData.phone = data.phone ?? '';
  _expandIndexData.id = data.id ?? '';
  _expandIndexData.internalid = _id;
  _expandIndexData.masterid = _id;
  _expandIndexData.sapid = _id;
  _expandIndexData.type = 'CUSTOMER';

  return _expandIndexData;
} // AssignDataExpandIndex

/**
 * updates the expand index with the information extracted
 * from the received FL business
 * @param expandIndexRecord expand index content
 */
async function updateExpandIndex(expandIndexRecord: JsonObject, key: string) {
  try {
    // Expand index
    await CONNECTION.put({
      path: `${TL_TP_EI}`,
      data: {
        [key]: expandIndexRecord,
      },
      tree,
    });
    info('--> expand index updated. ');
  } catch (error_: unknown) {
    error({ error: error_ }, '--> error when mirroring expand index.');
  }
} // UpdateExpandIndex

/**
 * Updates the masterid property in the
 * fl-sync/business/<bid> endpoint
 * @param masterid string that contains internalid from FL or
 * random string created by sap-sync
 */
async function updateMasterId(
  path: string,
  masterid: string,
  resourceId: string
) {
  const masterid_path = `${TL_TP_MI}/${masterid}`;
  info('--> masterid-index path ', masterid_path);
  info('--> masterid path ', path);

  // Creating masterid-index
  const mi_datum = { _id: resourceId };
  try {
    await CONNECTION.put({
      path: TL_TP_MI,
      // Path: masterid_path,
      data: {
        [masterid]: mi_datum,
      },
      tree,
    });
    info('--> trading-partners/masterid-index updated.');
  } catch (error_: unknown) {
    error(
      { error: error_ },
      '--> error when updating masterid-index element. '
    );
  }

  // Updating masterid under fl-sync/business/<bid>
  try {
    await CONNECTION.put({
      path,
      data: { masterid },
    });
    info(`${SERVICE_PATH}/businesses/<bid> updated with masterid.`);
  } catch (error_: unknown) {
    error(
      { error: error_ },
      '--> error when updating masterid element in fl-sync. '
    );
  }
} // UpdateMasterId

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

type TradingPartner = {
  id: string;
  sapid: string;
  masterid: string;
  internalid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  type: string;
  source: SOURCE_TYPE;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq?: string;
};
type ITradingPartner = Record<string, TradingPartner>;
const TradingPartners: ITradingPartner = {};

type IExpandIndex = Record<string, ExpandIndexRecord>;

type ExpandIndexRecord = {
  id: string;
  internalid: string;
  masterid: string;
  sapid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  address: string;
  city: string;
  coi_emails: string;
  email: string;
  fsqa_emails: string;
  name: string;
  phone: string;
  state: string;
  type: string;
  source: SOURCE_TYPE;
  user: Bookmarks;
};

const expandIndexTemplate: ExpandIndexRecord = {
  address: '',
  city: '',
  coi_emails: '',
  email: '',
  fsqa_emails: '',
  id: '',
  internalid: '',
  masterid: '',
  name: '',
  phone: '',
  sapid: '',
  companycode: '',
  vendorid: '',
  partnerid: '',
  state: '',
  type: 'CUSTOMER',
  source: SOURCE_TYPE.Business,
  user: {
    bookmarks: {
      _id: '',
    },
  },
};

type Bookmarks = {
  bookmarks: {
    _id: string;
  };
};

const trellisTPTemplate: TradingPartner = {
  id: '', // Both (vendor and business)
  sapid: '', // Business
  masterid: '', // Business
  internalid: '', // Business
  companycode: '',
  vendorid: '',
  partnerid: '',
  name: '', // Both
  address: '', // Both
  city: '', // Both
  state: '', // Both
  type: 'CUSTOMER', // Both
  source: SOURCE_TYPE.Business,
  coi_emails: '', // Business
  fsqa_emails: '', // Business
  email: '', // Both
  phone: '', // Both,
};

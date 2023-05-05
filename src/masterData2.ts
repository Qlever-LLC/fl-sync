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

import _ from 'lodash';
import debug from 'debug';

import { doJob } from '@oada/client';
import type { JsonObject, OADAClient } from '@oada/client';
import { AssumeState, ChangeType, ListWatch } from '@oada/list-lib';
import type { Job, WorkerFunction } from '@oada/jobs';
import type Resource from '@oada/types/oada/resource.js';

import tree from './tree.masterData.js';
//import type TradingPartner from '@oada/types/trellis/trading-partners/trading-partner.js';
import type { FlBusiness } from './mirrorWatch.js';

const SERVICE_NAME = config.get('service.name');
const SERVICE_PATH = config.get('service.path');
// TL_TP: string = config.get('trellis.endpoints.service-tp');
const TL_TP = `/bookmarks/trellisfw/trading-partners`;
const TL_TP_MI = `${TL_TP}/masterid-index`;
const TL_TP_EI = `${TL_TP}/expand-index`;
const FL_MIRROR = `food-logiq-mirror`;

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

const info = debug('fl-sync:master-data:info');
const error = debug('fl-sync:master-data:error');
const trace = debug('fl-sync:master-data:trace');

enum SourceType {
  Vendor = 'vendor',
  Business = 'business',
}

export interface NewBusinessJob {
  config: {
    'fl-business': FlBusiness;
  };
}

export interface TradingPartner {
  masterid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq?: string;
  bookmarks: {
    _id: string;
  };
  shared: {
    _id: string;
  };
  externalIds: string[];
  frozen: boolean;
}

export interface TradingPartnerNoLinks {
  masterid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq?: string;
  externalIds: string[];
  frozen: boolean;
}

//@ts-ignore
export const handleNewBusiness: WorkerFunction = async (job, { oada }) => {
  //1. Make the query to the trellis trading partners
  // @ts-ignore
  const element = mapTradingPartner(job.config['fl-business']);

  let ensureJob;
  try {
    ensureJob = await doJob(oada, {
      type: 'trading-partners-ensure',
      service: 'trellis-data-manager',
      config: { element },
    });

    //Ensure needs to handle 'entry', 'new' and 'matches'

    /* This is getting eliminated. We don't want to cache anything outside of 
    the trellis-data-manager! Look it up when you need it!
    await updateMasterId(
      // @ts-ignore
      job.config['fl-business'],
      (ensureJob?.result as TradingPartner).masterid,
      oada
    );
    */
  } catch (error_: unknown) {
    error(error_);
    throw error_;
  }

  return ensureJob.result;
};

/**
 * assigns fl business data into the trading partner template
 * @param {*} item fl business
 * @returns
 */
export function mapTradingPartner(bus: FlBusiness): TradingPartnerNoLinks {
  return {
    ..._.cloneDeep(trellisTPTemplate),
    name: bus.business.name || '',
    address: bus.business.address.addressLineOne || '',
    city: bus.business.address.city || '',
    state: bus.business.address.region || '',
    email: bus.business.email || '',
    phone: bus.business.phone || '',
    externalIds: [`foodlogiq:${bus.business._id}`]
  };
}

/**
 * Updates the masterid property in the
 * fl-sync/business/<bid> endpoint
 * @param masterid string that contains internalid from FL or
 * random string created by sap-sync
 */
async function updateMasterId(flBusiness: any, masterid: string, oada: OADAClient) {
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${flBusiness._id}`,
    data: ({ masterid }) as JsonObject,
  });
  info(`${SERVICE_PATH}/businesses/<bid> updated with masterid [${masterid}].`);

  await oada.put({
    path: `/${masterid}/_meta`,
    data: ({
      services: {
        'fl-sync': {
          businesses: {
            [flBusiness._id]: { _id: masterid}
          }
        }
      }
    }) as JsonObject
  });
  info(`${TL_TP}/ updated with masterid [${masterid}].`);
} // UpdateMasterId

const trellisTPTemplate: TradingPartnerNoLinks = {
  masterid: '', // internal trellis resource id 
  companycode: '',
  vendorid: '',
  partnerid: '',
  name: '', // Both
  address: '', // Both
  city: '', // Both
  state: '', // Both
  //type: 'CUSTOMER', // Both
  //source: SourceType.Business,
  coi_emails: '', // Business
  fsqa_emails: '', // Business
  email: '', // Both
  phone: '', // Both,
  externalIds: [],
  frozen: false,
};

/**
 * Watches for changes in the fl-sync/businesses
 */
/*
export async function watchTrellisFLBusinesses(conn: OADAClient, service: Service) {
  info(`Setting masterData ListWatch on FL Businesses`);
  setConnection(conn);
  // eslint-disable-next-line no-new
  const watch = new ListWatch({
    path: `${SERVICE_PATH}/businesses`,
    name: `fl-sync-master-data-businesses`,
    conn,
    tree,
    resume: true,
    onNewList: AssumeState.Handled,
  });
  watch.on(ChangeType.ItemAdded, async ({ item, pointer }) => {
    await addTP2Trellis((await item) as Resource, pointer, conn, service);
  });

  // FIXME: Handle changes to the trading partners
  watch.on(ChangeType.ItemChanged, async ({ item, pointer }) => {
    await addTP2Trellis((await item) as Resource, pointer, conn);
  });
} // WatchTrellisFLBusinesses
*/
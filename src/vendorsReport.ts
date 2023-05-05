/**
 * @license
 *  Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import config from './config.js';

import fs from 'node:fs';

import type { OADAClient } from '@oada/client';
import { JsonPointer } from 'json-ptr';
import { connect, doJob } from '@oada/client';
import _ from 'lodash';
import { default as axios } from 'axios';
// @ts-expect-error
import csvjson from 'csvjson';
import debug from 'debug';
import Fuse from 'fuse.js';
import ksuid from 'ksuid';
import moment from 'moment';
import type { JsonObject } from '@oada/client';
import type { FlBusiness } from './mirrorWatch.js';
import { mapTradingPartner } from './masterData2.js';
import type { TradingPartner } from './masterData2.js';
import tree from './tree.masterData.js';

const { domain, token } = config.get('trellis');
const SERVICE_PATH = config.get('service.path');
const SUPPLIER = config.get('foodlogiq.testSupplier.id');
const FL_TRELLIS_USER = config.get('foodlogiq.trellisUser');
const CO_ID = config.get('foodlogiq.community.owner.id');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const info = debug('fl-sync:vendorsReport:info');
const error = debug('fl-sync:vendorsReport:error');

const INSTRUCTION_HEADER = `Place one X per set of rows with the same FL Name to select a match. Leave blank to select no matches`;

export async function makeReport() {
  const oada = await connect({
    domain,
    token,
  });
  try {
    const businesses = await oada.get({
      path: `/bookmarks/services/fl-sync/businesses`,
    }).then(r => r.data as JsonObject);

    const businessKeys = Object.keys(businesses).filter(
      (key) => !key.startsWith('_')
    );


    const results: any[] = [];

    for await (const bid of businessKeys) {
      const { data } = await oada.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}`,
      });

      const bus = (data as JsonObject)['food-logiq-mirror'] as unknown as FlBusiness;
      const element = mapTradingPartner(bus);

      const job = await doJob(oada, {
        type: 'trading-partners-query',
        service: 'trellis-data-manager',
        config: { element },
      });

      for (const match of Object.values(job?.result?.matches || {})) {
        results.push({
          'FoodLogiq Business Name': bus.business.name,
          'FoodLogiq Business Address': `${bus.business.address.addressLineOne}; ${bus.business.address.city}; ${bus.business.address.region}`,
          'FoodLogiq Business ID': `${bus._id}`,
          'SAP Business Name': match.name,
          'SAP Business Address': `${match.address}; ${match.city}; ${match.state}`,
          'SAP Business EIN': match.ein,
        });
      }
    }
  } catch (error_: unknown) {
    console.log(error_);
  }
}

export async function makeVendors() {
  const oada = await connect({
    domain,
    token,
  });
  const { data } = await oada.get({
    path: `/bookmarks/services/master-data-sync/data-sources/vendors/day-index/2023-04-21`,
  });

  const values = Object.entries(data ?? {})
    .filter(([key, _]) => !key.startsWith('_'))
    .map(([_, value]) => value);

  for await (const value of values) {
    const element = mapVendor(value);

    try {
      await doJob(oada, {
        type: 'trading-partners-generate',
        service: 'trellis-data-manager',
        config: { element },
      });
    } catch(error_:unknown) {
      console.log(error_);
    }
  }
}

function mapVendor(vendor: any) {
  return {
    sapid: vendor.Vendor,
    externalIds: [vendor.Vendor],
    name: vendor.VendorName,
    vendorid: vendor.Vendor,
    address: vendor.StreetAddress,
    city: vendor.City,
    state: vendor.Region,
    phone: vendor.Telephone1 || vendor.Telephone2,
    zip: vendor.PostalCode,
    ein1: vendor.TaxNumber2,
    ein2: vendor.TaxNumber2,
  };
}

async function loadVendors() {
  const oada = await connect({
    domain,
    token,
  });
  const { data } = await oada.get({
    path: `/bookmarks/services/master-data-sync/data-sources/vendors/day-index/2023-04-21`,
  });

  const values = Object.entries(data ?? {})
    .filter(([key, _]) => !key.startsWith('_'))
    .filter(([_, val]) => !val.VendorName.startsWith('BLK'))
    .filter(([_, val]) => val['CentralDeletionFlag'].trim() !== 'X')
    .map(([_, value]) => mapVendor(value));

  const searchKeys = [
    {
      name: 'name',
      weight: 5,
    },
    {
      name: 'address',
      weight: 2,
    },
    {
      name: 'city',
      weight: 0.5,
    },
    {
      name: 'state',
      weight: 0.5,
    },
    'phone',
    'email',
    'sapid',
    'masterid',
    'externalIds',
  ];
  const searchKeysList = searchKeys.map((i) => typeof(i) === 'string' ? i : i.name);
  const options = {
    includeScore: true,
    keys: searchKeys,
    //ignoreLocation: true,
    //minMatchCharLength: 3,
    useExtendedSearch: true,
  };
  //@ts-ignore
  const index = new Fuse([], options);

  const collection = Object.values(values || {}).filter(
    (value) => value !== undefined
  );

  index.setCollection(collection);

  const conn = await connect({
    domain: 'localhost:3010',
    token: '77961fb1fc3c4d1d81bc59cd8a5eb822',
  });

  const businesses = await conn.get({
    path: `/bookmarks/services/fl-sync/businesses`,
  }).then(r => r.data as JsonObject);

  const businessKeys = Object.keys(businesses).filter(
    (key) => !key.startsWith('_')
  );

  const results = [];

  for await (const bid of businessKeys) {
    const { data } = await conn.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    });

    const bus = (data as JsonObject)['food-logiq-mirror'] as unknown as FlBusiness;
    const foodlogiq = Object.fromEntries(
      Object.entries(mapTradingPartner(bus))
        .filter(([k, _]) => searchKeysList.includes(k))
        .filter(([_, v]) => v !== '' && v !== undefined)
    );

    //@ts-ignore
    foodlogiq.name = foodlogiq.name.replace(/\(.+?\)/, '');
    let matches = getMatches(foodlogiq, index);
    //let matches = index.search({name: foodlogiq.name})
    //if (matches.length > 5) matches = matches.slice(0, 4);

    if (matches.length === 0)
      results.push({
        [INSTRUCTION_HEADER]: '',
         //@ts-ignore
        'FL Name': foodlogiq.name.replace(',', ''),
         //@ts-ignore
        'FL Address': `${foodlogiq.address || ' '} - ${foodlogiq.city || ' '} - ${foodlogiq.state || ' '}`.replace(',', ''),
        'Match Score': ' ',
        'SAP Name': ' ',
        'SAP Address': ' ',
        'FL ID': bus.business._id,
      });

    //@ts-ignore
    for (const m of matches) {
      results.push({
        [INSTRUCTION_HEADER]: '',
         //@ts-ignore
        'FL Name': foodlogiq.name.replace(',', ''),
         //@ts-ignore
        'FL Address': `${foodlogiq.address || ' '} - ${foodlogiq.city || ' '} - ${foodlogiq.state || ' '}`.replace(',', ''),
        'Match Score': m.score,
        'SAP Name': m.item.name.replace(',', ''),
        'SAP Address': `${m.item.address || ' '} - ${m.item.city || ' '} - ${m.item.state || ' '}`.replace(',',''),
        'SAP ID': m.item.sapid,
        'FL ID': bus.business._id,
      });
    }
  }
  const csvData = csvjson.toCSV(results, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });

  fs.writeFileSync('vendorsReport.csv', csvData, {encoding: 'utf8'});
}

// Basically, try a bunch of different permutations of the given attributes and
// look for the lowest possible scores across all of those
function getMatches(foodlogiq: any, index: any) {
// 1. Gather a bunch of results
  let allMatches = [];
  allMatches.push(...index.search({ name: foodlogiq.name }));
  allMatches.push(...index.search(foodlogiq));

  const keys = ['name', 'address', 'city', 'state'];
  allMatches.push(...index.search(
    Object.fromEntries(keys.filter(k => foodlogiq[k]).map(k => ([k, foodlogiq[k]])))
  ));

  // 3. sort
  allMatches = allMatches.sort(({score: sa}, {score: sb}) => sa - sb)
  // 2. Dedupe
  const seen: any = {};
  allMatches = allMatches.filter(({refIndex}) => {
    if (seen[refIndex]) return false;
    seen[refIndex] = true;
    return true;
  });

  // 4. reduce to top 4 options
  if (allMatches.length > 5) allMatches = allMatches.slice(0, 4);
  return allMatches;
}

function findNoMatchIds(rows: any) {
  let ids = [...new Set(rows.map((r: any) => r['FL ID']))];
  ids = ids.filter(id => !rows.some((r:any) => r['FL ID'] === id && r[INSTRUCTION_HEADER]))
  let found = rows.filter((r: any) => ids.includes(r['FL ID']))

  /*
  const csvData = csvjson.toCSV(found, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });

  fs.writeFileSync('vendorsReportNoMatches.csv', csvData, { encoding: 'utf8' })
  */
  return ids;
}

function findMultipleXs(rows: any) {
  let ids = [...new Set(rows.map((r: any) => r['FL ID']))];
  ids = ids.filter(id => (rows.filter((r:any) => r['FL ID'] === id && r[INSTRUCTION_HEADER])).length > 1)
  let found = rows.filter((r: any) => ids.includes(r['FL ID']))
  let multiple = rows.map((r: any) => ids.includes(r['FL ID']))

  /*
  const csvData = csvjson.toCSV(found, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });
  
  fs.writeFileSync('vendorsReportMultipleMatches.csv', csvData, { encoding: 'utf8' })
  */
  return multiple;
}

function reduceForPerfectMatches(rows: any) {
  let highScoreIds = [...new Set(rows.filter((r: any) => r['Match Score'] < 0.01).map((r:any) => r['FL ID']))];
  let found = rows.filter((r: any) => !(highScoreIds.includes(r['FL ID']) && r['Match Score'] >= 0.01));

  const csvData = csvjson.toCSV(found, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });
  
  fs.writeFileSync('vendorsReportReduced.csv', csvData, { encoding: 'utf8' });
  return found;
}

function validateReportResponses() {
  let rows = csvjson.toObject(fs.readFileSync('./Vendor Report - Updated 05.04.23.csv', {encoding: 'utf8'}), {
     delimiter: ',',
  });
  rows.map((r: any) => ({
    ...r,
    [INSTRUCTION_HEADER]: r[INSTRUCTION_HEADER].trim() === 'X' || r[INSTRUCTION_HEADER].trim() === 'x',
  }));

  // No Matches
  const noMatches = findNoMatchIds(rows);
  // Find any with multiple Xs
  const multipleMatches = findMultipleXs(rows);

  // TODO: Eliminate any sets with one having score less than 0.01
  //  const perfects = reduceForPerfectMatches(rows);

  const matches = rows
    .filter((r:any) => r[INSTRUCTION_HEADER])
    .filter((_:unknown, i: number) => !multipleMatches[i]);

  return { rows, noMatches, multipleMatches, matches };
}

async function fixVendors(oada: OADAClient, matches: any[]) {
  for await (const {'FL ID': fl, 'SAP ID': sap} of matches) {
    const flid = `foodlogiq:${fl}`;
    const sapid = `sap:${sap}`;
    // Well, we haven't created any trading partners yet...
    const fromTP = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: { element: { externalIds: [flid] } },
    });

    const toTP = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: { element: { externalIds: [sapid] } },
    });

    if (fromTP.length !== 1 || toTP.length !== 1) {
      console.log(`Multiple TP results found for food logiq: ${flid}, sap: ${sapid}`);
      continue;
    }

    const config = {
      from: fromTP.masterid,
      to: toTP.masterid,
      externalIds: [flid, sapid],
    };
    await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-merge',
      config,
    });
  }
}

async function processReportResponses() {
  const conn = await connect({
    domain: 'localhost:3010',
    token: '77961fb1fc3c4d1d81bc59cd8a5eb822',
  });
  const oada = await connect({
    domain,
    token,
  });
  const { matches } = validateReportResponses();

  console.log(matches);
  await fixVendors(oada, matches);
}

async function vendorPrep() {
   const prod = await connect({
    domain: 'localhost:3006',
    token: 'e5983f91726e41a4956918932e547048',
  });
  const oada = await connect({
    domain,
    token,
  });

  // Copy food logiq vendors over to dev for testing
  const { data: businesses } = (await prod.get({
    path: `/bookmarks/services/fl-sync/businesses`,
  })) as { data: JsonObject };

  const businessKeys = Object.keys(businesses).filter(
    (key) => !key.startsWith('_')
  );

  for await (const bid of businessKeys) {
    const { data } = (await prod.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    })) as { data: JsonObject };

    const bus = data['food-logiq-mirror'] as unknown as FlBusiness;
    const tpid = data.masterid as unknown as string;
    const flid = `foodlogiq:${bid}`;

    let fromTP = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: { element: { externalIds: [flid] } },
    });

    // @ts-expect-error 
    if (fromTP.matches.length === 1 && fromTP.matches[0].item.externalIds.includes(flid)) {
      continue;
    }

    if (!tpid) {
      //Cant really fix the current prod thing...
      /*
      // Create a trading partner and fill in the flid
      const element = mapTradingPartner(bus);
      await doJob(oada, {
        service: 'trellis-data-manager',
        type: 'trading-partners-generate',
        config: { element },
      });
      */
      //throw new Error(`No masterid for business ${bid}`);
    }

    const { data: tp } = (await prod.get({
      path: `/bookmarks/trellisfw/trading-partners/masterid-index/${tpid}`,
    })) as { data: JsonObject };
    const real_masterid = tp._id;

    await prod.put({
      path: `/bookmarks/trellisfw/trading-partners/masterid-index/${tpid}`,
      data: {
        masterid: real_masterid,
        externalIds: [flid],
      },
    });

    fromTP = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: { element: { externalIds: [flid] } },
    });

    console.log({fromTP})

  }
}

//await loadVendors();
//await makeVendors();
//await makeReport();
//validateReportResponses();
//processReportResponses();
await vendorPrep();

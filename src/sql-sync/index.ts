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

import config from '../config.js';

import type { JsonObject } from '@oada/client';
import { connect } from '@oada/client';
import fs from 'node:fs';
import sql from 'mssql';
import xlsx from 'xlsx';
process.env.NODE_TLS_REJECT_AUTHORIZED = '0';

const { domain, token } = config.get('trellis');
const { database, password, port, server, user } = config.get('lfdynamic');
const VENDOR_SHEET = 'LFA1';
const NAME_COL = 'Name 1';

let sqlConfig = {
  server,
  database,
  user,
  password,
  port,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

const production = false;
if (production) {
  sqlConfig = {
    server,
    database,
    user,
    port,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };
}
// Let sqlString = 'Server=localhost,3003;TrustServerCertificate=true;Database=LFDynamic;User Id=trellisdev;Encrypt=true'

function grabVendors() {
  const wb = xlsx.readFile('./SAPDATA.xlsx');
  const sheet = wb.Sheets[VENDOR_SHEET];
  // @ts-expect-error thing
  let rows: SAPVendor[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  // Eliminate Blocked vendors
  rows = rows.filter((r) => !r[NAME_COL].startsWith('BLK'));
  // Handle duplicates...
  // rows = Array.from(new Map(rows.map((m) => [m[NAME_COL], m])).values());
  return rows.map((r) => mapVendor(r));
}

function mapVendor(vendor: SAPVendor) {
  return {
    externalIds: [
      `sap:${vendor.Vendor}`,
      `ein:${vendor['Tax Number 1']}`,
      `ein:${vendor['Tax Number 2']}`,
    ].filter(Boolean),
    city: vendor.City,
    state: vendor.Region,
    country: vendor.Country,
    name: vendor['Name 1'],
    phone: vendor['Telephone 1'],
    address: vendor.Street,
  };
}

function fixCapitalization(text: string) {
  return text.toLowerCase()
    .split(' ')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

async function main() {
  try {
    console.log({ sqlConfig });
    await sql.connect(sqlConfig);

    // const qresult = await sql.query`select * from SYSOBJECTS WHERE xtype = 'U'`
    // const qresult = await sql.query`select * from LFDynamic.INFORMATION_SCHEMA.TABLES`
    let { recordset: qresult } = await sql.query`select * from SFI_Entities`;
    //const trellisList = await fetchTradingPartners();

    //await handleEntities(trellisList, qresult);
    //qresult = (await sql.query`select * from SFI_Entities`)
    //  .recordset as unknown as sqlEntry[];
    //console.log('after', qresult);
    //console.log('SQL LIST:', qresult.length, 'TRELLIS:', trellisList.length);
  } catch (error) {
    console.log(error);
  }

  process.exit();
}

/*
Async function addRemove(list: Array<sqlEntry>, name: string) {
  let exists = list.map(v => v["Entity Name"]).includes(name)
  let item = list.filter(v => v["Entity Name"] === name)
  let theItem = item[0];
  if (exists && theItem) {
    await removeEntity(theItem.rowguid);
  } else {
    await addEntity(name)
  }
  }

*/
async function removeEntity(rowguid: string) {
  return sql.query`DELETE FROM SFI_Entities WHERE rowguid=${rowguid}`;
}

async function addEntity(name: string) {
  console.log(`adding ${name}`);
  try {
    return await sql.query`INSERT INTO SFI_Entities ("Entity Name") VALUES (${name})`;
    // Await sql.query`INSERT INTO SFI_Entities ("Entity Name", "masterid") VALUES (${name}, ${masterid})`;
  } catch (error: unknown) {
    console.log('ERRORED ON THIS ONE', name);
    console.log(error);
    throw error;
  }
}

async function fetchTradingPartners() {
  const CONNECTION = await connect({
    domain,
    token,
  });

  const { data: tps } = await CONNECTION.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`,
  });
  return Object.values(tps as JsonObject) as unknown as trellisEntry[];
}

async function handleEntities(trellis: trellisEntry[], sqlList: sqlEntry[]) {
  const list = new Set(sqlList.map((index) => index.rowguid));
  await Promise.all(sqlList.map(async (index) => removeEntity(index.rowguid)));
  return Promise.all(
    trellis.map(async (item) => {
      // TODO: Probably change this test after we add trellisId or something to the sql table entries
      if (!list.has(item.masterid) && item.masterid !== undefined) {
        await addEntity(item.name);
      }
    })
  );
}

interface sqlEntry {
  'rowguid': string;
  'Entity Name': string;
}

interface trellisEntry {
  name: string;
  masterid: string;
}

interface SAPVendor {
  'Account group': string;
  'Central deletion flag': string;
  'City': string;
  'Country': string;
  'Name 1': string;
  'P.O. Box Postal Code': string;
  'PO Box': string;
  'Postal Code': string;
  'Region': string;
  'Street': string;
  'Tax Number 1': string;
  'Tax Number 2': string;
  'Telephone 1': string;
  'Telephone 2': string;
  'Vendor': string;
}

//await main();
//const rows = grabVendors();
//console.log(rows);

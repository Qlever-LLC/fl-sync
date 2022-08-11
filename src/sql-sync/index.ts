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

import { JsonObject, connect } from '@oada/client';
import sql from 'mssql';
process.env.NODE_TLS_REJECT_AUTHORIZED = '0';

const DOMAIN = config.get('trellis.domain');
const TOKEN = config.get('trellis.token');

let sqlConfig = {
  server: 'localhost',
  database: 'LFDynamic',
  user: 'trellisdev',
  port: 3002,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

const production = false;
if (production) {
  sqlConfig = {
    server: 'localhost',
    database: 'LFDynamic',
    user: "trellisprod",
    port: 3008,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };
}
// Let sqlString = 'Server=localhost,3003;TrustServerCertificate=true;Database=LFDynamic;User Id=trellisdev;Password=1S0wH9VhED^q;Encrypt=true'

async function main() {
  try {
    console.log({sqlConfig})
    await sql.connect(sqlConfig);

    /*
    // Const qresult = await sql.query`select * from SYSOBJECTS WHERE xtype = 'U'`
    // const qresult = await sql.query`select * from LFDynamic.INFORMATION_SCHEMA.TABLES`
    let qresult = (await sql.query`select * from SFI_Entities`)
      .recordset as unknown as sqlEntry[];
    const trellisList = await fetchTradingPartners();

    await handleEntities(trellisList, qresult);
    console.log('before', qresult);
    qresult = (await sql.query`select * from SFI_Entities`)
      .recordset as unknown as sqlEntry[];
    console.log('after', qresult);
    console.log('SQL LIST:', qresult.length, 'TRELLIS:', trellisList.length);
    */
  } catch (error) {
    console.log(error);
  }

  process.exit();
}

process.exit();

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
    domain: DOMAIN,
    token: TOKEN,
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

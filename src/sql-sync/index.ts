process.env.NODE_TLS_REJECT_AUTHORIZED='0';
import sql from 'mssql';
import { connect, JsonObject} from '@oada/client'
import config from '../config.js';
import Promise from 'bluebird';

let DOMAIN = config.get('trellis.domain');
let TOKEN = config.get('trellis.token');

let sqlConfig = {
  server: 'localhost',
  database: 'LFDynamic',
  user: 'trellisdev',
  port: 3003,
  options: {
    encrypt: true,
    trustServerCertificate: true 
  }
}

let prod = false;
if (prod) {
  sqlConfig = {
    server: 'localhost',
    database: 'LFDynamic',
    user: "trellisprod",
    port: 3003,
    options: {
      encrypt: true,
      trustServerCertificate: true
    }
  }
}
//let sqlString = 'Server=localhost,3003;TrustServerCertificate=true;Database=LFDynamic;User Id=trellisdev;Password=1S0wH9VhED^q;Encrypt=true'
      
async function main() {
  try {
    await sql.connect(sqlConfig);

    //const qresult = await sql.query`select * from SYSOBJECTS WHERE xtype = 'U'`
    //const qresult = await sql.query`select * from LFDynamic.INFORMATION_SCHEMA.TABLES`
    let qresult = (await sql.query`select * from SFI_Entities`).recordset as unknown as Array<sqlEntry>;
    let trellisList = await fetchTradingPartners();

    await handleEntities(trellisList, qresult);
    console.log('before', qresult)
    qresult = (await sql.query`select * from SFI_Entities`).recordset as unknown as Array<sqlEntry>;
    console.log('after', qresult)
    console.log("SQL LIST:", qresult.length, "TRELLIS:", trellisList.length)
  } catch (err) {
    console.log(err);
    }
  process.exit()
}

/*
async function addRemove(list: Array<sqlEntry>, name: string) {
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
  console.log(`adding ${name}`)
  try {
    return await sql.query`INSERT INTO SFI_Entities ("Entity Name") VALUES (${name})`;
    //await sql.query`INSERT INTO SFI_Entities ("Entity Name", "masterid") VALUES (${name}, ${masterid})`;
  } catch(err) {
    console.log("ERRORED ON THIS ONE", name)
    console.log(err);
    return undefined;
  }
}

async function fetchTradingPartners() {
  let CONNECTION = await connect({
    domain: DOMAIN,
    token: TOKEN
  })

  let tps = await CONNECTION.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`,

  }).then(r => r.data as JsonObject)
  return Object.values(tps) as unknown as Array<trellisEntry>;
}

async function handleEntities(trellis: Array<trellisEntry>, sqlList: Array<sqlEntry>) {
  let list = sqlList.map(i => i.rowguid);
  await Promise.map(sqlList, async (i) => await removeEntity(i.rowguid))
  return Promise.map(trellis, async (item) => {
    //TODO: Probably change this test after we add trellisId or something to the sql table entries
    if (!list.includes(item.masterid) && item.masterid !== undefined) {
      await addEntity(item.name)
    }
  })
}

interface sqlEntry {
  rowguid: string
  "Entity Name": string
}

interface trellisEntry {
  name: string
  masterid: string
}

main()

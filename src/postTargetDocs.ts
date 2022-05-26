import oada from '@oada/client';
import Promise from "bluebird";
import axios from "axios";
import type {JsonObject, OADAClient} from '@oada/client'
import type {TreeKey} from '@oada/list-lib/lib/tree';

// configuration details
import config from "./config.js";

const TOKEN = config.get('trellis.token');
const DOMAIN = config.get('trellis.domain');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const CO_ID = config.get('foodlogiq.community.owner.id');
let SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
let SERVICE_NAME = config.get('service.name') as unknown as TreeKey;

import tree from './tree.js';
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}
import {postTpDocument} from './mirrorWatch';
//@ts-ignore
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

let CONNECTION: OADAClient;

async function main() {
  try {
    console.log(DOMAIN, TOKEN, oada);
    CONNECTION = await oada.connect({
      domain: 'https://'+DOMAIN,
      token: TOKEN
    })

    //Iterate over each combination and queue a target job by writing it to the trading partner
    let testDocs = [
      //100g Nutritional Information
      "60ef1f572ae306000e79657e",
      //Allergen Statement
      "60db6cc6eb25c0000e1e25fe",
      //Animal Welfare Audit
      "616dbdcfc69b88000ffbf7c7",
      //Animal Welfare Corrective Actions
      "612fa0cf0a2537000eea2d71",
      //APHIS Statement
      "615f2012eb6c66000f833850",
      //Bioengineered (BE) Ingredient Statement
      "60ee425678bfbb000e7448f0",
      //Bisphenol A (BPA) Statement
      "614e4286f0fe6a000ff95c4f",
      //California Prop 65 Statement
      "60db6c2deb25c0000e1e25dd",
      //Co-Packer FSQA Questionnaire (GFSI Certified)
//      "6197c3bd985375000fa48635", //<--- multiple files; need a new sample
      //Co-Packer FSQA Questionnaire (Non-GFSI Certified)
      "61f9450bdf6175000f3705d4",
      //Country of Origin Statement
      "611d4f68bc1d45000eb306f0",
      //E.Coli 0157:H7 Intervention Audit
      "616dbe4f9a8b81000eb3090c",
      //E.Coli 0157:H7 Intervention Statement
      "60e4bc5b2ae306000fad3aa0",
      //Foreign Material Control Plan
      "611ac6a2e9832b000e947559",
      //GFSI Audit
      "611d095ccd16a3000fc81d71",
      //GFSI Certificate
      "61573806fa86c7000e47d12a",
      //Gluten Statement
      "60db6ca6a49a43000e2bacf9",
      //HACCP Plan / Flow Chart
      "613f8d3ccb4c4d000e8c67c5",
      //Humane Harvest Statement
      "61644aa8ced34f000f6a8b9b",
      //Ingredient Breakdown Range %
      "611d4f765949e3000e1e52a4",
      //Lot Code Explanation
      "61643367ced34f000f6a7f85",
      //National Residue Program (NRP) Statement
      "616717eaa02c9c000f3b991c",
      //Natural Statement
      "60df5e0678bfbb000f212bae",
      //Non-Ambulatory (3D/4D) Animal Statement
      "61645974fa892f000ea47adf",
      //Product Label
      "6197e21a540e10000e66a385",
   //   "611d3908cd16a3000fc831e2", //This has a Product Label and Specification together
      //Product Specification
      "611d3a5cbc1d45000eb2fe2f",
      //Safety Data Sheet (SDS)
      "60db6b60a49a43000e2baca2",
      //Specified Risk Materials (SRM) Audit
      "60ec8358a49a43000e6ffd72",
      //Specified Risk Materials (SRM) Audit Corrective Actions
  //    "",
      //Specified Risk Materials (SRM) Statement
      "61bce13e719715000f1d1149",
      //Third Party Food Safety GMP Audit
      "616dcd2ea02c9c000e9ebdb0",
      //Third Party Food Safety GMP Audit Corrective Actions
      "617ad3b177d6f3000fac8e7e", //Contains an XLS and PDF (pdf is just a cert essentially) <-- Multiple files; fix
      "611512cfe9832b000eb11462", // traditional SQF Correctives PDF
      //Third Party Food Safety GMP Certificate
      "615f3ce2eb6c66000f83427e",
      //ACH Form
      "60bf93ee1c31d4000e8fd94a",
      //Business License - photos are common
      "61842b2177d6f3000fae5652",//photo of a county license..
      "61a90d7afd13f1000e54871f",//this one is a pdf
      //Certificate of Insurance
      "611d05cdbc1d45000eb2e84e",
      //Co-Pack Confidentiality Agreement Form
      //"6197c623d8e74f000e0d8e73", //hand-written dates filled in...
      "610d8fd6811081000e4a9db6", //pdf, typed dates
      //Master Service Agreement (MSA)
      "6184399677d6f3000fae5a48",
  //    "613a34c00a2537000eeca3a2", //.docx format, very common
      //Pure Food Guaranty and Indemnification Agreement (LOG)
      //"6179b7f5a6baf600108dc41f", //2 documents - LOG and pure food guarantee, both pdf <-- Multiple; fix
      "61941497eb1008000e71ec41",
      "6196e0d1a4d710000e566f18",// most common form
      //Small Business Administration (SBA) Form
      "60db85f078bfbb000e84fcc4",
      //W-8
      "61f957a714a99d000e5c790e",
      //W-9
      "611acb38cd16a3000fc7c260",
      //WIRE Form
      "615e43069a8b81000fb55b52",
      //Rate Sheet - had an xls here
      "60db48509c09d3000f7a60f0",
      "61dc4133179e94000f8232f9", // just another pdf
//      "60f5e60d78bfbb000e3ec207", // <-- Multiple pdfs...need to solve this in oada
    ];
    //@ts-ignore
//    testDocs = [testDocs[0]];

    //1. Get the document from the mirror
    await Promise.each(testDocs, async (key, i) => {
      console.log('PROCESSING', i, key);
      //1. Fetch from FL and mirror it.
      let item = await axios({
        method: `get`,
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${key}`,
        headers: { 'Authorization': FL_TOKEN },
      }).then(r => r.data);

      let bid = item.shareSource.sourceBusiness._id;
      let mid = item.shareSource.membershipId;

      //3. Get the masterid
      let response = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}`,
      }).then(r=>r.data as JsonObject)
      .catch(err => {
        if (err.status !== 404) throw err;
        return {} as JsonObject
      })
      let masterid: string = response.masterid as string;
      console.log('first attempt', SERVICE_PATH, {masterid, bid});

      if (!masterid) {
        console.log('no masterid, trying again');
        //2. Fetch the business and ensure it exists
        let bus = await axios({
          method: `get`,
          url: `${FL_DOMAIN}/businesses/${CO_ID}/memberships/${mid}`,
          headers: { 'Authorization': FL_TOKEN },
        }).then(r => r.data);

        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${bid}`,
          data: {'food-logiq-mirror': bus},
          tree
        })

        await Promise.delay(5000)
      }

      //3. Get the masterid
      let result = await CONNECTION.get({
        path: `${SERVICE_PATH}/businesses/${bid}`,
      }).then(r=>r!.data! as JsonObject)
      masterid = result.masterid as string;
      console.log({masterid});

      if (!masterid) throw Error(`No masterid for key ${key}`)

      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${key}`,
        data: {'food-logiq-mirror': item},
        tree
      })

      await postTpDocument({masterid, item, bid, oada: CONNECTION});
      console.log('DONE', key);
    })
  } catch(err) {
    console.log(err);
  }
  process.exit();
}

main();

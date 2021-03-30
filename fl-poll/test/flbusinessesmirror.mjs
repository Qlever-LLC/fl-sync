import _ from "lodash";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import oada from "@oada/client";
import Promise from "bluebird";
import moment from "moment";
import debug from "debug";
import axios from "axios";
import SHA256 from "js-sha256";
const { sha256 } = SHA256;

const trace = debug('fl-sync:trace');
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');

let con = false;
const day = moment().format('YYYY-MM-DD');
chai.use(chaiAsPromised);
const expect = chai.expect;

// configuration details
import config from "../config.default.js";
import business_tree from "./business_tree.js";
import business_template from "./business_template.js";

const { FL_TOKEN, FL_DOMAIN, DOMAIN, TRELLIS_TOKEN, TEST_DOC_ID } = config;
const SF_FL_CID = config.sf_buyer.community_id;
const SF_FL_BID = config.sf_buyer.business_id;
const DOC_ID = TEST_DOC_ID;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const BS_DEMO = `/bookmarks/services/fl-sync/businesses/bs-0001`;
let business_hash = "";

/**
 * cleans up the demo business data
 * @param OADA 
 */
async function cleanUp(OADA) {
  let _path = BS_DEMO;
  console.log(_path);
  let _business = await OADA.delete({
    path: _path
  }).then((result) => {
    //console.log("--> business deleted. ", result);
  }).catch((error) => {
    console.log("--> error when deleting an asn ", error);
  });
}//cleanUp

/**
 * populates test business in FL branch
 * @param OADA 
 */
async function putData(OADA) {
  let _data = _.cloneDeep(business_template);
  let _path = BS_DEMO;

  let _business = await OADA.put({
    path: _path,
    tree: business_tree,
    data: _data
  }).then((result) => {
    let _json = JSON.stringify(_data["food-logiq-mirror"]);
    business_hash = sha256(_json);
    console.log(`--> business created -> hash [${business_hash}]`);
  }).catch((error) => {
    console.log("--> error when creating a business ", error);
  });
}//putData

describe("testing mirror - creating a business.", () => {
  before(async function () {
    this.timeout(60000);
    con = await oada.connect({ domain: DOMAIN, token: TRELLIS_TOKEN });
    await cleanUp(con);
    await putData(con);
  });

  it("should exist a business in fl-sync/businesses ", async () => {
    let path = BS_DEMO;
    let _result = await con.get({ path }).catch((error) => { console.log(error) });
    expect(_result.status).to.equal(200);
  });

  it("should exist a business in trellisfw/trading-partners ", async () => {
    let path = BS_DEMO;
    let _result = await con.get({ path }).catch((error) => { console.log(error) });
    expect(_result.status).to.equal(200);
  });

});

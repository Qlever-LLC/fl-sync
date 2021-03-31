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

let trellisTPTemplate = {
  sap_id: "",
  masterid: "",
  name: "",
  address: "",
  city: "",
  state: "",
  type: "CUSTOMER",
  coi_emails: "",
  fsqa_emails: "",
  email: "",
  phone: ""
};

let trellisfw_tp_tree = {
  "bookmarks": {
    "_type": "application/vnd.oada.bookmarks.1+json",
    "_rev": 0,
    "trellisfw": {
      "_type": "application/vnd.trellis.1+json",
      "_rev": 0,
      "trading-partners": {
        "_type": "application/vnd.trellisfw.trading-partners.1+json",
        "_rev": 0,
        "*": {
          "_type": "application/vnd.trellisfw.trading-partner.1+json",
          "_rev": 0,
        }
      }
    }
  }
};

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

/**
 * Retrieves all businesses from the fl-sync
 * then, it mirrors all businesses as trading-partners under
 * trellisfw
 * @param OADA connection
 */
async function flBusinessesMirror(OADA) {
  let _path = "/bookmarks/services/fl-sync/businesses";
  let _path_tp = "/bookmarks/trellisfw/trading-partners/";
  let _result = await OADA.get({ path: _path });

  for (const [k, v] of Object.entries(_result.data)) {
    if (k.substring(0, 1) !== '_' && k === "bs-0001") {
      let _dataStr = JSON.stringify(_result.data);
      console.log(_dataStr);
      console.log("--> key ", k);
      console.log("--> value ", v);
      let _business_path = _path + "/" + k;
      let _business = await OADA.get({ path: _business_path });
      let hash = sha256(JSON.stringify(_business.data["food-logiq-mirror"]));
      console.log("--> key hash", hash);
      let _path_tp_id = _path_tp + k;
      console.log(JSON.stringify(_business.data["food-logiq-mirror"]));
      console.log(_business.data["food-logiq-mirror"]["business"]);
      let data = _.cloneDeep(trellisTPTemplate);
      data.sap_id = hash;
      data.masterid = hash;
      data.name = _business.data["food-logiq-mirror"]["business"]["name"];
      data.address = _business.data["food-logiq-mirror"]["business"]["address"]["addressLineOne"];
      data.city = _business.data["food-logiq-mirror"]["business"]["address"]["city"];
      data.email = _business.data["food-logiq-mirror"]["business"]["email"];
      data.phone = _business.data["food-logiq-mirror"]["business"]["phone"];
      console.log("--> data", data);
      let _tp = await OADA.put({
        path: _path_tp_id,
        tree: trellisfw_tp_tree,
        data: data
      }).then((result) => {
        console.log("--> business mirrored. ");
      }).catch((error) => {
        console.log("--> error when mirroring ", error);
      });
    }//if
  }//for
}//flBusinessesMirror

describe("testing mirror - creating a business.", () => {
  before(async function () {
    this.timeout(60000);
    con = await oada.connect({ domain: DOMAIN, token: TRELLIS_TOKEN });
    await cleanUp(con);
    await putData(con);
    await flBusinessesMirror(con);
  });

  it("should exist a business in fl-sync/businesses ", async () => {
    let path = BS_DEMO;
    let _result = await con.get({ path }).catch((error) => { console.log(error) });
    expect(_result.status).to.equal(200);
  });

  it("should exist a business in trellisfw/trading-partners ", async () => {
    let path = "/bookmarks/trellisfw/trading-partners/bs-0001";
    let _result = await con.get({ path }).catch((error) => { console.log(error) });
    expect(_result.status).to.equal(200);
  });

  it("sap_id and masterid should match to sha256(content of food-logiq-mirror) ", async () => {
    let path = BS_DEMO;
    let _result = await con.get({ path }).catch((error) => { console.log(error) });
    let _path = "/bookmarks/trellisfw/trading-partners/bs-0001";
    let _result_tp = await con.get({ path: _path }).catch((error) => { console.log(error) });
    expect(sha256(JSON.stringify(_result.data["food-logiq-mirror"]))).to.equal(_result_tp.data.sap_id);
    expect(sha256(JSON.stringify(_result.data["food-logiq-mirror"]))).to.equal(_result_tp.data.masterid);
  });

});

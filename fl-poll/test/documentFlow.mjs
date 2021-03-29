import _ from "lodash";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import oada from "@oada/client";
import Promise from "bluebird";
import moment from "moment";
import debug from "debug";
import axios from "axios";

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
import tree from "../tree.js";

const { FL_TOKEN, FL_DOMAIN, DOMAIN, TRELLIS_TOKEN, TEST_DOC_ID } = config;
const SF_FL_CID = config.sf_buyer.community_id;
const SF_FL_BID = config.sf_buyer.business_id;

const DOC_ID = TEST_DOC_ID;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

let headers = {
  "Authorization": `${FL_TOKEN}`,
  "Content-type": "application/json"
};

describe("document flow (rejection, corrective action, change request, approval.)", () => {
  before(async function () {
    this.timeout(20000);
    //con = await oada.connect({ domain, token });
    //clean up if necessary
  })

  it("step 1: should reject document ", async () => {
    let path = `https://sandbox-api.foodlogiq.com/v2/businesses/${SF_FL_BID}/documents/${DOC_ID}/submitCorrectiveActions`;
    let result = await axios({
      method: "put",
      url: path,
      headers: headers
    });
    expect(result.status).to.equal(200);
  });

  it("step 2: should add a change request to the document ", async () => {
    let content = {
      "type": "change_request",
      "details": "[Automated from tests] -> Need to verify document."
    };
    let path = `https://sandbox-api.foodlogiq.com/v2/businesses/${SF_FL_BID}/documents/${DOC_ID}/capa`;
    let result = await axios({
      method: "post",
      url: path,
      headers: headers,
      data: content
    });
    expect(result.status).to.equal(201);
  });

  it("step 3: should approve the document ", async () => {
    let path = `https://sandbox-api.foodlogiq.com/v2/businesses/${SF_FL_BID}/documents/${DOC_ID}/approvalStatus/approved`;
    let result = await axios({
      method: "put",
      url: path,
      headers: headers
    });
    expect(result.status).to.equal(200);
  });

});

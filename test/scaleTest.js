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

chai.use(chaiAsPromised);
const expect = chai.expect;

// configuration details
import config from "../dist/config.js";

const TOKEN = config.get('trellis.token');
const FL_TOKEN = config.get('foodlogiq.token');
const SF_FL_CID = config.get('foodlogiq.community.id');
const SF_FL_BID = config.get('foodlogiq.community.owner.id');

const DOC_ID = TEST_DOC_ID;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

let TPs;
let con;

let headers = {
  "Authorization": `${FL_TOKEN}`,
  "Content-type": "application/json"
};

describe("scale testing", () => {
  before(async function () {
    this.timeout(60000);
    con = await oada.connect({domain: DOMAIN, token: TRELLIS_TOKEN})

    TPs = await con.get({
      path: `/bookmarks/trellisfw/trading-partners`
    }).then(r => r.data)
  })

  it("should handle 3000 trading partners", async () => {
    await Promise.each(Object.keys(TPs), tp => {

    })
    
    expect(result.status).to.equal(200);
  });

});

import _ from "lodash";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import moment from "moment";
import axios from "axios";
import Promise from "bluebird";
import debug from "debug";
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');
import * as config from '../config.default.js';

const day = moment().format('YYYY-MM-DD');
chai.use(chaiAsPromised);
const expect = chai.expect;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const BID = "60a70d7eb22bd7000e45af14";

let PATH_DOCUMENTS = `https://sandbox-api.foodlogiq.com/v2/businesses/${BID}/documents`;

let FL_TOKEN = config.default.FL_TOKEN;
let AUTHORIZATION = {
  "Authorization": FL_TOKEN
};

/**
 * gets FL documents for Centricity Test Account
 * @param path 
 */
async function getFLDocuments(path) {
  await axios({
    method: "get",
    url: path,
    headers: AUTHORIZATION
  }).then(async (result) => {
    return result.data.pageItems;
  }).catch((e) => {
    error("--> Error when retrieving documents. ", e);
    return [];
  });
}//cleanUpFLDocuments

/**
 * deletes the Centricity Test Account documents from FL
 * @param path url 
 */
async function cleanUpFLDocuments(path) {
  await axios({
    method: "get",
    url: path,
    headers: AUTHORIZATION
  }).then(async (result) => {
    //return result.data.pageItems;
    info("--> retrieving documents ", result.data.pageItems);
    await Promise.map(result.data.pageItems, async function (document) {
      let _path = path + `/${document._id}`
      return await axios({
        method: "delete",
        url: _path,
        headers: AUTHORIZATION
      }).then(async (del_result) => {
        info("Documents deleted.");
      });
    });

  }).catch((e) => {
    error("--> Error when retrieving documents. ", e);
    return [];
  });
}//cleanUpFLDocuments

/**
 * deletes documents from centricity test account
 * @param path 
 * @param documents 
 */
async function deleteDocuments(path, documents) {
  await Promise.map(documents, async function (document) {
    let _path = path + `/${document._id}`
    return await axios({
      method: "delete",
      url: _path,
      headers: AUTHORIZATION
    }).then(async (del_result) => {
      info("Documents deleted.");
    }).catch((e) => {
      error("--> Error when deleting documents. ", e);
    });
  });
}//deleteDocuments


describe("clean up documents in FL for Centricity Test Account.", () => {

  before(async function () {
    this.timeout(60000);
    // let documents = await getFLDocuments(PATH_DOCUMENTS);
    // await deleteDocuments(PATH_DOCUMENTS, documents);
    await cleanUpFLDocuments(PATH_DOCUMENTS);
    await Promise.delay(2000);
  });

  it(`there should not be documents for business ${BID}`, async () => {
    let n_docs = await axios({
      method: "get",
      url: PATH_DOCUMENTS,
      headers: AUTHORIZATION
    }).then(async (result) => {
      return result.data.pageItems.length;
    }).catch((e) => {
      error("--> Error when retrieving documents. ", e);
      return [];
    });
    expect(n_docs).to.equal(0);
  });

});

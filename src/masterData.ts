import bPromise from "bluebird";
import _ from 'lodash';
import {ListWatch} from '@oada/list-lib';
import SHA256 from "js-sha256";
let { sha256 } = SHA256;
import debug from 'debug';
import tree from './tree.masterData.js';
import config from './config.masterdata.js';
import type {JsonObject, OADAClient} from '@oada/client';
import type {TreeKey} from '@oada/list-lib/dist/tree.js'

const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
// TL_TP: string = config.get('trellis.endpoints.service-tp');
let TL_TP = `/bookmarks/trellisfw/trading-partners`;
let TL_TP_MI: string = `${TL_TP}/masterid-index`;
let TL_TP_EI = `${TL_TP}/expand-index`;
let FL_MIRROR = `food-logiq-mirror`;

let CONNECTION: OADAClient;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

let info = debug('fl-sync:master-data:info');
let error = debug('fl-sync:master-data:error');
let trace = debug('fl-sync:master-data:trace');

enum SOURCE_TYPE {
  Vendor = "vendor",
  Business = "business"
};

/**
 * watches for changes in the fl-sync/businesses
 */
export async function watchTrellisFLBusinesses(conn: OADAClient) {
  info(`Setting masterData ListWatch on FL Businesses`);
  setConnection(conn);
  new ListWatch({
    path: `${SERVICE_PATH}/businesses`,
    name: `fl-sync-master-data-businesses`,
    conn,
    tree,
    resume: true,
    onAddItem: addTP2Trellis
  });
}//watchTrellisFLBusinesses

/**
 * adds a trading-partner to the trellisfw when
 * a new business is found under services/fl-sync/businesses
 * @param {*} item
 * @param {*} key
 */
export async function addTP2Trellis(item: any, key: string, conn?: OADAClient) {
  info(`New FL business detected [${item._id}]. Mapping to trellis trading partner.`);
  if (!CONNECTION) {
    setConnection(conn!);
  }
  let _key: string = key.substring(1);
  try {
    if (typeof TradingPartners[key] === 'undefined') {//adds the business as trading partner
      let data = _.cloneDeep(trellisTPTemplate);
      let expandData: ExpandIndexRecord = _.cloneDeep(expandIndexTemplate);
      //FIXME: need to include a flag when search engine is present

      trace(`Business item: ${item}`);
      let _path = item["_id"];
      if (typeof item[FL_MIRROR] === 'undefined') {
        info(`Getting ${_path} with delay.`);
        //FIXME: find a more robust way to retrieve business content
        let fl_mirror_content = item[FL_MIRROR];
        let tries = 0;
        //retry until it gets a body with FL_MIRROR
        while (typeof fl_mirror_content === 'undefined') {
          await bPromise.delay(500);
          await CONNECTION.get({
            path: _path
          }).then(async (result: any) => {
            fl_mirror_content = result.data[FL_MIRROR];
            if (typeof fl_mirror_content === 'undefined') {
              info(`ListWatch did not return a complete object for business ${key}. Retrying ...`);
              if (tries > 10) {
                info(`Giving up. No 'food-logiq-mirror' for business at ${item._id}.`);
/*              await fetchAndSync({
                  from:`${FL_DOMAIN/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/contacts/${}`,
                  to: ``,
                })*/
               fl_mirror_content = false;
               return
              }
              tries++;
            } else {
              info(`Got a complete object.`);
              info(`assigning data after get.`);
              data = assignData(data, result.data);
              data["id"] = _path;
              expandData = assignDataExpandIndex(data, result.data);
            }//if
          }).catch((e: any) => {
            error("--> error when retrieving business ", e);
          });
        }//while FIXME: Verify consistency of this
      } else {//if
        data = assignData(data, item);
        data["id"] = _path;
        expandData = assignDataExpandIndex(data, item);
      }//if

      // mirroring the business into trading partners
      //1. make the resource
      info("--> mirroring the business into trading partners.");
      console.log('DATA', data);
      let resId = await CONNECTION.post({
        path: `/resources`,
        data: data,
        contentType: "application/vnd.oada.service.1+json"
      }).then((r: any) => {
        if (r && r.headers && r.headers['content-location']) {
          return r.headers['content-location'].replace(/^\//, '')
        }
      });
      let _datum = { _id: resId, _rev: 0 };
      await CONNECTION.put({
        path: `${TL_TP}`,
        data: {
          [key.replace(/^\//, '')]: _datum
        },
        tree
      }).then(async function () {
        info("----> business mirrored. ", `${TL_TP}${key}`);
        // creating bookmarks endpoint under tp
        await CONNECTION.put({
          path: `${TL_TP}${key}/bookmarks`,
          data: {},
          tree
        }).then(async (bookmarks_result: any) => {
          let _bookmarks_id: string = bookmarks_result["headers"] ? bookmarks_result["headers"]["content-location"] : "";
          let _string_content = _bookmarks_id.substring(1);
          if (_bookmarks_id !== "") {
            let _bookmarks_data: Bookmarks = {
              "bookmarks": {
                "_id": _string_content
              }
            };
            expandData["user"] = _bookmarks_data;
          }//if
        });
      }).catch((e: any) => {
        error("--> error when mirroring ", e);
      });

      // updating the expand index
      info("--> updating the expand-idex ", expandData.masterid);
      let expandIndexRecord: IExpandIndex = {};
      expandIndexRecord[_key] = expandData;
      await updateExpandIndex(expandData, _key);

      // updating the fl-sync/businesses/<bid> index
      info("--> updating masterid-index, masterid ", expandData.masterid);
      await updateMasterId(_path, expandData.masterid, resId);

      TradingPartners[key] = data;
    } else {
      info("--> TP exists. The FL business was not mirrored.");
    }//if
  } catch (e) {
    error("--> error ", e);
    throw error;
  }
}//addTP2Trellis

/**
 * assigns item data (new business) into the trading partner template
 * @param {*} data: TradingPartner
 * @param {*} item
 * @returns
 */
function assignData(data: TradingPartner, item: any) {//FIXME: NEED type for item
  try {
    let _id = sha256(JSON.stringify(item[FL_MIRROR]));
    if (typeof item[FL_MIRROR]["internalid"] !== 'undefined' ||
      item[FL_MIRROR]["internalid"] !== "") {
      _id = item[FL_MIRROR]["internalid"];
    }//if
    data.name = item[FL_MIRROR]["business"]["name"] ? item[FL_MIRROR]["business"]["name"] : "";
    data.address = item[FL_MIRROR]["business"]["address"]["addressLineOne"] ? item[FL_MIRROR]["business"]["address"]["addressLineOne"] : "";
    data.city = item[FL_MIRROR]["business"]["address"]["city"] ? item[FL_MIRROR]["business"]["address"]["city"] : "";
    data.email = item[FL_MIRROR]["business"]["email"] ? item[FL_MIRROR]["business"]["email"] : "";
    data.phone = item[FL_MIRROR]["business"]["phone"] ? item[FL_MIRROR]["business"]["phone"] : "";
    data.foodlogiq = item[FL_MIRROR] ? item[FL_MIRROR] : "";
    data.masterid = _id;
    data.internalid = _id;
  } catch (e) {
    error("Error when assigning data.", e);
    error("This is the content of the item FL MIRROR = ", item[FL_MIRROR]);
  }
  return data;
}//assignData

/**
 * builds expand index entry
 * @param data TradingPartner
 * @returns
 */
function assignDataExpandIndex(data: TradingPartner, item: any) {//FIXME: NEED type for item
  let _expandIndexData: ExpandIndexRecord = _.cloneDeep(expandIndexTemplate);
  let _id = sha256(JSON.stringify(item[FL_MIRROR]));
  if (typeof item[FL_MIRROR]["internalid"] !== 'undefined' &&
    item[FL_MIRROR]["internalid"] !== "") {
    _id = item[FL_MIRROR]["internalid"];
  }//if
  _expandIndexData.name = data.name ? data.name : "";
  _expandIndexData.address = data.address ? data.address : "";
  _expandIndexData.city = data.city ? data.city : "";
  _expandIndexData.state = "";
  _expandIndexData.email = data.email ? data.email : "";
  _expandIndexData.phone = data.phone ? data.phone : "";
  _expandIndexData.id = data.id ? data.id : "";
  _expandIndexData.internalid = _id;
  _expandIndexData.masterid = _id;
  _expandIndexData.sapid = _id;
  _expandIndexData.type = "CUSTOMER";

  return _expandIndexData;
}//assignDataExpandIndex

/**
 * updates the expand index with the information extracted
 * from the received FL business
 * @param expandIndexRecord expand index content
 */
async function updateExpandIndex(expandIndexRecord: JsonObject, key: string) {
  // expand index
  await CONNECTION.put({
    path: `${TL_TP_EI}`,
    data: {
      [key]: expandIndexRecord
    },
    tree
  }).then(() => {
    info("--> expand index updated. ");
  }).catch((e: any) => {
    error("--> error when mirroring expand index.", e);
  });
}//updateExpandIndex

/**
 * Updates the masterid property in the
 * fl-sync/business/<bid> endpoint
 * @param masterid string that contains internalid from FL or
 * random string created by sap-sync
 */
async function updateMasterId(path: string, masterid: string, resourceId: string) {
  let masterid_path = `${TL_TP_MI}/${masterid}`;
  info("--> masterid-index path ", masterid_path);
  info("--> masterid path ", path);

  //creating masterid-index
  let mi_datum = { _id: resourceId };
  await CONNECTION.put({
    path: TL_TP_MI,
    //path: masterid_path,
    data: {
      [masterid]: mi_datum,
    },
    tree
  }).then(() => {
    info("--> trading-partners/masterid-index updated.");
  }).catch((e: any) => {
    error("--> error when updating masterid-index element. ", e);
  });

  // updating masterid under fl-sync/business/<bid>
  await CONNECTION.put({
    path,
    data: { masterid: masterid },
  }).then(() => {
    info(`${SERVICE_PATH}/businesses/<bid> updated with masterid.`);
  }).catch((e: any) => {
    error("--> error when updating masterid element in fl-sync. ", e);
  });
}//updateMasterId

function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

type TradingPartner = {
  id: string,
  sapid: string,
  masterid: string,
  internalid: string,
  companycode?: string,
  vendorid?: string,
  partnerid?: string,
  name: string,
  address: string,
  city: string,
  state: string,
  type: string,
  source: SOURCE_TYPE,
  coi_emails: string,
  fsqa_emails: string,
  email: string,
  phone: string,
  foodlogiq?: string
};
interface ITradingPartner {
  [key: string]: TradingPartner;
};
let TradingPartners: ITradingPartner = {};

interface IExpandIndex {
  [key: string]: ExpandIndexRecord;
};

type ExpandIndexRecord = {
  "id": string,
  "internalid": string,
  "masterid": string,
  "sapid": string,
  "companycode"?: string,
  "vendorid"?: string,
  "partnerid"?: string,
  "address": string,
  "city": string,
  "coi_emails": string,
  "email": string,
  "fsqa_emails": string,
  "name": string,
  "phone": string,
  "state": string,
  "type": string,
  "source": SOURCE_TYPE,
  "user": Bookmarks
};

let expandIndexTemplate: ExpandIndexRecord = {
  "address": "",
  "city": "",
  "coi_emails": "",
  "email": "",
  "fsqa_emails": "",
  "id": "",
  "internalid": "",
  "masterid": "",
  "name": "",
  "phone": "",
  "sapid": "",
  "companycode": "",
  "vendorid": "",
  "partnerid": "",
  "state": "",
  "type": "CUSTOMER",
  "source": SOURCE_TYPE.Business,
  "user": {
    "bookmarks": {
      "_id": ""
    }
  }
};

type Bookmarks = {
  "bookmarks": {
    "_id": string
  }
};

let trellisTPTemplate: TradingPartner = {
  id: "", // both (vendor and business)
  sapid: "", // business
  masterid: "", // business
  internalid: "", //business
  companycode: "",
  vendorid: "",
  partnerid: "",
  name: "", // both
  address: "", //both
  city: "", // both
  state: "", //both
  type: "CUSTOMER", // both
  source: SOURCE_TYPE.Business,
  coi_emails: "", // business
  fsqa_emails: "", // business
  email: "", // both
  phone: "" //both,
};
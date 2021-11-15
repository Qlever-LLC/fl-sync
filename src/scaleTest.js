import chai from "chai";
import csvjson from 'csvjson'
import fs from 'fs';
import chaiAsPromised from "chai-as-promised";
import Promise from "bluebird";
import moment from "moment";
import pointer from 'json-pointer'
import debug from "debug";
import axios from "axios";
import ksuid from "ksuid";
const oada = require('@oada/client');
const _ = require('lodash');

const trace = debug('fl-sync:trace');
const info = debug('fl-sync:info');
const warn = debug('fl-sync:warn');
const error = debug('fl-sync:error');

chai.use(chaiAsPromised);
const expect = chai.expect;

// configuration details
import config from "./config.js";

const TOKEN = config.get('trellis.token');
const LOCAL = process.env.LOCAL;
const DOMAIN = config.get('trellis.domain');
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMM_ID = config.get('foodlogiq.community.id');
const SUPPLIER = '60a70d7eb22bd7000e45af14';
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const ASSESSMENT_TEMPLATE_NAME = config.get('foodlogiq.assessment-template.name');
const tree = require('./tree.js');
const dummy = require('./dummyData.js');
const flSync = require('./index.js')
const userId = "5e27480dd85523000155f6db";
const curReport = `/bookmarks/services/fl-sync/reports/day-index/2021-09-29/1ypFKs8LWHvqDh8YwKT54DQ9A3x`

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

let SERVICE_PATH = `/bookmarks/services/fl-sync`;
let TPs;
let con;
let TP_QUANTITY = 1000;
let COI_QUANTITY = 2;
let NONCOI_QUANTITY = 40;

let headers = {
  "Authorization": `${FL_TOKEN}`,
  "Content-type": "application/json"
};
let shareRecipients = [
  {
    "community": {
      "business": {
        "_id": "5acf7c2cfd7fa00001ce518d",
        "name": "Smithfield Foods",
        "heroURL": "",
        "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
        "address": {
          "addressLineOne": "401 North Church Street",
          "addressLineTwo": "",
          "addressLineThree": "",
          "city": "Smithfield",
          "region": "VA",
          "country": "US",
          "postalCode": "23430",
          "latLng": {
            "latitude": 36.9904087,
            "longitude": -76.6305249
          }
        },
        "website": "http://www.smithfieldfoods.com/",
        "email": "cpantaleo@smithfield.com",
        "phone": "(757) 365-3529"
      },
      "address": {
        "addressLineOne": "",
        "addressLineTwo": "",
        "addressLineThree": "",
        "city": "",
        "region": "",
        "country": "",
        "postalCode": "",
        "latLng": {
          "latitude": 0,
          "longitude": 0
        }
      },
      "_id": "5fff03e0458562000f4586e9",
      "createdAt": "2021-03-04T20:44:22.823Z",
      "updatedAt": "2021-05-06T20:47:06.69Z",
      "name": "Smithfield Foods",
      "communityType": "member",
      "suppliersCanLink": false,
      "supplierCanLinkLocations": false,
      "suppliersCanLinkLocationsOfType": [],
      "email": "implementation@foodlogiq.com",
      "website": "",
      "phone": "",
      "membershipType": "Suppliers",
      "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
      "heroURL": "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
      "feedPosts": null,
      "videoLinks": null,
      "links": null,
      "replyToEmail": "implementation@foodlogiq.com",
      "welcomeMessage": {
        "modalTitle": "Welcome",
        "bodyTitle": "Welcome to Smithfield Foods’ Supplier Portal",
        "bodyMessage": "Smithfield Foods has created this community for you to share information about your company, people, products, and food safety programs, and to provide a convenient location for us to communicate with our supplier partners like you.\nIf you have questions at any time about the program your supplier manager will act as your main contact."
      },
      "onboardingInstructions": {
        "instructions": "<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class=\"MsoPlainText\">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class=\"MsoPlainText\">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class=\"MsoPlainText\">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company's individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you'll be asked to collect and enter information about your business. You'll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u>Available Resources</u></b><br></p><p><a href=\"https://connect.foodlogiq.com/view/60de21d29c09d3000ef2fef0\" target=\"\">Supplier Management Webinar Recording&#8203;</a></p><p><a href=\"https://connect.foodlogiq.com/view/60ad3f07f0ba6a000ef4fff6\" target=\"_blank\">Supplier Management Webinar Slide Deck</a></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type=\"disc\">  <ul type=\"circle\">   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard\" target=\"_blank\"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting\">Inviting       Users</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667\">Adding       Locations</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667\">Adding       Products</a></u></li>   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments\"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647\" target=\"_blank\">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href=\"mailto:support@foodlogiq.com\"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href=\"mailto:fsqasupplier@smithfield.com\"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href=\"mailto:fsqasupplier@smithfield.com\"></u></p><p></p>"
      }
    },
    "type": {
      "_id": "60653e5e18706f0011074ec8",
      "createdAt": "2021-04-01T03:30:38.377Z",
      "updatedAt": "2021-06-06T21:51:03.079Z",
      "business": {
        "_id": "5acf7c2cfd7fa00001ce518d",
        "name": "Smithfield Foods Corp.",
        "heroURL": "",
        "iconURL": "https://flq-connect-production.s3.amazonaws.com/6047bc14eaaf2e00014f4af1",
        "address": {
          "addressLineOne": "401 North Church Street",
          "addressLineTwo": "",
          "addressLineThree": "",
          "city": "Smithfield",
          "region": "VA",
          "country": "US",
          "postalCode": "23430",
          "latLng": {
            "latitude": 36.9904087,
            "longitude": -76.6305249
          }
        },
        "website": "http://www.smithfieldfoods.com/",
        "email": "cpantaleo@smithfield.com",
        "phone": "(757) 365-3529"
      },
      "name": "Certificate of Insurance",
      "template": {
        "S3Name": "60935ec3e8541c00121e8a1a",
        "fileName": "Vendor Insurance Requirement Guide.pdf",
        "BucketName": "flq-connect-production",
        "updatedAt": "2021-05-06T03:13:07.358Z"
      },
      "attributes": [
        {
          "fieldType": "date",
          "storedAs": "effectiveDate",
          "commonName": "Effective Date",
          "required": true,
          "options": null,
          "multiple": false,
          "includeOtherOpt": false,
          "isCustom": false,
          "fieldOne": null,
          "fieldTwo": null
        }
      ],
      "helpText": "Please upload a Certificate of Insurance (COI) that meets the requirements listed in the Vendor Insurance Requirement Guide (refer to attachment).",
      "associateWith": "",
      "category": "Legal",
      "defaultAttributes": {
        "expirationDate": true
      },
      "is3rdPartyAudit": false,
      "scopes": [],
      "certificationBodies": [],
      "whoToNotify": {
        "rolesToNotify": [
          {
            "_id": "6081f0f618706f000fc81896",
            "name": "FSQA Compliance Manager"
          }
        ],
        "notifyBuyer": false,
        "notifyAdministrator": false
      },
      "whoCanEdit": {
        "administratorCanEdit": false,
        "rolesCanEdit": []
      },
      "requirement": "",
      "community": {
        "_id": "5fff03e0458562000f4586e9",
        "name": "Smithfield Foods",
        "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
        "replyToEmail": "implementation@foodlogiq.com"
      }
    },
    "shareSpecificAttributes": {
      "effectiveDate": "2021-05-21T16:00:00.000Z"
    }
  }
]

async function makeFlBusiness() {
  try {
  let name = 'TRELLIS-TEST'+ksuid.randomSync().string;
  let mid = await axios({
    method: 'post',
    url: `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMM_ID}/membershipinvitations`,
    headers,
    data:{
      "email": "dev_3pty@centricity.us",
      name,
      "msg": "Joining this supplier community gives you access to easy-to-use tools to keep your relationship up to date with the latest information about your products, location, audits, and more.",
      "firstName": "Trellis",
      "lastName": "Test",
      "locationGroupId": "604c0d48c57289000ef55861",
      "productGroupId": "604132678b2178000ed4ffe1",
      "buyers": []
    } 
  }).then(r => r.data._id)
  let bid = await axios({
    method: 'post',
    url: `${FL_DOMAIN}/businesses/${mid}`,
    headers,
    data: {
      name,
      "alternateNames": [
        ""
      ]
    }
  }).then(r=> r.data._id)
  let accept = await axios({
    method: 'put',
    headers,
    url: `${FL_DOMAIN}/businesses/${bid}/membershipinvitations/${mid}/accept`,
    data: {
      "invitationId": mid,
      "communityId": "5fff03e0458562000f4586e9"
    }
  })
  return {mid, bid, name};
 } catch(err) {
   console.log('makeFlBusines', err);
   throw err;
 }
}

async function deleteFlBusinesses() {
//1. Get the existing ones
  try {
  let data = await axios({
    method: 'get',
    headers,
    url: `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMM_ID}/memberships`
  }).then(r => r.data);

  let members = data.filter(obj => /^TRELLIS/.test(obj.business.name));

  await Promise.each(members, async member => {
    await axios({
      method: 'delete',
      headers,
      url: `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMM_ID}/membership/${member._id}`
    })
  })

  data = await axios({
    method: 'get',
    headers,
    url: `${FL_DOMAIN}/businesses`
  }).then(r => r.data);

  members = data.filter(obj => /^TRELLIS/.test(obj.name));

  await Promise.each(members, async member => {
    await axios({
      method: 'delete',
      headers,
      url: `${FL_DOMAIN}/businesses/${member._id}`
    })
  })

  } catch(err) {
    console.log('deleteFlBusinesses', err);
  }
}

async function deleteFlBizDocs() {
//1. Get the existing ones
  try {
  let bids = {};
  let ct = 0;
  let data = await axios({
    method: 'get',
    headers,
    url: `${FL_DOMAIN}/businesses`
    //url: `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMM_ID}/memberships`
  }).then(r => r.data);
  console.log('members', data.length)

//  let members = data.filter(obj => /^TRELLIS/.test(obj.business.name));
  let members = data;

  await Promise.each(members, async member => {
    let bid = member._id;
    //let bid = member.business._id;
    let data = await axios({
      method: 'get',
      headers: {Authorization: FL_TOKEN},
      url: `${FL_DOMAIN}/v2/businesses/${bid}/documents`,
    }).then(r => r.data)
    .catch(err => {return {pageItems: []}});
//    console.log(bid, data.totalItemCount)
    if (data.totalItemCount > 42) {
      bids[bid] = bid
    } else {
      ct+= data.totalItemCount;
    }

    /*
    let docs = data.pageItems.filter(obj => /^TRELLIS-TEST-AnimalWelfare/.test(obj.name));
    let length = docs.length;
    let surplus = length > NONCOI_QUANTITY ? length - NONCOI_QUANTITY : 0;
    docs.splice(surplus)

    console.log(`Deleting ${surplus} non docs from bid [${bid}]`);
    await Promise.map(docs, async (item, i) => {
      console.log(`Deleting noncoi ${i} for bid [${bid}]`)
      let coiid = await axios({
        method: 'delete',
        headers: {Authorization: FL_TOKEN},
        url: `${FL_DOMAIN}/v2/businesses/${bid}/documents/${item._id}`,
      }).then(r => r.data._id)
    })

    let cdocs = data.pageItems.filter(obj => /^TRELLIS-TEST-COI/.test(obj.name));
    let clength = cdocs.length;
    let csurplus = clength > COI_QUANTITY ? clength - COI_QUANTITY : 0;
    docs.splice(csurplus)

    console.log(`Deleting ${csurplus} coi docs from bid [${bid}]`);
    await Promise.map(cdocs, async (item, i) => {
      console.log(`Deleting coi ${i} for bid [${bid}]`)
      let coiid = await axios({
        method: 'delete',
        headers: {Authorization: FL_TOKEN},
        url: `${FL_DOMAIN}/v2/businesses/${bid}/documents/${item._id}`,
      }).then(r => r.data._id)
    })
    */
  })
    console.log(ct, 'BIDS', bids);

  } catch(err) {
    console.log('deleteFlBizDocs', err);
  }
}

async function getFlBusinesses() {
//1. Get the existing ones
  try {
  let data = await axios({
    method: 'get',
    headers,
    url: `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMM_ID}/memberships`
  }).then(r => r.data);

  let members = data.filter(obj => /^TRELLIS/.test(obj.business.name));
  let TPs = {};

  await Promise.each(members, async member => {
    let mid = member._id
    let bid = member.business._id;
    let name = member.business.name;
    TPs[bid] = {
      cois: {},
      docs: {},
      bid,
      mid,
      name
    }
  })

//2. Get the number of TPs
  let length = members.length
  console.log('Current TPs:', length)

//3. Create any new ones
  let additional = length < TP_QUANTITY ? TP_QUANTITY - length : 0;
  console.log('Additional businesses to create:', additional)

  await Promise.map(new Array(additional), async () => {
    let {bid, name, mid} = await makeFlBusiness()
    console.log('Made a new business:', bid)
    TPs[bid] = {bid, mid, cois: {}, docs: {}}
  }, {concurrency: 50})

  return TPs;
  } catch(err) {
   console.log('getFlBusinesses', err);
  }
}

async function getFakeFlBusinesses() {
//1. Get the existing ones
  try {
  let data = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  }).then(r => r.data);

  let keys = Object.keys(data).filter(key => /^TRELLIS/.test(key));
  let TPs = {};

  await Promise.each(keys, async key => {
    await makeFlBusiness(key)
    let mid = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${key}`
    }).then(r => r.data['food-logiq-mirror']._id)
    .catch(err => {
      console.log('err', err);
    })
    TPs[key] = {
      cois: {},
      docs: {},
      bid: key,
      mid
    }
  })

//2. Get the number of TPs
  let length = keys.length
  console.log('current TPs:', length)

//3. Create any new ones
  let additional = length < TP_QUANTITY ? TP_QUANTITY - length : 0;
  console.log('additional TPs to create:', additional)

  await Promise.each(new Array(additional), async () => {
    let {bid, mid} = await dummy.fakeFlBusiness();
    console.log('make a fake bid', bid)
    TPs[bid] = {bid, mid, cois: {}, docs: {}}
  })

  return TPs;
  } catch(err) {
   console.log(err);
   }
}


async function getFakeFlBusinesses() {
//1. Get the existing ones
  try {
  let data = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  }).then(r => r.data);

  let keys = Object.keys(data).filter(key => /^TRELLIS/.test(key));
  let TPs = {};

  await Promise.each(keys, async key => {
    console.log('fetching bid', key)
    let mid = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${key}`
    }).then(r => r.data['food-logiq-mirror']._id)
    .catch(err => {
      console.log('err', err);
    })
    TPs[key] = {
      cois: {},
      docs: {},
      bid: key,
      mid
    }
  })

//2. Get the number of TPs
  let length = keys.length
  console.log('current TPs:', length)

//3. Create any new ones
  let additional = length < TP_QUANTITY ? TP_QUANTITY - length : 0;
  console.log('additional TPs to create:', additional)

  await Promise.map(new Array(additional), async () => {
    let {bid, mid} = await fakeFlBusiness();
    console.log('make a fake bid', bid)
    TPs[bid] = {bid, mid, cois: {}, docs: {}}
  }, {concurrency: 50})

  return TPs;
  } catch(err) {
   console.log(err);
   }
}

async function makeFakeContent() {
  //TODO: fetch TPs and see if there are already 3000
  let TPs = await getFlBusinesses();
  fs.writeFileSync('./scaleTestData.json', JSON.stringify(TPs))

  await Promise.map(Object.values(TPs), async ({bid, mid}, h) => {
    let data = await axios({
      method: 'get',
      headers: {Authorization: FL_TOKEN},
      url: `${FL_DOMAIN}/v2/businesses/${bid}/documents`,
    }).then(r => r.data)
    
    let docs = data.pageItems.filter(obj => /^TRELLIS-TEST-COI/.test(obj.name));
    let length = docs.length;
    let additional = length < COI_QUANTITY ? COI_QUANTITY - length : 0;
    console.log(`Additional COIS for bid [${bid}] (${h}): ${additional}`)
    console.log({length, additional})
    await Promise.map(new Array(additional), async (item, i) => {
      console.log(`Creating coi ${i} for bid [${bid}]`)
      let doc = dummy.newCoiDoc(bid);
      let coiid = await axios({
        method: 'post',
        headers: {Authorization: FL_TOKEN},
        url: `${FL_DOMAIN}/v2/businesses/${bid}/documents`,
        data: doc
      }).then(r => r.data._id)
      TPs[bid].cois[coiid] = coiid;
    })

    //Now non-coi docs; re-use the data retrieved above; all docs are together
    let ndocs = data.pageItems.filter(obj => /^TRELLIS-TEST-AnimalWelfare/.test(obj.name));
    let nlength = ndocs.length;
    let nadditional = nlength < NONCOI_QUANTITY ? NONCOI_QUANTITY - nlength : 0;
    console.log(`Additional NONCOIS for bid [${bid}] (${h}): ${nadditional}`)
    console.log({nlength, nadditional})
    await Promise.map(new Array(nadditional), async (item, j) => {
      console.log(`Creating non-coi ${j} for bid [${bid}]`)
      let doc = dummy.newNonCoiDoc(bid);
      let docid = await axios({
        method: 'post',
        headers: {Authorization: FL_TOKEN},
        url: `${FL_DOMAIN}/v2/businesses/${bid}/documents`,
        data: doc
      }).then(r => r.data._id)
      TPs[bid].docs[docid] = docid;
    })
  }, {concurrency: 50})
  fs.writeFileSync('./scaleTestData.json', JSON.stringify(TPs))
  return TPs;
}

main();

async function deleteTargetJobs() {
  let response = await con.get({
    path: `/bookmarks/services/target/jobs`
  })

  let keys = Object.keys(response.data).filter(key => key.charAt(0) !== '_')

  await Promise.map(keys, async key => {
    console.log('deleting', `/bookmarks/services/target/jobs/${key}`)
    await con.delete({
      path:`/bookmarks/services/target/jobs/${key}`,
    })
  }, {concurrency: 50})
}

async function deleteFlSync() {
  await con.delete({
    path: `/bookmarks/services/fl-sync`
  })
}

async function deleteBusinesses() {
  let response = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })

  let keys = Object.keys(response.data).filter(key => /^TRELLIS/.test(key))

  await Promise.map(keys, async key => {
    console.log('deleting', `/bookmarks/services/fl-sync/businesses/${key}`);
    await con.delete({
      path: `/bookmarks/services/fl-sync/businesses/${key}`
    })
  }, {concurrency: 50})
}

async function deleteBusinessDocs() {
  let response = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })

//  let keys = Object.keys(response.data).filter(key => /^TRELLIS/.test(key))
  let keys = Object.keys(response.data).filter(key => key.charAt(0) !== '_');

  await Promise.map(keys, async key => {
    console.log('deleting', `/bookmarks/services/fl-sync/businesses/${key}/documents`);
    await con.delete({
      path: `/bookmarks/services/fl-sync/businesses/${key}/documents`
    })
  }, {concurrency: 50})
}

async function deleteTradingPartners() {
  let response = await con.delete({
    path: `/bookmarks/trellisfw/trading-partners`
  })
}

async function countFlBusinessDocs(TPs) {
  let results = {
    docs: {
      fail: {},
      success: 0
    },
    cois: {
      fail: {},
      success: 0
    }
  };
  await Promise.map(Object.keys(TPs), async bid => {
    let data = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
    }).then(r => r.data);

    let keys = Object.keys(data).filter(key => key.charAt(0) !== '_');

    let length = keys.length;

    // Make sure they have 40 docs;
    if (length !== 40) {
      results.docs.fail[bid] = data;
    } else results.docs.success++;

    data = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/cois`
    }).then(r => r.data);

    keys = Object.keys(data).filter(key => key.charAt(0) !== '_');

    length = keys.length;

    // Make sure they have 2 docs;
    if (length !== 2) {
      results.docs.fail[bid] = data;
    } else results.docs.success++;
  })
}

async function checkResult() {
  let successes = 0;
  let fails = 0;
  let data = JSON.parse(fs.readFileSync('scaleTestData.json'));
  let vals = Object.values(data);

  let bids = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  }).then(r => r.data)

  let keys = bids.filter(key => key.charAt(0) !== '_')

  let TPsExpand = await con.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`
  }).then(r => r.data)

  await Promise.map(Object.keys(keys), async bid => {
    let biddocs = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
    }).then(r => r.data)
    let docs = biddocs.filter(key => key.charAt(0) !== '_')

    let tp;

    let tpdocs = await con.get({
      path: `/bookmarks/trellisfw/trading-partners/${tp}/documents`
    }).then(r => r.data)

    let tpcois = await con.get({
      path: `/bookmarks/trellisfw/trading-partners/${tp}/cois`
    }).then(r => r.data)

    await Promise.map(Object.keys(docs), async docid => {

    })
  })

  /*
  let TPsExpand = await con.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`
  }).then(r => r.data)
  let tpeVals = Object.values(TPsExpand)


  fails = {};

  let success = 0;

  await Promise.map(vals, async obj => {
    //1. Make sure a business exists for that fl-sync business
    let result;
    await Promise.map(Object.keys(TPsExpand), key => {
      if (TPsExpand[key].name === obj.name) {
        result = TPsExpand;
        if (TPs[key]) {
          success++;
        } else {
          fails[obj.name] = obj;
        }
      }
    })
    if (!result) fails[obj.name] = obj;
  })
  */

  console.log(vals.length, success, fails);

}

async function skipTPDocs() {
 let TPs = await con.get({
    path: `/bookmarks/trellisfw/trading-partners`
  }).then(r => r.data)

  let keys = Object.keys(TPs).filter(key => key.charAt(0) !== '_').filter(key => key !== 'expand-index')

  await Promise.map(keys, async key => {
    const rev = await con.get({
      path: `/bookmarks/trellisfw/trading-partners/${key}/shared/trellisfw/documents/_rev`,
    }).then(r => r.data)

    console.log(`setting /bookmarks/trellisfw/trading-partners/${key}/shared/trellisfw/documents/_meta/oada-list-lib/target-helper-tp-docs to ${TPs[key]._rev}`)
    await con.put({
      path: `/bookmarks/trellisfw/trading-partners/${key}/shared/trellisfw/documents/_meta/oada-list-lib/target-helper-tp-docs`,
      data: { rev }
    })
  })
}




async function compareResult() {
  let data = JSON.parse(fs.readFileSync('scaleTestData.json'));
  let vals = Object.values(data);

  let TPs = await con.get({
    path: `/bookmarks/trellisfw/trading-partners`
  }).then(r => r.data)

  let TPsExpand = await con.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`
  }).then(r => r.data)
  let tpeVals = Object.values(TPsExpand)


  let fails = {};

  let success = 0;

  await Promise.map(vals, async obj => {
    //1. Make sure a business exists for that fl-sync business
    let result;
    await Promise.map(Object.keys(TPsExpand), key => {
      if (TPsExpand[key].name === obj.name) {
        result = TPsExpand;
        if (TPs[key]) {
          success++;
        } else {
          fails[obj.name] = obj;
        }
      }
    })
    if (!result) fails[obj.name] = obj;
  })

  console.log(vals.length, success, fails);

}


async function deleteBadTargetJobs() {

  let jobs = await con.get({
    path: `/bookmarks/services/target/jobs`,
  }).then(r => r.data)
}

async function getTPListLibCount() {
  let data = await con.get({
    path: `/bookmarks/trellisfw/trading-partners`
  }).then(r => r.data);

  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_');

  let good = 0;;
  await Promise.map(keys, async key => {
    await con.head({
      path: `/bookmarks/trellisfw/trading-partners/${key}/shared/trellisfw/documents/_meta/oada-list-lib/target-helper-tp-docs`
    })
    .then(() => good++)
    .catch(err => {return})
  })
  console.log('TP with meta count:', good);
}

async function getTPCount() {
  let data = await con.get({
    path: `/bookmarks/trellisfw/trading-partners`
  }).then(r => r.data);

  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_');
  let length = keys.length;
  console.log('TP Count:', length);
}

async function handleIncompleteCois(){
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue/scripted`
  })
  await Promise.each(Object.keys(data), async key => {
    let item = data[key];
    await Promise.map(data[key].coiDocuments, async docId => {
      console.log('getting', `/bookmarks/services/fl-sync/businesses/${item.businessid}/documents/${docId}`)
      let data = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${item.businessid}/documents/${docId}`
      }).then(r => r.data['food-logiq-mirror'])

      console.log('putting', `/bookmarks/services/fl-sync/businesses/${item.businessid}/documents/${docId}`)
      await con.put({
        path: `/bookmarks/services/fl-sync/businesses/${item.businessid}/documents/${docId}`,
        data: { "food-logiq-mirror": data }
      })
    })
  })
}

async function cleanupProcessQueue() {
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue`
  })

  await Promise.each(['pdfs', 'jobs'], async type => {
    await Promise.map(Object.keys(data[type]), async key => {
      await Promise.map(Object.keys(data[type]), async keyb => {
        if (key === keyb) return
        if (data[type][key] === data[type][keyb]) {
          console.log('found a pair', key, keyb);
        }
      })
    })
  })
  
}

async function reprocessProd() {
  let count = 0;
  let badCount = 0;
  let goods = [];
  let goodRefs = {};
  let bads = [];
  let response = await con.get({
    path: `/bookmarks/trellisfw/trading-partners/expand-index`
  })
  let tps = Object.keys(response).filter(key => key.charAt(0) !== '_')

  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async bid => {
    let docs = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
    }).then(r => r.data)
    .catch(err => {
      return;
    })
    let masterid = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/masterid`
    }).then(r => r.data)
    .catch(err => {
      console.log('MASTERID NOT FOUND FOR BID', bid);
      return;
    })
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    await Promise.map(k, async key => {
      let meta = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`
      }).then(r => r.data)

      if (pointer.has(meta, '/vdoc/pdf')) {
        let vdoc = Object.keys(meta.vdoc.pdf)[0]
        let ref = meta.vdoc.pdf[vdoc]._id.replace(/^resources\//, '')
        goods.push({bid, key})
        goodRefs[key] = {
          bid, 
          key, 
          masterid,
          path: `/bookmarks/trellisfw/trading-partners/masterid-index/${masterid}/shared/documents/${ref}`
        };
        count++;
      } else {
        bads.push({bid, key})
        badCount++;
      }
    })
  })

  let cois = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue/scripted`
  }).then(r => r.data);

  let found = [];
  let overlapgood = 0;
  let overlapbad = 0;
  await Promise.map(Object.keys(cois), async k => {
    await Promise.map(cois[k].coiDocuments, key => {
      let coi = {bid: cois[k].businessid, key }
      if (goods.some(item => _.isEqual(item, coi))) {
        overlapgood++;
      }
      if (bads.some(item => _.isEqual(item, coi))) {
        overlapbad++;
        delete goodRefs[key]
      }
    })
  })

  console.log({count, badCount, overlapgood, overlapbad});
  console.log('goodrefs', Object.keys(goodRefs).length);

  await Promise.each(Object.keys(goodRefs), async ref => {
    let item = goodRefs[ref];
    console.log('deleting', item.path);
    await con.delete({
      path: item.path
    })
    console.log('puting',`/bookmarks/services/fl-sync/businesses/${item.bid}/documents/${item.key}/_meta/vdoc`);
    await con.put({
      path: `/bookmarks/services/fl-sync/businesses/${item.bid}/documents/${item.key}/_meta/vdoc`,
      data: 5
    })

    let path = `/bookmarks/services/fl-sync/businesses/${item.bid}/documents/${item.key}`
    console.log('GETing', path)
    let docdata = await con.get({
      path
    }).then(r => r.data['food-logiq-mirror']);

    console.log('docdata', docdata);
    let p = await con.put({
      path: path,
      data: {
        'food-logiq-mirror': docdata
      }
    })
    console.log('p', p.status);
  })

}

async function findTrellisDocs() {
  let count = 0;
  let badCount = 0;
  let goods = [];
  let bads = [];
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async bid => {
    let docs = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
    }).then(r => r.data)
    .catch(err => {
      return;
    })
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    console.log('BID', bid);
    await Promise.map(k, async key => {
      let meta = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`
      }).then(r => r.data)

      if (pointer.has(meta, '/vdoc/pdf')) {
        let vdoc = Object.keys(meta.vdoc.pdf)[0]
        let ref = meta.vdoc.pdf[vdoc]._id.replace(/^resources\//, '')
        goods.push({bid, key})
        count++;
      } else {
        bads.push({bid, key})
        badCount++;
      }
    })
  })

  let cois = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue/scripted`
  }).then(r => r.data);

  let found = [];
  let overlapgood = 0;
  let overlapbad = 0;
  console.log(bads, goods);
  await Promise.map(Object.keys(cois), async k => {
    await Promise.map(cois[k].coiDocuments, key => {
      let coi = {bid: cois[k].businessid, key }
      console.log(coi);
      if (goods.some(item => _.isEqual(item, coi))) {
        overlapgood++;
      }
      if (bads.some(item => _.isEqual(item, coi))) {
        overlapbad++;
      }
    })
  })
  console.log({count, badCount, overlapgood, overlapbad});

}

async function countCois() {
  try {
  let count = 0;
  let cois = [];
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async bid => {

    let docs = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents`,
        headers: {Authorization: `Bearer ${TOKEN}`}
    }).then(r => r.data)
    /*
    let docs = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
    }).then(r => r.data)
    */
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    await Promise.map(k, async key => {

      /*
      let doc = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`
      }).then(r => r.data)
      */

      let doc = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
        headers: {Authorization: `Bearer ${TOKEN}`}
      }).then(r => r.data)


      if (pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`)) {
        let type = pointer.get(doc, `/food-logiq-mirror/shareSource/type/name`)
        if (type === 'Certificate of Insurance') {
          count++;
          cois.push({bid, key})
        }
      }
    }, {concurrency: 5}).catch(err => {
      console.log('there was an error', err);
    })
  }).catch(err => {
    console.log('there was an error', err);
  })
  console.log('cois', count);

  await Promise.each(cois, async coi => {
    let path = `/bookmarks/services/fl-sync/businesses/${coi.bid}/documents/${coi.key}`;
    let docdata = await con.get({
      path,
    }).then(r => r.data['food-logiq-mirror']);

    let p = await con.put({
      path,
      data: {
        'food-logiq-mirror': docdata
      }
    })
  })
  } catch(err) {
    console.log('FOUND AN ERROR', err);
  }
}

async function howManyDocs() {
  let totalCount = 0;
  let cois = 0;
  let {data} = await con.get({
    path: `/bookmarks/trellisfw/trading-partners`
  })
  delete data['expand-index'];
  delete data['masterid-index'];
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

  await Promise.map(keys, async tp => {
    let docs = await con.get({
      path: `/bookmarks/trellisfw/trading-partners/${tp}/shared/trellisfw/documents`
    })
    let dkeys = Object.keys(docs).filter(key => key.charAt(0) !== '_')
    totalCount+= dkeys.length;
    
    let cois = await con.get({
      path: `/bookmarks/trellisfw/trading-partners/${tp}/shared/trellisfw/documents`
    })
    let ckeys = Object.keys(cois).filter(key => key.charAt(0) !== '_')
    cois+= ckeys.length;
  })
  console.log('counts', {totalCount, cois});
}

/*
async function traceCois() {
  let objs = {
    a: [],
    b: [],
    c: [],
    d: [],
    e: [],
    f: [],
  };
  let obj = {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0
  }
  let queue = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue`
  }).then(r => r.data);
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

  let stuff = await Promise.each(keys, async bid => {
    let docs = await axios({
      method: 'get',
      url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents`,
      headers: {
        Authorization: `Bearer ${TOKEN}`
      },
    }).then(r => r.data)
    .catch(err => {
      return
    })
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    await Promise.each(k, async key => {
      let doc = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
      })
      if (doc.status !== 200) return
      doc = doc.data;

      if (pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`)) {
        if (doc['food-logiq-mirror'].shareSource.type.name === 'Certificate of Insurance') {
          obj.a++;
          objs.a.push({
            bid,
            key
          });
          //console.log('Found FL coi',`/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`);
        } else return
      } else return

      let meta = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
      })
      if (meta.status !== 200) return
      meta = meta.data;

      if (pointer.has(meta, '/vdoc/pdf')) {
        let vdoc = Object.keys(meta.vdoc.pdf)[0]
        let ref = meta.vdoc.pdf[vdoc]._id;
        //console.log('Found pdf', {bid, key, ref});
        obj.b++;
        objs.b.push({
          bid,
          key
        });

        let tpdoc = await axios({
          method: 'get',
          headers: {
            Authorization: `Bearer ${TOKEN}`
          },
          url: `https://${DOMAIN}/${ref}/_meta`
        })
        if (tpdoc.status !== 200) return;
        tpdoc = tpdoc.data

        let job;
        if (pointer.has(tpdoc, `/services/target/jobs`)) {
          job = Object.keys(tpdoc.services.target.jobs)[0];
          //console.log('Found job',{bid, key, job});
          obj.c++;
          objs.c.push({
            bid,
            key
          });
        }
          
        if (pointer.has(tpdoc, `/vdoc/cois`)) {
          let coi = Object.keys(tpdoc.vdoc.cois)[0];
          //console.log('Found coi', {bid, key, coi});
          obj.d++;
          objs.d.push({
            bid,
            key
          });

          if (job && pointer.has(queue, `/jobs//${job}/assessments`)) {
            let ass = Object.keys(pointer.get(queue, `/jobs//${job}/assessments`))[0];
            let assess = pointer.get(queue, `/jobs//${job}/assessments/${ass}`)
            if (assess === false) {
              obj.e++;
              objs.e.push({
                bid,
                key
              });
            }
            if (assess === true) {
              obj.e++;
              objs.e.push({
                bid,
                key
              });
              obj.f++;
              objs.f.push({
                bid,
                key
              });
            }
          }
        } else {
          if (ref) {
        //    console.log(ref);;
          }
        }
      }
    })
  }).catch(err => {
    console.log(err);
    console.log('done (error)', obj);
  }).then(() => {
    console.log('done (then)', obj);
  })
  console.log('OBJS', objs);
  console.log('done', obj);
}
*/

async function findChange(rev) {
  console.log('checking rev', rev);
  let key = "1weDLVHdZUaZfN21fWnNknTGaMq";
  let data = await con.get({
    path: `/bookmarks/services/target/jobs/_meta/_changes/${rev}`,
  }).then(r => r.data)
  let found;
  await Promise.each(data, async change => {
    if (change.body && change.body[key]) {
      found = change.body[key];
      console.log('FOUND', found, rev)
      return found;
    }
    if (change.type === 'delete') {  console.log('goodrefs', Object.keys(goodRefs).length);                        

        console.log(change);
    }
  })

  if (!found) {
    rev++;
    await findChange(rev)
  }
}
async function listCois() {
  let cois = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue/scripted`
  }).then(r => r.data);
 
  let keys = Object.keys(cois || {}).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async key => {
    let item = cois[key];
    await Promise.map(item.coiDocuments, async docId => {
      console.log(item.businessid, docId);
    })
  })

}

async function postPdfs() {

  let dir = fs.opendirSync('./pdfs');

  for await (const f of dir) {
    let data = fs.readFileSync(`./pdfs/${f.name}`)

    /*
    let _id = await axios({
      method: 'post',
      url: `https://localhost:3000/resources`,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/pdf',
        'Content-Disposition': "inline",
      },
      data
    }).then(r => r.headers['content-location'].replace(/^\//, ''))
    */

    let _id = await con.post({
      path: `/resources`,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': "inline",
      },
      data
    }).then(r => r.headers['content-location'].replace(/^\//, ''))

    console.log('id', _id);
    let result = await con.post({
      path: `/resources`,
      data: {
        "config": {
          "type": "pdf",
          "pdf": {
            _id
          },
        }
      }
    }).then(r => r.headers['content-location'].replace(/^\//, ''))
    console.log(result);
      break;

/*
    let key = result.replace(/^resources\//, '');
    await con.put({
      path: `/bookmarks/services/target/jobs/${key}`,
      data: {
        _id: result,
        _rev: 0
      }
    })
    */
  }
}

function pushReportItem(report, item, passFail, reason, remedy, newItems) {
  let id = item['food-logiq-mirror']._id;

  // Determine if the doc was within the past 24 hours
  let docTime = moment(item['food-logiq-mirror'].versionInfo.createdAt);
  let offset = LOCAL ? 8 : 12;
  let yday = moment().subtract(24, 'hours')//.subtract(offset, 'hours');

  let entry = {
    'FL Document Name': item['food-logiq-mirror'].name,
    'Supplier': item['food-logiq-mirror'].shareSource.sourceBusiness.name,
    'Date': docTime.subtract(offset, 'hours').format(),
    'Food Logiq Link': `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${id}`,
    'Trellis Success/Fail': passFail,
    'Fail Reason': reason,
    'Suggested Remedy': remedy
  }
  report.push(entry)
  if (docTime > yday) {
    newItems.push(entry);
  }
}

async function generateReport(bus, docKey) {
  let report = [];
  let newItems = [];
  let obj = {
    a: {
      description: 'Mirror created',
      count: 0,
      items: [],
      a1: {
        description: 'Document approved',
        count: 0,
        items: [],
      },
      a2: {
        description: 'Document rejected',
        count: 0,
        items: [],
      },
      a3: {
        description: 'Other doc statuses',
        count: 0,
        items: [],
      },
      a4: {
        description: 'Document awaiting-review',
        count: 0,
        items: [],
      },
    },
    b1: {
      description: 'Trellis doc created',
      count: 0,
      items: [],
    },
    b2: {
      description: 'FL Document has multiple PDFs attached',
      count: 0,
      items: [],
      remedy: 'Indicate to supplier that they should not be attaching multiple PDFs for, e.g., multiple locations under a single Food LogiQ Document. Trellis can auto-reject these with this note.',
    },
    b3: {
      description: 'Failed to retrieve FL attachments',
      count: 0,
      items: [],
      remedy: 'Manually determine whether the attachments are available. If not, inform the supplier.'
    },
    b4: {
      description: 'Already approved by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b5: {
      description: 'Already rejected by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b6: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    c1: {
      description: 'Job created',
      count: 0,
      items: [],
    },
    c2: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    d1: {
      description: 'Target Success',
      count: 0,
      items: [],
    },
    d2: {
      description: 'Target Failure',
      count: 0,
      items: [],
      d2a: {
        description: 'FL Document requires OCR',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2b: {
        description: 'FL Document has multiple CoIs within the PDF file',
        count: 0,
        items: [],
        remedy: 'Indicate to supplier that the PDF should contain a single CoI per Food LogiQ document. Trellis can auto-reject these with this note.',
      },
      d2c: {
        description: 'FL Document PDF format unrecognized',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2d: {
        description: 'Target Validation failure',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2e: {
        description: 'Other target failure modes',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
      },
    },
    d3: {
      description: 'Other Target Result',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    e1: {
      description: 'COI data extracted',
      count: 0,
      items: [],
    },
    e2: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    f1: {
      description: 'FL Document extracted JSON passes Trellis logic',
      count: 0,
      items: [],
    },
    f2: {
      description: 'FL Document extracted JSON fails Trellis logic',
      count: 0,
      items: [],
      f2a: {
        description: 'FL Document expired',
        count: 0,
        items: [],
        remedy: 'Auto-reject Food LogiQ Document and inform the suppler that the document is expired.',
      },
      f2b: {
        description: 'FL Document expirations do not match',
        count: 0,
        items: [],
        remedy: 'Auto-reject Food LogiQ Document and inform the suppler that the expiration dates do not match between the PDF contents and the date entered into FL.',
      },
    },
    f3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    g1: {
      description: 'FL assessment passes Trellis approval logic',
      count: 0,
      items: [],
    },
    g2: {
      description: 'FL assessment fails Trellis approval logic (not auto-rejected)',
      count: 0,
      items: [],
      remedy: 'Auto-reject the associated Food LogiQ Document and inform the suppler that the policy coverage amounts do not meet Smithfield requirements.',
    },
    g3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    A1: {
      description: 'Assessments mirrored',
      count: 0,
      items: [],
      A1a: {
        description: 'Created by Trellis',
        count: 0,
        items: [],
      },
      A1b: {
        description: 'Created by someone else',
        count: 0,
        items: [],
      },
    },
    B1: {
      description: 'Assessment state is Approved',
      count: 0,
      items: [],
    },
    B2: {
      description: 'Assessment state is Rejected',
      count: 0,
      items: [],
    },
    B3: {
      description: 'Assessment state is Submitted',
      count: 0,
      items: [],
    },
    B4: {
      description: 'Assessment state is In Progress',
      count: 0,
      items: [],
    },
    B5: {
      description: 'Assessment state is Not Started',
      count: 0,
      items: [],
    },
    B6: {
      description: 'Other assessment states',
      count: 0,
      items: [],
    },
  }

  let queue = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue`
  }).then(r => r.data);
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')
  let docApproved;

  if (bus) {
    keys = [bus];
  }

  let stuff = await Promise.map(keys, async bid => {
    let docs = await axios({
      method: 'get',
      url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents`,
      headers: {
        Authorization: `Bearer ${TOKEN}`
      },
    }).then(r => r.data)
    .catch(err => {
      return
    })
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')
    if (bus) {
      k = [docKey];
    }

    await Promise.map(k, async key => {
      let doc = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
      })
      if (doc.status !== 200) return
      doc = doc.data;

      if (pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`)) {
        if (doc['food-logiq-mirror'].shareSource.type.name === 'Certificate of Insurance') {
          obj.a.count++;
          obj.a.items.push({
            bid,
            key
          });
        } else return
      } else return

      if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'approved') {
        docApproved = true;
        obj.a.a1.count++;
        obj.a.a1.items.push({
          bid,
          key
        });
//        if (doc.shareSource.approvalInfo.setBy === userId) {
          //pushReportItem(report, doc, 'Success', '', '')
//        }
      } else if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'rejected') {
        docApproved = false;
        obj.a.a2.count++;
        obj.a.a2.items.push({
          bid,
          key
        });
      } else if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'awaiting-review') {
        obj.a.a4.count++;
        obj.a.a4.items.push({
          bid,
          key
        });
      } else {
        obj.a.a3.count++;
        obj.a.a3.items.push({
          bid,
          key
        });
      }

      //b.
      let result;
      let retries = 0;
      let fail;

      while (!result && retries++ < 5) {
        await Promise.delay(2000);
        result = await axios({
          method: 'get',
          headers: {Authorization: FL_TOKEN},
          url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${key}/attachments`,
        }).catch((err) => {
          if (retries === 5) {
            console.log(err);
            console.log(doc);
            console.log('failed 5 times', bid, key);
            fail = true;
          }
        })
      }
      if (fail === true) {
        obj.b3.count++;
        obj.b3.items.push({
          bid,
          key
        });
        pushReportItem(report, doc, 'Fail', obj.b3.description, obj.b3.remedy, newItems)
        return;
      }

      let meta = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
      })
      if (meta.status !== 200) return
      meta = meta.data;

      if (pointer.has(meta, '/services/fl-sync')) {
        let metadata = pointer.get(meta, `/services/fl-sync`);
        if (metadata.valid === false && metadata.message.includes('Multiple')) {
          obj.b2.count++;
          obj.b2.items.push({
            bid,
            key
          });
          pushReportItem(report, doc, 'Fail', obj.b2.description, obj.b3.remedy, newItems)
          return;
        }
      }
      
      //b.
      let ref;
      if (pointer.has(meta, '/vdoc/pdf')) {
        let vdoc = Object.keys(meta.vdoc.pdf)[0]
        ref = meta.vdoc.pdf[vdoc]._id;
        obj.b1.count++;
        obj.b1.items.push({
          bid,
          key
        });
      } else {
        if (docApproved) {
          obj.b4.count++;
          obj.b4.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b4.description, obj.b4.remedy, newItems)
        } else if (docApproved === false) {
          obj.b5.count++;
          obj.b5.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b5.description, obj.b5.remedy, newItems)
        } else {
          obj.b6.count++;
          obj.b6.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b6.description, obj.b6.remedy, newItems)
        }
        return
      }

      //c.
      let tpdoc = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/${ref}/_meta`
      })
      if (tpdoc.status !== 200) return;
      tpdoc = tpdoc.data

      let job;
      if (pointer.has(tpdoc, `/services/target/jobs`)) {
        job = Object.keys(tpdoc.services.target.jobs)[0];
        obj.c1.count++;
        obj.c1.items.push({
          bid,
          key
        });
      } else {
        obj.c2.count++;
        obj.c2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.c2.description, obj.c2.remedy, newItems)
        return;
      }

      //d.
      //Check validation status
      let jobdata = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/resources/${job}`,
      }).then(r => r.data);

      if (jobdata.status === "success") {
        obj.d1.count++;
        obj.d1.items.push({
          bid,
          key
        });
      } else if (jobdata.status === "failure") {
        obj.d2.count++;
        obj.d2.items.push({
          bid,
          key
        });


        let ev = Object.values(jobdata.updates).every(({information}) => {
          if (information && information.includes('recognized')) {
            obj.d2.d2c.count++;
            obj.d2.d2c.items.push({
              bid,
              key,
              job
            });
            pushReportItem(report, doc, 'Fail', obj.d2.d2c.description, obj.d2.d2c.remedy, newItems)
            return false;
          } else if (information && information.includes('multi-COI')) {
            obj.d2.d2b.count++;
            obj.d2.d2b.items.push({
              bid,
              key,
              job
            });
            pushReportItem(report, doc, 'Fail', obj.d2.d2b.description, obj.d2.d2b.remedy, newItems)
            return false;
          } else if (information && information.includes('OCR')) {
            obj.d2.d2a.count++;
            obj.d2.d2a.items.push({
              bid,
              key,
              job
            })
            pushReportItem(report, doc, 'Fail', obj.d2.d2a.description, obj.d2.d2a.remedy, newItems)
            return false;
          } else if (information && information.includes('Valiadation')) {
            obj.d2.d2d.count++;
            obj.d2.d2d.items.push({
              bid,
              key,
              job
            })
            pushReportItem(report, doc, 'Fail', obj.d2.d2d.description, obj.d2.d2d.remedy, newItems)
            return false;
          } else return true;
        })

        if (ev === true) {
          obj.d2.d2e.count++;
          obj.d2.d2e.items.push({
            bid,
            key,
            job
          })
          pushReportItem(report, doc, 'Fail', obj.d2.d2e.description, obj.d2.d2e.remedy, newItems)
        }
        return;
      } else {
        obj.d3.count++;
        obj.d3.items.push({
          bid,
          key
        });
        pushReportItem(report, doc, 'Fail', obj.d3.description, obj.d3.remedy, newItems)
        return
      }

      //e.
      let coi;
      if (pointer.has(tpdoc, `/vdoc/cois`)) {
        coi = Object.keys(tpdoc.vdoc.cois)[0];
        obj.e1.count++;
        obj.e1.items.push({
          bid,
          key
        });
      } else {
        obj.e2.count++;
        obj.e2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.e2.description, obj.e2.remedy, newItems)
        return;
      }

      //f.
      //Check validation status
      let v = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/resources/${coi}/_meta/services/fl-sync`,
      }).then(r => r.data)
      .catch(err => {})
      if (v === undefined || v.valid === false) {
        obj.f3.count++;
        obj.f3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.f3.description, obj.f3.remedy, newItems)
        return;
      }

      if (v.valid.status === true) {
        obj.f1.count++;
        obj.f1.items.push({
          bid,
          key
        })
      } else if (v.valid.status === false) {
        obj.f2.count++;
        obj.f2.items.push({
          bid,
          key
        })
        if (v.valid.message.includes('expired')) {
          obj.f2.f2a.count++;
          obj.f2.f2a.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.f2.f2a.description, obj.f2.f2a.remedy, newItems)
        } else if (v.valid.message.includes('match')) {
          obj.f2.f2b.count++;
          obj.f2.f2b.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.f2.f2b.description, obj.f2.f2b.remedy, newItems)
        } 
        return
      } else {
        obj.f3.count++;
        obj.f3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.f3.description, obj.f3.remedy, newItems)
        return;
      }

      //g & h.
      let assess = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
      }).then(r => r.data)
      .catch(err => {})
      if (assess === undefined) {
        obj.g3.count++;
        obj.g3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g3.description, obj.g3.remedy, newItems)
        return;
      }
      let {id, approval} = assess;

      if (approval === true) {
        obj.g1.count++;
        obj.g1.items.push({
          bid,
          key
        })
      } else if (approval === false) {
        obj.g2.count++;
        obj.g2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g2.description, obj.g2.remedy, newItems)
        return;
      } else {
        obj.g3.count++;
        obj.g3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g3.description, obj.g3.remedy, newItems)
        return;
      }

      //A.
      if (id) {
        let as = await axios({
          method: 'get',
          url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/assessments/${id}`,
          headers: {
            Authorization: `Bearer ${TOKEN}`
          },
        })
        if (as.status !== 200) return
        as = as.data['food-logiq-mirror'];
        if (pointer.has(as, `/assessmentTemplate/name`)) {
          if (pointer.get(as, `/assessmentTemplate/name`) === ASSESSMENT_TEMPLATE_NAME) {
            obj.A1.count++;
            obj.A1.items.push({
              bid,
              key
            });
          } else return;
        } else return;
        if (as.creation.userId === userId) {
          obj.A1.A1a.count++;
          obj.A1.A1a.items.push({
            bid,
            key
          });
        } else {
          obj.A1.A1b.count++;
          obj.A1.A1b.items.push({
            bid,
            key
          });
        }

        //B.
        if (as.state === 'Approved') {
          obj.B1.count++;
          obj.B1.items.push({
            bid,
            key
          });
        } else if (as.state === 'Rejected') {
          obj.B2.count++;
          obj.B2.items.push({
            bid,
            key
          });
        } else if (as.state === 'Submitted') {
          obj.B3.count++;
          obj.B3.items.push({
            bid,
            key
          });
        } else if (as.state === 'In Progress') {
          obj.B4.count++;
          obj.B4.items.push({
            bid,
            key
          });
        } else if (as.state === 'Not Started') {
          obj.B5.count++;
          obj.B5.items.push({
            bid,
            key
          });
        } else {
          obj.B6.count++;
          obj.B6.items.push({
            bid,
            key,
            state: as.state
          });
        }
        pushReportItem(report, doc, 'Success', '', '', newItems);
      }
    }, {concurrency: 10})
  }, {concurrency: 10}).then(async () => {
    let date = moment().format('YYYY-MM-DD');
    let str = ksuid.randomSync().string;
    await con.put({
      path: `/bookmarks/services/fl-sync/reports/day-index/${date}`,
      data: {
        [str]: obj
      }
    })
    report = csvjson.toCSV(report, {
      delimeter: ",", 
      wrap: false,
      headers: 'key'
    });
    fs.writeFileSync(`${date}-${str}.csv`, report)

//    newItems.unshift(headers);
    newItems = csvjson.toCSV(newItems, {
      delimeter: ",", 
      wrap: false,
      headers: 'key'
    });
    fs.writeFileSync(`${date}-${str}-new.csv`, newItems)
  }).catch(err => {
    console.log(err);
    console.log('done (error)', obj);
  })
}

async function handleReport() {
  let report = await con.get({
    path: curReport,
  }).then(r => r.data);

  let coiAs = {};
  let singles = {
    me: 0,
    others: 0
  }
  let dupls = {
    me: 0,
    others: 0
  };
  await Promise.map(report.A1.items, async ({bid, key}) => {
    let data = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/assessments/${key}`
    }).then(r => r.data)
    .catch(err => {

    })
    if (!data) return;
    let as = data['food-logiq-mirror'];
    if (pointer.has(as, `/assessmentTemplate/name`)) {
      if (pointer.get(as, `/assessmentTemplate/name`) === ASSESSMENT_TEMPLATE_NAME) {
        let u = as.creation.userId === userId;
        if (coiAs[bid]) {
          if (u) {
            dupls.me++
          } else {
            dupls.others++
          }
          let t = moment(as.lastUpdate.time);
          let tim = moment(coiAs[bid].time);
          if (u) {
            if (t.isBefore(tim)) {
              /*
              let a = await axios({
                method: 'delete',
                headers: {Authorization: FL_TOKEN},
                url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${key}`,
              }).then(r => {
                console.log('a fl success', bid, key)
              }).catch(err => {
                console.log('err delete1', bid, key)
                console.log(err);
              })
              await axios({
                method: 'delete',
                headers: {Authorization: 'Bearer '+TOKEN},
                url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/assessments/${key}`
              }).then(r => {
                console.log('a trellis success', bid, key)
              }).catch(err => {
                console.log('err trellis delete1', bid, key)
                console.log(err);
              })
              */
            } else {
              /*
              await axios({
                method: 'delete',
                headers: {Authorization: FL_TOKEN},
                url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment/${coiAs[bid].key}`,
              }).then(r => {
                console.log('b fl success', coiAs[bid])
              }).catch(err => {
                console.log(err);
                console.log('err delete2', coiAs[bid])
              })
              await axios({
                method: 'delete',
                headers: {Authorization: 'Bearer '+TOKEN},
                url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/assessments/${coiAs[bid].key}`
              }).then(r => {
                console.log('b trellis success', key)
              }).catch(err => {
                console.log('err trellis delete2', coiAs[bid])
                console.log(err);
              })
              */

              coiAs[bid] = {bid, key, time: as.lastUpdate.time}
            }
          }
        } else {
          coiAs[bid] = {bid, key, time: as.lastUpdate.time}
        }
      }
    }
  })

  /*
  let fail = 0;
  let success = 0;
  let coiBs = {};
  await Promise.map(report.B3.items, async ({bid, key}) => {
    let data = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/assessments/${key}`
    }).then(r => r.data);
    let as = data['food-logiq-mirror'];
    if (pointer.has(as, `/assessmentTemplate/name`)) {
      if (pointer.get(as, `/assessmentTemplate/name`) === ASSESSMENT_TEMPLATE_NAME) {
        let failed = await flSync.checkAssessment(as)
        if (failed) {
          fail++;
        } else success++;
        coiBs[bid] = {bid, key, failed}
      }
    }
  })
  */
  console.log(Object.keys(coiAs).length, {singles, dupls});
  //console.log({fail, success})
}

async function linkAssessments() {

  let pairs = [
    {
      bid: "56c21b30c07c2d0001000117",
      doc: "6123ac5addcaab000e7d08d8",
      as: "613828fecb4c4d000e7167c8",
      other: 'delete'
    }, {
      bid: "56c21b5450743a00010000b8",
      doc: "60c7907f5bc57f000ee7fcfd",
      as: "613834c94c31ba000f2f0c9a"
      //other: 'delete'
    }, {
      bid: "55db1dd3abc8920001000105",
      doc: "60e5e66fa49a43000e6eede9",
      as: "61382a6b0edcab000f5d81f2",
      other: 'delete'
    }, {
      bid: "60d21b339c09d3000f6e09e3",
      doc: "60f7357beb25c0000e420d8e",
      as: "613a8232cb4c4d000e8b7953",
      other: 'delete'
    }, {
      bid: "60d1ff9daeb961000ea580c2",
      doc: "60edfcc678bfbb000e743d12",
      as: "613a33290edcab000ef9db76",
      other: 'delete'
    }, {
    // The next two are the same company???
      bid: "60d1ffc7aeb961000ea580d1",
      doc: "60f57b8ca49a43000ee99200",
      as: "613a8b2a0edcab000ef9fba7"
//      other: 'delete',
    }, {
      bid: "60d1fdb09c09d3000f6dfeab",
      doc: "60d9f7b9eb25c0000e1dd497",
      as: "613a32ebf7b9b2000fe63f91",
    },/* {
      bid: "60d1fa0beb25c0000e1c5460",
      doc: "60d1fe7778bfbb000e312820",
      link: false,
      as: undefined,
      other: 'delete'
    }, {
      bid: "60d1fa56aeb961000ea57d89",
      doc: "6123a01baa22e6000fcc175a",
      link: false,
      as: undefined,
      other: 'delete'
    }, */{
      // Not linked, not created by us; enter into the system
      bid: "60d1f216aeb961000ea57ae4",
      doc: "60d24095eb25c0000e1c70f2",
      as: "613f8417f7b9b2000e94fb00",
      link: false,
    }, {
      // wierd one; two identical FL docs with same pdf; one assessment
      // just pick one and associate it
      // really, two assessments should be created; one for each doc
      bid: "60d1ead49c09d3000f6df7b7",
      doc: "60da1a0f9c09d3000f7a2ee2",
      as: "60d2031eeb25c0000e1c57bf",
      link: false
    }, {
      bid: "60d1e2ada49a43000ec30496",
      doc: "612e4276f7b9b2000fe38462",
      as: "613a85dfcb4c4d000e8b7b2a",
      other: 'delete',
    }, {
      bid: "60d10a8078bfbb000e3105d7",
      doc: "611a48524acc26000e4da26b",
      as: "613a300b4c31ba000f2fa74e",
      other: 'delete'
    }, {
      bid: "60d0fa82a49a43000ec2e841",
      doc: "60f09015293a76000e11c13f",
      as: "613a2f600a2537000eeca1aa",
    }, {
      bid: "60d0f75978bfbb000e30ff15",
      doc: "60db631d9c09d3000f7a69d0",
      as: "613bba850edcab000efa5189"
    }, {
      bid: "60d0f1c1eb25c0000e1c2a79",
      doc: "60e61427eb25c0000ee43ae4",
      as: "613a89d00a2537000eecc430"
    }, {
      bid: "60d0f14e78bfbb000e30fc76",
      doc: "612e3271cb4c4d000f5c9f82",
      as: "613a85c0f7b9b2000fe65e6c"
    }, {
      bid: "60ba206b033190000e4b4ae3",
      doc: "60ca1dfaaeb961000e3a8285",
      as: "613a2e514c31ba000f2fa6b6"
    }, {
      bid: "60ba5721033190000e4b60cb",
      doc: "60f9d2faeb25c0000e4293d1",
      as: "613a326f0a2537000eeca29c"
    }, {
      bid: "60ba1d7395c48d000e28bf88",
      doc: "60c11c5f685b46000e5e6ca2",
      as: "613a2dd4cb4c4d000e8b5961",
    }, {
      bid: "5c9a6e7d991c010001ca464f",
      doc: "60e61f65eb25c0000ee43d43",
      as: "60eefc1578bfbb000e747515",
      link: false
    }, {
      bid: "5cf98221b58cd50001dd083f",
      doc: "611ec4860395ed000e3ed1f1",
      as: "613839ec0edcab000f5d8290",
    }, {
      bid: "5cb67bb2499dcf0001a1e811",
      doc: "60f0a70fa49a43000e70dede",
      as: "613839cdcb4c4d000e716856",
    }, {
      bid: "5adcf497411bf70001ea28c8",
      doc: "6138b6fd0a2537000eec186e",
      as: "6138b70a0a2537000eec1876",
    }, {
      bid: "585031c1f033a20001622244",
      doc: "612ce3d8aa22e6000f39f39d",
      as: "6138382af7b9b2000fe59733",
    }
  ]

  await Promise.map(pairs, async ({bid, doc, as, link}) => {
    console.log({bid, doc, as, link})
    let assess = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/assessments/${as}`,
    }).then(r => r.data['food-logiq-mirror'])
    
    let approval = !(await flSync.checkAssessment(assess));
    if (link === false) {
      let name = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${doc}`,
      }).then(r => r.data['food-logiq-mirror'].name)

      console.log(name, JSON.stringify({
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/links/assessment/${as}`,
        data: [{
          "businessId": CO_ID,
          "from": {
            "_id": as,
            "type": "assessment"
          },
          "linkType": "SOURCES",
          "linkTypeDisplay": "Sources",
          "to": {
            "_id": doc,
            name,
            "type": "document"
          }
        }]
      }))

      await axios({
        method: 'post',
        headers: {Authorization: FL_TOKEN},
        url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/links/assessment/${as}`,
        data: [{
          "businessId": CO_ID,
          "from": {
            "_id": as,
            "type": "assessment"
          },
          "linkType": "SOURCES",
          "linkTypeDisplay": "Sources",
          "to": {
            "_id": doc,
            name,
            "type": "document"
          }
        }]
      })
    }

    if (approval !== undefined) {
      console.log({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${doc}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        id: as,
        approval
      })
      await con.put({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${doc}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
        data: {
          id: as,
          approval
        }
      })
    }
  })
}

async function associateAssessments() {
  let index = {};
  let report = await con.get({
    path: curReport,
  }).then(r => r.data);

  await Promise.map(report.A1.items, async ({bid, key}) => {
    let data = await con.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}/assessments/${key}`
    }).then(r => r.data)
    .catch(err => {})
    if (!data) return;
    let as = data['food-logiq-mirror'];
    if (pointer.has(as, `/assessmentTemplate/name`)) {
      if (pointer.get(as, `/assessmentTemplate/name`) === ASSESSMENT_TEMPLATE_NAME) {
        index[bid] = index[bid] || {bid, assessments: [], docs: []}
        let u = as.creation.userId === userId;
        let approval;
        try {
          approval = !(await flSync.checkAssessment(as));
        } catch(err) {}
        index[bid].assessments[key] = {key, approval, state: as.state, userId: u}
        
        let docs = await con.get({
          path: `/bookmarks/services/fl-sync/businesses/${bid}/documents`
        }).then(r => r.data)
        .catch(err => {})
        if (!docs) return;
        let keys = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')
        
        await Promise.map(keys, async k => {
          let doc = await con.get({
            path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${k}`
          }).then(r => r.data)

          if (pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`)) {
            let type = pointer.get(doc, `/food-logiq-mirror/shareSource/type/name`)
            if (type === 'Certificate of Insurance') {
              index[bid].docs[k] = {key: k}
            }
          }
        })
      }
    }
  })

  let results = {
    multiDocs: 0,
    multiAssessments: 0,
    bothOne: 0,
    zeroAs: 0,
    zeroDocs: 0,
  }
  let res = {
    assessments: {},
    docs: {}
  }
  let out = {};
  await Promise.map(Object.values(index), async ({bid, assessments, docs}) => {
    let as = Object.keys(assessments);
    let ds = Object.keys(docs);
    if (as.length === 1 && ds.length === 1) {
      results.bothOne++;
      let approval = assessments[as[0]].approval;
      if (approval !== undefined) {
        await con.put({
          path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${ds[0]}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          data: {
            id: as[0],
            approval
          }
        })
      }
    } else {
      console.log(bid, assessments, docs)
      out[bid] ={bid, assessments, docs}
    }
    let val = as.length.toString();
    res.assessments[val] = res.assessments[val] || 0;
    res.assessments[val]++;

    val = ds.length.toString();
    res.docs[val] = res.docs[val] || 0;
    res.docs[val]++;

    if (as.length > 1) {
      results.multiAssessments++;
    } else if (as.length < 1) {
      results.zeroAs++;
    }

    if (ds.length > 1) {
      results.multiDocs++;
    } else if (ds.length < 1) {
      results.zeroDocs++
    }
    
  })
//  console.log(index);
  console.log(results);
  console.log(res);
  fs.writeFileSync('assessOutput.json', JSON.stringify(out))
}


async function reprocessReport() {
  let report = await con.get({
    path: curReport,
  }).then(r => r.data);

  let paths = [
    //'c2',
    'b3',
    //'d2/d2c',
    //'f3',
    //'g3',
    //'B3'
  ]

  await Promise.each(paths, async (path) => {
    console.log('Handling report items for', path);
    await Promise.each(pointer.get(report, `/${path}/items`), async ({bid, key}) => {
      console.log(`reprocessing /bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`)
      let data = await con.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`
      }).then(r => r.data);
      
      await con.put({
        path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
        data: {
          'food-logiq-mirror': data['food-logiq-mirror']
        }
      })

      await Promise.delay(20000);
    })
  })
}

async function stageAsns() {
  let tok = process.env.CPROD_TOKEN;
  let cpcon = await oada.connect({
    domain: 'https://live.trellis.one',
    token: 'Bearer '+tok,
  })

  let thing = await cpcon.get({
    path: `/bookmarks/services/target/jobs`
  }).then(r => r.data);
  
  let keys = Object.keys(thing).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async key => {
    let job = await cpcon.get({
      path: `/bookmarks/services/target/jobs/${key}`
    }).then(r => r.data)

    let asn = await cpcon.get({
      path: `/bookmarks/services/target/jobs/${key}/config/asn`
    }).then(r => r.data)
    
    let {_type} = asn;
    let ks = Object.keys(asn).filter(key => key.charAt(0) !== '_')
    let data = { _type }
    await Promise.each(ks, k => {
      data[k] = asn[k];      
    })

    console.log('posting to path:', `/bookmarks/trellisfw/asn-staging`);
    console.log('putting data: ', data);
    let res = await con.post({
      path: `/bookmarks/trellisfw/asn-staging`,
      data
    })
  })
}

async function recursiveTreeWalk(path, subTree, data) {
  console.log('processing', path);
  // If either subTree or data does not exist, there's mismatch between
  // the provided tree and the actual data stored on the server
  if (!subTree || !data) {
    console.log('path mismatch');
    throw new Error("Path mismatch.");
  }

  // if the object is a link to another resource (i.e., contains "_type"),
  // then perform GET
  if (subTree["_type"]) {
    try {
      data = (await axios({
        method: 'get',
        url: `https://${DOMAIN}`+path,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      })).data || {};
      //con.get({ path })).data || {};
    } catch(err) {
      console.log(path, 'failed');
      console.log(err);
      data = {};
    }
  }

  // TODO: should this error?
  if (Buffer.isBuffer(data)) {
    return;
  }

  if (!data._id) {
    console.log('Path isnt a resource here', path, subTree);
    /*
    let _id = await con.post({
      path: `/resources`,
      data,
      contentType: subTree._type
    }).then(r => r.headers['content-location'].replace(/^\//, ''))
    let d = {_id}
    if (subTree["_rev"]) d._rev = 0;
    await con.put({
      path,
      data: d
    })
    */
  }

  // select children to traverse
  const children = [];
  let keys = [];
  // Handle all tree-specified keys
  for (const key of Object.keys(subTree || {})) {
    if (key !== '*' && typeof data[key] === "object") {
      if (key !== "_meta") {
        keys.push(key);
        children.push({ treeKey: key, dataKey: key });
      }
    }
  }

  // If * in the subtree, handle all _remaining_ keys separately
  if (subTree["*"]) {
    // If "*" is specified in the tree provided by the user,
    // get all children from the server
    for (const key of Object.keys(data)) {
      if (typeof data[key] === "object" && !keys.includes(key)) {
        if (key !== "_meta") {
          children.push({ treeKey: "*", dataKey: key });
        }
      }
    }
    
  }

  // initiate recursive calls
  return Promise.each(children, async (item) => {
    const childPath = path + "/" + item.dataKey;
    if (data) {
      try {
      const res = await recursiveTreeWalk(
        childPath,
        subTree[item.treeKey],
        data[item.dataKey]
      );
      } catch(err) {
        console.log('ERROR ERROR ERROR');
        console.log(err);
      }
    }
  });
}


async function fixTradingPartners() {
  let buses = (await axios({
    method: 'get',
    url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses`,
    headers: {
      Authorization: `Bearer ${TOKEN}`
    }
  })).data;

  let keys = Object.keys(buses).filter(k => k.charAt(0) !== '_')

  await Promise.each(keys, async (key) => {
    let bus = (await axios({
      method: 'get',
      url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${key}`,
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    })).data;
    console.log(key, bus.masterid);

    if (bus.masterid) {
      try {
        let tp = (await axios({
          method: 'get',
          url: `https://${DOMAIN}/bookmarks/trellisfw/trading-partners/${key}`,
          headers: {
            Authorization: `Bearer ${TOKEN}`
          }
        })).data;
        console.log('put', bus.masterid)

        await axios({
          method: 'put',
          url: `https://${DOMAIN}/bookmarks/trellisfw/trading-partners/${key}`,
          headers: {
            Authorization: `Bearer ${TOKEN}`
          },
          data: { masterid: bus.masterid}
        });

      } catch(err) {
        
      }
    }
  })
}

async function findFlDocumentProperties() {
  let docTypes = {};
  let docText = '';

  let buses = (await con.get({
    path: `${SERVICE_PATH}/businesses`
  })).data;
  let keys = Object.keys(buses).filter(key => key.charAt(0) !== '_')

  await Promise.each(keys, async bid => {
    let docs = await axios({
      method: 'get',
      url: `https://${DOMAIN}${SERVICE_PATH}/businesses/${bid}/documents`,
      headers: {
        Authorization: `Bearer ${TOKEN}`
      },
    }).then(r => r.data)
    .catch(err => {
    })

    if (!docs) console.log('error 1');
    if (!docs) return

    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    await Promise.each(k, async docid => {
      let doc = await con.get({
        path: `${SERVICE_PATH}/businesses/${bid}/documents/${docid}`
      }).then(r => r.data)
      .catch(err => {
        console.log('error 2');
      })
      
      let docType = pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`) ? doc['food-logiq-mirror'].shareSource.type.name : undefined;
      
      if (docType && !docTypes[docType]) {
        // Go fetch the FL info about this document type
        docTypes[docType] = true;
        let filterKeys = ['ExpirationEmailSentAt', '_id', 'archivedInCommunity', 'attachments', 'auditAttributes', 'business', 'contentType', 'isArchived', 'links', 'shareRecipients', 'shareSource', 'tags', 'versionInfo', 'originalName'];
        let docKeys = Object.keys(doc['food-logiq-mirror']).filter(key => !filterKeys.includes(key))
        let customKeys = pointer.has(doc, `/food-logiq-mirror/shareSource/shareSpecificAttributes`) ? Object.keys(pointer.get(doc, `/food-logiq-mirror/shareSource/shareSpecificAttributes`)) : undefined;
        let allKeys = docKeys.concat(customKeys)
        docTypes[docType] = allKeys;
        console.log('-----')
        let dt = Object.keys(docTypes).map(dkey => {
          let txt = dkey+'\r\n\t'+(docTypes[dkey].join('\r\n\t'))
          return txt
        }).join('\r\n')
        console.log(dt);
      }
    })
  })
}

async function postTestDocs() {
  console.log('running');
  let testDocs = {
    b2: {
      "bid": "60d2184baeb961000ea58b3d",
      "key": "60da118aaeb961000ee24a0e"
    },
    b3: {
      "bid": "6123d741aa22e6000fcc2e32",
      "key": "615db38dfa892f000ff6f6dc"
    },
    b4: {
      "bid": "60d1e42baeb961000ea575ae",
      "key": "6177bcacc69b88000ea01b5f"
    },
    b5: {
      "bid": "60ba1feaf0ba6a000ec42199",
      "key": "615e3cb69a8b81000fb55a76"
    },
    b6: {
      "bid": "6170375e8f6b1a000ec9f41f",
      "key": "6172c1a6c69b88000e8fa33b"
    },
    c2: {
      "bid": "6123d741aa22e6000fcc2e32",
      "key": "61687d698f6b1a000f356acb"
    },
    /* OCR not supported on dev
    d2a: {
      "bid": "60d1e5a778bfbb000e311f15",
      "key": "60da227eaeb961000ee2505a",
      "job": "1zMppguMjDFWBZ55hsNkWJM6tCU"
    },
    */
    d2b: {
      "bid": "60d1fae8a49a43000ec30e56",
      "key": "60d21c44a49a43000ec31c19",
      "job": "1zMqvjKJmV1Ev670PYcgCCpOq6t"
    },
    d2c: {
      "bid": "60d1ff249c09d3000f6dff15",
      "key": "6123e5e2c6480f000ecce926",
      "job": "1zE8HVeZK6n72JN1o20aqzfzdcC"
    },
    d2d: {
      "bid": "60d207bcaeb961000ea5849c",
      "key": "60d9e145a49a43000ec46c41",
      "job": "1zE8V3o3UvxQ6LvUw0Ef8ImOS3u"
    },
    d2e: {
      "bid": "60d202e2a49a43000ec311c9",
      "key": "611d3d8b5949e3000e1e4a7d",
      "job": "1zMr7E6zykhgp3STB6W5PPGVXVv"
    },
    f2: {
      "bid": "60d2061278bfbb000e312b55",
      "key": "612f8513cb4c4d000e6faf01"
    },
    f3: {
      "bid": "60d21c1a9c09d3000f6e0a2d",
      "key": "613228c30a2537000eeaff11"
    },
    g2: {
      "bid": "55db1dd3abc8920001000105",
      "key": "60e5e66fa49a43000e6eede9"
    },
    g3: {
      "bid": "60d1e10d78bfbb000e311d4f",
      "key": "6123e664002f06000e01b9e4"
    },
  };
  let keys = [
    '_id',
    'business',
    'originalName',
    'isArchived',
    'shareSource',
    'versionInfo',
    'tags',
    'links',
    'auditAttributes',
    'ExpirationEmailSentAt',
    'archivedInCommunity'
  ]
  await Promise.each(Object.keys(testDocs), async (caseType) => {
    let obj = testDocs[caseType];
    let doc = await axios({
      method: 'get',
      headers,
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${obj.key}`
    }).then(r => r.data)
    .catch(err => {
      return
    })
    if (!doc) return

    doc.shareRecipients = shareRecipients;
    doc.shareRecipients[0].shareSpecificAttributes = doc.shareSource.shareSpecificAttributes;
    Object.keys(doc).forEach((key) => {
      if (keys.includes(key)) {
        delete doc[key]
      }
    })
    console.log('Doc', JSON.stringify(doc));
    let result = await axios({
      method: 'post',
      headers,
      url: `https://sandbox-api.foodlogiq.com/v2/businesses/612fd011ba2bb8000e1101bc/documents`,
      data: doc
    }).catch(err => {
      console.log(err);
    })
    console.log(result);
  })
}

async function main() {
  con = await oada.connect({
    domain: 'https://'+DOMAIN,
    token: 'Bearer '+TOKEN,
  }).catch(err => {
    console.log(err);
    throw err
  })

  try {

    let start = Date.now()
//    await postPdfs();
//    await cleanupProcessQueue();
//    await findTrellisDocs()
//    await reprocessProd();
//    await countCois();
//    await handleIncompleteCois();
//    await traceCois();
//    await associateAssessments();
//    await linkAssessments();
//    await generateReport();
    await postTestDocs();
//    await recursiveTreeWalk('/bookmarks', tree.bookmarks, {})
//    await fixTradingPartners()
//      await findFlDocumentProperties()
//    await stageAsns();
//    await handleReport();
//    await reprocessReport();
//    await listCois();
//  await findChange(493126);
//  await deleteFlBizDocs();
// await deleteTargetJobs()

//  let TP = await makeFakeContent();
//    let TP = await makeFlBusiness();
//  await compareResult();
//  await checkResult();
//    await getTPListLibCount();

//    await skipTPDocs()

  //Reset the environment for testing business setup
//  await deleteFlSync();
  //await deleteBusinesses()
//  await deleteTradingPartners();

  //Delete JUST the docs within the current businesses
//    await deleteBusinessDocs()

  //Run this when all testing is done to clean up FL
  //await deleteFlBusinesses();
    let end = Date.now() - start;
    console.log('Time ran: ', end/1000/60, '(min)')
  } catch(err) {
    console.log('main', err)
  }

  console.log('DONE');
  process.exit();
}

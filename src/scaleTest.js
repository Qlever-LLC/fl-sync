import chai from "chai";
import fs from 'fs';
import chaiAsPromised from "chai-as-promised";
import Promise from "bluebird";
import moment from "moment";
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
const DOMAIN = config.get('trellis.domain');
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMM_ID = config.get('foodlogiq.community.id');
const SUPPLIER = '60a70d7eb22bd7000e45af14';
const tree = require('./tree.js');
const dummy = require('./dummyData.js');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

let TPs;
let con;
let TP_QUANTITY = 1000;
let COI_QUANTITY = 2;
let NONCOI_QUANTITY = 40;

let headers = {
  "Authorization": `${FL_TOKEN}`,
  "Content-type": "application/json"
};

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

async function findChange(rev) {
  console.log('checking rev', rev);
  let key = "1weDLVHdZUaZfN21fWnNknTGaMq";
  let data = await con.get({
    path: `/bookmarks/services/target/jobs/_meta/_changes/${rev}`,
  }).then(r => r.data)
  let found;
  await Promise.map(data, async change => {
    if (change.body && change.body[key]) {
      found = change.body[key];
      console.log('FOUND', found, rev)
      return found;
    }
    if (change.type === 'delete') {
        console.log(change);
    }
  })

  if (!found) {
    rev++;
    await findChange(rev)
  }
}

async function main() {
  con = await oada.connect({
    domain: 'https://'+DOMAIN,
    token: 'Bearer '+TOKEN[0],
    connection: 'ws'
  }).catch(err => {
    console.log(err);
    throw err
  })

  try {

  let start = Date.now()
//  await findChange(493126);
//  await deleteFlBizDocs();
// await deleteTargetJobs()

//  let TP = await makeFakeContent();
    let TP = await makeFlBusiness();
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

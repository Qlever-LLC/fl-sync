import chai from "chai";
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

async function traceCois() {
  let obj = {
    a: 0,
    b: 0,
    c: 0,
    d: 0
  }
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')

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

        let tpdoc = await axios({
          method: 'get',
          headers: {
            Authorization: `Bearer ${TOKEN}`
          },
          url: `https://${DOMAIN}/${ref}/_meta`
        })
        if (tpdoc.status !== 200) return;
        tpdoc = tpdoc.data

        if (pointer.has(tpdoc, `/services/target/jobs`)) {
          let job = Object.keys(tpdoc.services.target.jobs)[0];
          //console.log('Found job',{bid, key, job});
          obj.c++;
        }
          
        if (pointer.has(tpdoc, `/vdoc/cois`)) {
          let coi = Object.keys(tpdoc.vdoc.cois)[0];
          //console.log('Found coi', {bid, key, coi});
          obj.d++;
        } else {
          if (ref) {
            console.log(ref);;
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
  console.log('done', obj);
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
    console.log(_id);

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

    let key = result.replace(/^resources\//, '');
    await con.put({
      path: `/bookmarks/services/target/jobs/${key}`,
      data: {
        _id: result,
        _rev: 0
      }
    })
  }
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
    await traceCois();
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

/**
 * @license
 *  Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Load config first so it can set up env
if (process.env.LOCAL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { Service } from '@oada/jobs';
import esmain from 'es-main';

import axios, {AxiosRequestConfig} from 'axios';
//import ksuid from 'ksuid';
import debug from 'debug';
import Promise from 'bluebird';
import moment, {Moment} from 'moment';
import _ from 'lodash';
import { Change, JsonObject, connect, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client'
import config from './config.js';
import {ListWatch} from '@oada/list-lib';
import tree from './tree.js';
import poll from '@oada/poll';
import type {TreeKey} from '@oada/list-lib/dist/tree.js';
//let reports = require('./reports.js');
//let genReport = require('./generateReport.js');
import { FlObject, onTargetChange, getLookup, handleAssessmentJob, handleDocumentJob, startJobCreator } from './mirrorWatch.js';
import { watchTrellisFLBusinesses } from './masterData.js';

const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const JUST_TPS = config.get('trellis.justTps');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const CONCURRENCY = config.get('trellis.concurrency');
//const HANDLE_INCOMPLETE_INTERVAL = config.get('trellis.handleIncompleteInterval');
//const REPORT_INTERVAL = config.get('trellis.handleIncompleteInterval');
const INTERVAL_MS = config.get('foodlogiq.interval') * 1000; //FL polling interval
let SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
let SERVICE_NAME = config.get('service.name') as unknown as TreeKey;

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

let AUTO_APPROVE_ASSESSMENTS: boolean;
let TOKEN;

let CONNECTION: OADAClient;
//let SOMEGLOBALCOUNT = 0;

async function handleConfigChanges(changes: AsyncIterable<Readonly<Change>>) {
  for await (const change of changes) {
    try {
      if (_.has(change.body, 'autoapprove-assessments')) {
        setAutoApprove(change.body['autoapprove-assessments'] ? true : false);
      }
    } catch (err) {
      error('mirror watchCallback error');
      error(err);
    }
  }
}

/**
 * watches FL config
 */
  // @ts-ignore
export async function watchFlSyncConfig() {
  let data = await CONNECTION.get({
    path: `${SERVICE_PATH}`,
  }).then(r => r.data as JsonObject)
  .catch(async (err: any) => {
    if (err.status === 404) {
      await CONNECTION.put({
        path: `${SERVICE_PATH}`,
        data: {},
        tree
      })
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses`,
        data: {},
        tree
      })
      return {} as JsonObject;
    } else throw err;
  })
  if (typeof data === 'object' && !Array.isArray(data) && !Buffer.isBuffer(data)) {
    setAutoApprove(data['autoapprove-assessments'] ? true : false);
  }

  let { changes } = await CONNECTION.watch({
    path: `${SERVICE_PATH}`,
    type: 'single'
  })

  handleConfigChanges(changes)
  info(`Watching ${SERVICE_PATH} for changes to the config`);
}//watchFlSyncConfig

/**
 * watches target jobs
 */
// @ts-ignore
async function watchTargetJobs() {
  info(`Started ListWatch on target jobs...`)
  // @ts-ignore
  const watch = new ListWatch({
    path: `/bookmarks/services/target/jobs/pending`,
    name: `target-jobs-fl-sync`,
    conn: CONNECTION,
    resume: true,
    onAddItem: getLookup,
    //@ts-ignore
    onChangeItem: onTargetChange
  })
}//watchTargetJobs


export async function handleItem(type: string, item: FlObject) {
  let bid;
  try {
    let sync;
    if (type === 'assessments') {
      bid = _.has(item, 'performedOnBusiness._id') ? item.performedOnBusiness._id : undefined;
    } else {
      bid = _.has(item, 'shareSource.sourceBusiness._id') ? item.shareSource.sourceBusiness._id : undefined
    }

    if (!bid) {
      error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
      return true;
    }

    //REMOVE THIS LATER >>>>>>>>>>>>>>>>>>>>>>>>>
    /*
    if (_.has(item, 'shareSource.type.name') && item.shareSource.type.name === "Certificate of Insurance") {
      console.log("Continuing on COI document", item._id, bid)
    } else {
      console.log("Skipping non COI document", item._id, bid)
      return true;
    }
    */
    //REMOVE THIS LATER <<<<<<<<<<<<<<<<<<<<<<<<<

    let path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
    try {
      let resp = await CONNECTION.get({ path }).then(r => r.data as JsonObject)

      // Check for changes to the resources
      let equals = _.isEqual(resp['food-logiq-mirror'], item)
      if (!equals) {
        info(`Document difference in FL doc [${item._id}] detected. Syncing...`);
        sync = true;
      }
      //TODO: REMOVE LATER
      sync = true;
    } catch (err: any) {
      if (err.status !== 404) throw err;
      info(`Resource is not already on trellis. Syncing...`);
      sync = true;
    }

    // Now, sync
    if (sync) {
      //delay += 500;
      // This tree put, when run on startup or other cases where we are going
      // through pages of data, causes if-match issues. The promise.map closure
      // this falls within was changed to .each for the time-being
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`,
        data: {'food-logiq-mirror': item } as unknown as Body,
        tree
      })
      console.log('awaiting delay for item', item._id)
      await Promise.delay(30000);
      console.log('done awaiting delay for item', item._id)
      info(`Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`);
    }
    return true;
  } catch(err) {
    //TODO: Need to add this to some sort of retry
    error(`fetchCommunityResources errored on item ${item._id} bid ${bid}. Moving on`)
    error(err);
    return false;
  }
}

/**
 * fetches community resources
 * @param {*} param0 pageIndex, type, date
 */
export async function fetchCommunityResources({ type, date, pageIndex=undefined }: {type: string, date: string, pageIndex?: number}) {
  pageIndex = pageIndex || 0;
  let url = type === 'assessments' ? `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment?lastUpdateAt=${date}..`
    : `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?sourceCommunities=${COMMUNITY_ID}&versionUpdated=${date}..`;
    let request: AxiosRequestConfig = {
    method: `get`,
    url,
    headers: { 'Authorization': FL_TOKEN },
  }
  // @ts-ignore
  if (pageIndex) request.params = { pageIndex };
  let response = await axios(request);
  let delay = 0;

  // Manually check for changes; Only update the resource if it has changed!
  await Promise.each(response.data.pageItems, async (item: FlObject) => {
    let retries = 5;
    //@ts-ignore
    let success = false;
    while (retries-- > 0 && !(success = await handleItem(type, item))) {}
    /*
    let bid;
    try {
      let sync;
      if (type === 'assessments') {
        bid = _.has(item, 'performedOnBusiness._id') ? item.performedOnBusiness._id : undefined;
      } else {
        bid = _.has(item, 'shareSource.sourceBusiness._id') ? item.shareSource.sourceBusiness._id : undefined
      }

      if (!bid) {
        error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
        return;
      }

      //REMOVE THIS LATER >>>>>>>>>>>>>>>>>>>>>>>>>
      if (_.has(item, 'shareSource.type.name') && item.shareSource.type.name === "Certificate of Insurance") {
        SOMEGLOBALCOUNT++;
        console.log("Continuing on COI document", item._id, bid, SOMEGLOBALCOUNT)
      } else {
        console.log("Skipping non COI document", item._id, bid)
        return;
      }
      //REMOVE THIS LATER <<<<<<<<<<<<<<<<<<<<<<<<<

      let path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
      try {
        let resp = await CONNECTION.get({ path }).then(r => r.data as JsonObject)

        // Check for changes to the resources
        let equals = _.isEqual(resp['food-logiq-mirror'], item)
        if (!equals) {
          info(`Document difference in FL doc [${item._id}] detected. Syncing...`);
          sync = true;
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
        info(`Resource is not already on trellis. Syncing...`);
        sync = true;
      }
      */

      // Create a new resource if necessary and link to it
      // Doing a tree-put manually-ish
      // 5-20-2022 - no longer needed due to fixed tree put
      /*if (!_id) {
        _id = `resources/${ksuid.randomSync().string}`;
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${bid}/${type}`,
          data: {
            [item._id]: {
              _id,
              "_rev": 0
            }
          },
          tree,
        }).catch((err) => {
        })
        }
      */

     /*
      // Now, sync
      if (sync) {
        delay += 500;
        // This tree put, when run on startup or other cases where we are going
        // through pages of data, causes if-match issues. The promise.map closure
        // this falls within was changed to .each for the time-being
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`,
          data: {'food-logiq-mirror': item } as unknown as Body,
          tree
        })
        info(`Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`);
      }
    } catch(err) {
      //TODO: Need to add this to some sort of retry
      error(`fetchCommunityResources errored on item ${item._id} bid ${bid}. Moving on`)
      }
    */
  })//, { concurrency: CONCURRENCY })
  .catch(err => {
    console.log("SOMETHING DID HAPPEN HERE");
    console.log(err);
    throw err;
  })
  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(`Finished page ${pageIndex}. Item ${response.data.pageItemCount * (pageIndex + 1)}/${response.data.totalItemCount}`);
    if (type === 'documents') info(`Pausing for ${delay / 60000} minutes`)
    if (type === 'documents') await Promise.delay(delay)
    await fetchCommunityResources({ type, date, pageIndex: pageIndex + 1 })
  }
}

/**
 * gets resources
 */
async function getResources(lastPoll: Moment) {
  //Format date
  let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()

  // Get pending resources
  await Promise.each(['products', 'locations', 'documents'], async (type) => {
    trace(`Fetching community ${type}`);
    await fetchCommunityResources({ type, date, pageIndex: undefined })
  })
  // Now get assessments (slightly different syntax)
  trace(`Fetching community assessments`);
  await fetchCommunityResources({ type: 'assessments', date, pageIndex:undefined })
}

/**
 * The callback to be used in the poller. Gets lastPoll date
 */
export async function pollFl(lastPoll: Moment) {
  try {
    // Sync list of suppliers
    let date = (lastPoll || moment("20150101", "YYYYMMDD")).utc().format()
    trace(`Fetching FL community members with date: [${date}]`)

    await fetchAndSync({
      from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/memberships?createdAt=${date}..`,
      to: (i: {business: {_id: string}}) => `${SERVICE_PATH}/businesses/${i.business._id}`,
      forEach: async (i: {business: {_id: string}}) => {
        // Ensure main endpoints
        await Promise.each(['products', 'locations', 'documents', 'assessments'], async (type) => {
          await CONNECTION.put({
            path: `${SERVICE_PATH}/businesses/${i.business._id}/${type}`,
            data: {} as unknown as Body,
            tree,
          })
          /*
          //TODO: REPLACE ALL OF THIS WITH A TREE PUT
          await CONNECTION.head({
            path: `${SERVICE_PATH}/businesses/${i.business._id}/${type}`,
          }).catch(async err => {
            if (err.status !== 404) throw err;
            let _id = await CONNECTION.post({
              path: `/resources`,
              contentType: tree?.bookmarks?.services?.[SERVICE_NAME]?.businesses?.['*']?._type,
            }).then(r => r?.headers?.['content-location']?.replace(/^\//, ''))

            await CONNECTION.put({
              path: `${SERVICE_PATH}/businesses/${i.business._id}`,
              data: {
                [type]: { _id, _rev: 0 },
              },
              tree,
            })
          })*/
        })
      },
    })
    // Now fetch community resources
    trace(`JUST_TPS set to ${!!JUST_TPS}`)
    if (!JUST_TPS) await getResources(lastPoll);
  } catch (err) {
    throw err;
  }
}//pollFl

/**
 * fetches and synchronizes
 * @param {*} param0
 * @returns
 */
async function fetchAndSync({ from, to, pageIndex=undefined, forEach }: {from:string, to: string | Function, pageIndex?: number, forEach: Function}) {
  pageIndex = pageIndex || 0;
  try {
    let request : AxiosRequestConfig = {
      method: `get`,
      url: from,
      headers: { 'Authorization': FL_TOKEN },
    }
    // @ts-ignore
    if (pageIndex) request.params = { pageIndex };
    let response = await axios(request);

    // Manually check for changes; Only update the resource if it has changed!
    await Promise.map(response.data.pageItems, async (item: FlObject) => {
      let sync;
      if (to) {
        let path = typeof (to) === 'function' ? await to(item) : `${to}/${item._id}`
        try {
          let resp = await CONNECTION.get({ path }).then(r => r.data as JsonObject)

          // Check for changes to the resources
          let equals = _.isEqual(resp['food-logiq-mirror'], item)
          if (equals) info(`No resource difference in FL item [${item._id}]. Skipping...`);
          if (!equals) info(`Resource difference in FL item [${item._id}] detected. Syncing to ${path}`);
          if (!equals) {
            sync = true;
          }
        } catch (err: any) {
          if (err.status === 404) {
            info(`FL Resource ${item._id} is not already on trellis. Syncing...`);
            sync = true;
          } else {
            error(err);
            throw err
          }
        }

        if (sync) {
          /*
          let resp = await CONNECTION.post({
            path: `/resources`,
            contentType: tree?.bookmarks?.services?.[SERVICE_NAME]?.businesses?.['*']?._type,
            data: { 'food-logiq-mirror': item } as unknown as Body
          });
          */
          await CONNECTION.put({
            path,
            data: { 'food-logiq-mirror': item } as unknown as Body,
            tree
            /*
            data: {
              "_id": resp?.headers?.['content-location']?.replace(/^\//, ''),
              "_rev": 0
            }*/
          });
        }
      }
      if (forEach) await forEach(item)
    }, {concurrency: 20});

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      info(`fetchAndSync Finished page ${pageIndex}. Item ${response.data.pageItemCount * (pageIndex + 1)}/${response.data.totalItemCount}`);
      await fetchAndSync({ from, to, pageIndex: pageIndex + 1, forEach })
    }
    return;
  } catch (err: any) {
    info('getBusinesses Error', err.response ? err.response.status : 'Please check error logs');
    console.log(err);
    throw err;
  }
}//fetchAndSync

export function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

function setAutoApprove(value: boolean) {
  info(`Autoapprove value is ${value}`)
  AUTO_APPROVE_ASSESSMENTS = value;
}

export function getAutoApprove() {
  return AUTO_APPROVE_ASSESSMENTS
}

async function getToken() {
  return TRELLIS_TOKEN;
}

export async function initialize({
  polling=false,
  target=false,
  master=false,
  service=false,
  watchConfig=false
}: {
  polling?: boolean,
  target?: boolean,
  master?: boolean,
  service?: boolean,
  watchConfig?: boolean
}) {
  try {
    info(`<<<<<<<<<       Initializing fl-sync service. [v1.2.7]       >>>>>>>>>>`);
    TOKEN = await getToken();
    // Connect to oada
    try {
      var conn = await connect({
        domain: 'https://' + DOMAIN,
        token: TOKEN,
        concurrency: CONCURRENCY,
      })
      setConnection(conn);
    } catch (err) {
      error(`Initializing Trellis connection failed`);
      error(err)
      throw err;
    }

    // Run populateIncomplete first so that the change feeds coming in will have
    // the necessary in-memory items for them to continue being processed.
    //await populateIncomplete()

    if (watchConfig === undefined || watchConfig) {
      await watchFlSyncConfig();
    }

    if (master === undefined || master) {
      await watchTrellisFLBusinesses(CONNECTION);
    }

    // Some queued jobs may depend on the poller to complete, so start it now.
    if (polling === undefined || polling) {
      await poll.poll({
        connection: CONNECTION,
        basePath: SERVICE_PATH,
        pollOnStartup: true,
        pollFunc: pollFl,
        interval: INTERVAL_MS,
        name: 'food-logiq-poll',
      });
    }

    // Create the service
    if (service === undefined || service) {
      const service = new Service({
        name: SERVICE_NAME,
        oada: CONNECTION,
      });

      // Set the job type handlers
      service.on('document-mirrored', config.get('timeouts.mirrorWatch'), handleDocumentJob);
      service.on('assessment-mirrored', config.get('timeouts.mirrorWatch'), handleAssessmentJob);

      // Start the jobs watching service
      const serviceP = service.start();

      // Start the things watching to create jobs
      const p = startJobCreator(CONNECTION);

      // Catch errors
      // eslint-disable-next-line github/no-then
      await Promise.all([serviceP, p]).catch((cError) => {
        error(cError);
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit(1);
      });
      info(`Finished starting service: ${SERVICE_NAME}`);
    }

    if (target === undefined || target) {
      await watchTargetJobs();
    }

/*    await reports.interval({
      connection: CONNECTION,
      basePath: SERVICE_PATH,
      interval: 3600*24*1000,
      reportFunc: genReport,
      interval: INTERVAL_MS,
      name: 'fl-sync',
    });
    */
    //    setInterval(handleIncomplete, HANDLE_INCOMPLETE_INTERVAL);
    info('Initialize complete. Service running...')

  } catch (err) {
    error(err);
    throw err;
  }
}//initialize


process.on('uncaughtException', function(err) {
  error('Caught exception: ' + err);
});

if (esmain(import.meta)) {
  initialize({
    polling: true,
    watchConfig: true,
    master: true,
    target: true,
    service: true
  })
} else {
  info('Just importing fl-sync');
}
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
import config from './config.js';

import { setTimeout } from 'node:timers/promises';

import axios, { AxiosRequestConfig } from 'axios';
import moment, { Moment } from 'moment';
import Bluebird from 'bluebird';
import { Service } from '@oada/jobs';
import _ from 'lodash';
import debug from 'debug';
import esMain from 'es-main';

import { Change, JsonObject, OADAClient, connect } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import { ListWatch } from '@oada/list-lib';
import type { TreeKey } from '@oada/list-lib/dist/tree.js';
import poll from '@oada/poll';

import {
  FlObject,
  getLookup,
  handleAssessmentJob,
  handleDocumentJob,
  onTargetChange,
  startJobCreator,
} from './mirrorWatch.js';
import { reportConfig } from './reportConfig.js';
import tree from './tree.js';
import { watchTrellisFLBusinesses } from './masterData.js';

if (process.env.LOCAL) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const JUST_TPS = config.get('trellis.justTps');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const CONCURRENCY = config.get('trellis.concurrency');
// Const HANDLE_INCOMPLETE_INTERVAL = config.get('trellis.handleIncompleteInterval');
// const REPORT_INTERVAL = config.get('trellis.handleIncompleteInterval');
const INTERVAL_MS = config.get('foodlogiq.interval') * 1000; // FL polling interval
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

let AUTO_APPROVE_ASSESSMENTS: boolean;
let TOKEN;

let CONNECTION: OADAClient;
// Let SOMEGLOBALCOUNT = 0;

async function handleConfigChanges(changes: AsyncIterable<Readonly<Change>>) {
  for await (const change of changes) {
    try {
      if (_.has(change.body, 'autoapprove-assessments')) {
        setAutoApprove(Boolean(change.body['autoapprove-assessments']));
      }
    } catch (cError: unknown) {
      error({ error: cError }, 'mirror watchCallback error');
    }
  }
}

/**
 * Watches FL config
 */
export async function watchFlSyncConfig() {
  const data = await CONNECTION.get({
    path: `${SERVICE_PATH}`,
  })
    .then((r) => r.data as JsonObject)
    .catch(async (cError: any) => {
      if (cError.status === 404) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}`,
          data: {},
          tree,
        });
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses`,
          data: {},
          tree,
        });
        return {} as JsonObject;
      }

      throw cError as Error;
    });
  if (
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !Buffer.isBuffer(data)
  ) {
    setAutoApprove(Boolean(data['autoapprove-assessments']));
  }

  const { changes } = await CONNECTION.watch({
    path: `${SERVICE_PATH}`,
    type: 'single',
  });

  info('Watching %s for changes to the config', SERVICE_PATH);
  void handleConfigChanges(changes);
} // WatchFlSyncConfig

/**
 * watches target jobs
 */
async function watchTargetJobs() {
  info(`Started ListWatch on target jobs...`);
  const watch = new ListWatch({
    path: `/bookmarks/services/target/jobs/pending`,
    name: `target-jobs-fl-sync`,
    conn: CONNECTION,
    resume: true,
    onAddItem: getLookup,
    // @ts-expect-error
    onChangeItem: onTargetChange,
  });
  process.on('beforeExit', async () => {
    await watch.stop();
  });
} // WatchTargetJobs

export async function handleItem(type: string, item: FlObject) {
  let bid;
  try {
    let sync;
    if (type === 'assessments') {
      bid = _.has(item, 'performedOnBusiness._id')
        ? item.performedOnBusiness._id
        : undefined;
    } else {
      bid = _.has(item, 'shareSource.sourceBusiness._id')
        ? item.shareSource.sourceBusiness._id
        : undefined;
    }

    if (!bid) {
      error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
      return true;
    }

    // REMOVE THIS LATER >>>>>>>>>>>>>>>>>>>>>>>>>
    /*
    if (_.has(item, 'shareSource.type.name') && item.shareSource.type.name === "Certificate of Insurance") {
      console.log("Continuing on COI document", item._id, bid)
    } else {
      console.log("Skipping non COI document", item._id, bid)
      return true;
    }
    */
    // REMOVE THIS LATER <<<<<<<<<<<<<<<<<<<<<<<<<

    const path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
    try {
      const { data: resp } = (await CONNECTION.get({ path })) as {
        data: JsonObject;
      };

      // Check for changes to the resources
      const equals = _.isEqual(resp['food-logiq-mirror'], item);
      if (!equals) {
        info(
          `Document difference in FL doc [${item._id}] detected. Syncing...`
        );
        sync = true;
      }
    } catch (cError: unknown) {
      // @ts-expect-error stupid errors
      if (cError.status !== 404) {
        throw cError;
      }

      info('Resource is not already in trellis. Syncing...');
      sync = true;
    }

    // Now, sync
    if (sync) {
      // Delay += 500;
      // This tree put, when run on startup or other cases where we are going
      // through pages of data, causes if-match issues. The promise.map closure
      // this falls within was changed to .each for the time-being
      await CONNECTION.put({
        path: `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`,
        data: { 'food-logiq-mirror': item } as unknown as Body,
        tree,
      });
      info(
        `Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`
      );
    }

    return true;
  } catch (cError: unknown) {
    // TODO: Need to add this to some sort of retry
    error(
      { error: cError },
      `fetchCommunityResources errored on item ${item._id} bid ${bid}. Moving on`
    );
    return false;
  }
}

/**
 * Fetches community resources
 * @param {*} param0 pageIndex, type, date
 */
export async function fetchCommunityResources({
  type,
  startTime,
  endTime,
  pageIndex,
}: {
  type: string;
  startTime: string;
  endTime: string;
  pageIndex?: number;
}) {
  pageIndex = pageIndex ?? 0;
  const url =
    type === 'assessments'
      ? `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment?lastUpdateAt=${startTime}..${endTime}`
      : `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?sourceCommunities=${COMMUNITY_ID}&versionUpdated=${startTime}..${endTime}`;
  const request: AxiosRequestConfig = {
    method: `get`,
    url,
    headers: { Authorization: FL_TOKEN },
  };
  if (pageIndex) {
    request.params = { pageIndex };
  }

  const response = await axios(request);
  const delay = 0;

  // Manually check for changes; Only update the resource if it has changed!
  try {
    for await (const item of response.data.pageItems as FlObject[]) {
      let retries = 5;
      // eslint-disable-next-line no-await-in-loop
      while (retries-- > 0 && !(await handleItem(type, item)));
    }
  } catch (cError: unknown) {
    error({ error: cError }, 'fetchCommunityResources');
    throw cError;
  }

  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(
      `Finished page ${pageIndex}. Item ${
        response.data.pageItemCount * (pageIndex + 1)
      }/${response.data.totalItemCount}`
    );
    if (type === 'documents') info(`Pausing for ${delay / 60_000} minutes`);
    if (type === 'documents') await setTimeout(delay);
    await fetchCommunityResources({
      type,
      startTime,
      endTime,
      pageIndex: pageIndex + 1,
    });
  }
}

/**
 * Gets resources
 */
async function getResources(startTime: string, endTime: string) {
  // Get pending resources
  for await (const type of ['products', 'locations', 'documents'] as const) {
    trace(`Fetching community ${type}`);
    await fetchCommunityResources({
      type,
      startTime,
      endTime,
      pageIndex: undefined,
    });
  }

  // Now get assessments (slightly different syntax)
  trace('Fetching community assessments');
  await fetchCommunityResources({
    type: 'assessments',
    startTime,
    endTime,
    pageIndex: undefined,
  });
}

/**
 * The callback to be used in the poller. Gets lastPoll date
 */
export async function pollFl(lastPoll: Moment, end: Moment) {
  // Sync list of suppliers
  const startTime = (lastPoll || moment('20150101', 'YYYYMMDD')).utc().format();
  const endTime = end.utc().format();
  trace(`Fetching FL community members with start time: [${startTime}]`);

  await fetchAndSync({
    from: `${FL_DOMAIN}/v2/businesses/${CO_ID}/communities/${COMMUNITY_ID}/memberships?createdAt=${startTime}..${endTime}`,
    to: (index: { business: { _id: string } }) =>
      `${SERVICE_PATH}/businesses/${index.business._id}`,
    async forEach(index: { business: { _id: string } }) {
      // Ensure main endpoints
      for await (const type of [
        'products',
        'locations',
        'documents',
        'assessments',
      ] as const) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${index.business._id}/${type}`,
          data: {} as unknown as Body,
          tree,
        });
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
      }
    },
  });
  // Now fetch community resources
  trace(`JUST_TPS set to ${Boolean(JUST_TPS)}`);
  if (!JUST_TPS) {
    await getResources(startTime, endTime);
  }
} // PollFl

/**
 * fetches and synchronizes
 * @param {*} param0
 * @returns
 */
async function fetchAndSync({
  from,
  to,
  pageIndex,
  forEach,
}: {
  from: string;
  to: string | Function;
  pageIndex?: number;
  forEach: Function;
}) {
  pageIndex = pageIndex ?? 0;
  try {
    const request: AxiosRequestConfig = {
      method: `get`,
      url: from,
      headers: { Authorization: FL_TOKEN },
    };
    if (pageIndex) {
      request.params = { pageIndex };
    }

    const response = await axios(request);

    // Manually check for changes; Only update the resource if it has changed!
    await Bluebird.map(
      response.data.pageItems,
      async (item: FlObject) => {
        let sync;
        if (to) {
          const path =
            typeof to === 'function' ? await to(item) : `${to}/${item._id}`;
          try {
            const resp = await CONNECTION.get({ path }).then(
              (r) => r.data as JsonObject
            );

            // Check for changes to the resources
            const equals = _.isEqual(resp['food-logiq-mirror'], item);
            if (equals)
              info(
                `No resource difference in FL item [${item._id}]. Skipping...`
              );
            if (!equals)
              info(
                `Resource difference in FL item [${item._id}] detected. Syncing to ${path}`
              );
            if (!equals) {
              sync = true;
            }
          } catch (cError: unknown) {
            // @ts-expect-error stupid errors
            if (cError.status === 404) {
              info(
                `FL Resource ${item._id} is not already on trellis. Syncing...`
              );
              sync = true;
            } else {
              error({ error: cError });
              throw cError;
            }
          }

          if (sync) {
            /*
          Let resp = await CONNECTION.post({
            path: `/resources`,
            contentType: tree?.bookmarks?.services?.[SERVICE_NAME]?.businesses?.['*']?._type,
            data: { 'food-logiq-mirror': item } as unknown as Body
          });
          */
            await CONNECTION.put({
              path,
              data: { 'food-logiq-mirror': item } as unknown as Body,
              tree,
              /*
            Data: {
              "_id": resp?.headers?.['content-location']?.replace(/^\//, ''),
              "_rev": 0
            }*/
            });
          }
        }

        if (forEach) await forEach(item);
      },
      { concurrency: 20 }
    );

    // Repeat for additional pages of FL results
    if (response.data.hasNextPage) {
      info(
        `fetchAndSync Finished page ${pageIndex}. Item ${
          response.data.pageItemCount * (pageIndex + 1)
        }/${response.data.totalItemCount}`
      );
      await fetchAndSync({ from, to, pageIndex: pageIndex + 1, forEach });
    }

    return;
  } catch (cError: unknown) {
    info({ error: cError }, 'getBusinesses Error, Please check error logs');
    throw cError;
  }
} // FetchAndSync

export function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

function setAutoApprove(value: boolean) {
  info(`Autoapprove value is ${value}`);
  AUTO_APPROVE_ASSESSMENTS = value;
}

export function getAutoApprove() {
  return AUTO_APPROVE_ASSESSMENTS;
}

async function getToken() {
  return TRELLIS_TOKEN;
}

export async function initialize({
  polling = false,
  target = false,
  master = false,
  service = false,
  watchConfig = false,
}: {
  polling?: boolean;
  target?: boolean;
  master?: boolean;
  service?: boolean;
  watchConfig?: boolean;
}) {
  try {
    info(
      `<<<<<<<<<       Initializing fl-sync service. [v1.2.16]       >>>>>>>>>>`
    );
    TOKEN = await getToken();
    // Connect to oada
    try {
      const conn = await connect({
        domain: `https://${DOMAIN}`,
        token: TOKEN,
        concurrency: CONCURRENCY,
      });
      setConnection(conn);
    } catch (cError: unknown) {
      error({ error: cError }, 'Initializing Trellis connection failed');
      throw cError;
    }

    // Run populateIncomplete first so that the change feeds coming in will have
    // the necessary in-memory items for them to continue being processed.
    // await populateIncomplete()

    if (watchConfig === undefined || watchConfig) {
      await watchFlSyncConfig();
      info('Started fl-sync config handler.');
    }

    if (master === undefined || master) {
      await watchTrellisFLBusinesses(CONNECTION);
      info('Started master data handler.');
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
        getTime: (async () =>
          axios({
            method: 'head',
            url: `${FL_DOMAIN}/businesses`,
            headers: { Authorization: FL_TOKEN },
          }).then((r) => r.headers.date)) as unknown as () => Promise<string>,
      });
      info('Started fl-sync poller.');
    }

    // Create the service
    if (service === undefined || service) {
      const svc = new Service({
        name: SERVICE_NAME,
        oada: CONNECTION,
      });

      // Set the job type handlers
      svc.on(
        'document-mirrored',
        config.get('timeouts.mirrorWatch'),
        handleDocumentJob
      );
      svc.on(
        'assessment-mirrored',
        config.get('timeouts.mirrorWatch'),
        handleAssessmentJob
      );
      svc.addReport(
        'fl-sync-report',
        CONNECTION,
        reportConfig,
        `0 0 * * * *`,
        () => {
          const date = moment().format('YYYY-MM-DD');
          return {
            from: 'noreply@trellis.one',
            to: {
              name: 'Sam Noel',
              email: 'sn@centricity.us'
            },
            replyTo: { email: 'sn@centricity.us' },
            subject: `Trellis Automation Report - ${date}`,
            text: `Attached is the daily Trellis Automation Report for the FoodLoiQ documents process on ${date}.`,
            attachments: [
              {
                filename: `TrellisAutomationReport-${date}`,
                type: 'text/csv',
                content: ''
              }
            ]
          }
        },
        'document'
      )

      // Start the jobs watching service
      const serviceP = svc.start();

      // Start the things watching to create jobs
      const p = startJobCreator(CONNECTION);

      // Catch errors
      // eslint-disable-next-line github/no-then
      await Promise.all([serviceP, p]).catch((cError) => {
        error(cError);
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit(1);
      });
      info('Started fl-sync mirror handler.');
    }

    if (target === undefined || target) {
      await watchTargetJobs();
      info('Started target jobs handler.');
    }

    /*    Await reports.interval({
      connection: CONNECTION,
      basePath: SERVICE_PATH,
      interval: 3600*24*1000,
      reportFunc: genReport,
      interval: INTERVAL_MS,
      name: 'fl-sync',
    });
    */
    //    setInterval(handleIncomplete, HANDLE_INCOMPLETE_INTERVAL);
    info('Initialize complete. Service running...');
  } catch (cError: unknown) {
    error(cError);
    throw cError;
  }
} // Initialize

process.on('uncaughtExceptionMonitor', (cError: unknown) => {
  error({ error: cError }, 'Uncaught exception');
  // The code can carry on for most of these errors, but I'd like to know about
  // them. If I throw, it causes more trouble so I won't.
  //  throw cError;
});

if (esMain(import.meta)) {
  info('Starting up the service. Calling initialize');
  await initialize({
    polling: true,
    watchConfig: true,
    master: true,
    target: true,
    service: true,
  });
} else {
  info('Just importing fl-sync');
}

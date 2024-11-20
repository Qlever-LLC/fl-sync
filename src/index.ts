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

import { pino } from '@oada/pino-debug';

// Load config first so it can set up env
import config from './config.js';

import '@oada/lib-prom';

import type {
  Change,
  JsonObject,
  OADAClient
} from '@oada/client';
import {
  docReportConfig,
  tpReportConfig,
  tpReportFilter,
} from './reportConfig.js';
import {
  handleAssessmentJob,
  handleDocumentJob,
  startJobCreator,
} from './mirrorWatch.js';

// Import this _before_ pino and/or DEBUG

import { setTimeout } from 'node:timers/promises';

import moment, { type Moment } from 'moment';
import Bluebird from 'bluebird';
import { connect } from '@oada/client';
import equal from 'deep-equal';
import esMain from 'es-main';
import type { FlObject } from './types.js';
import { handleFlBusiness } from './masterData.js';
import { poll } from '@oada/poll';
import { Service } from '@oada/jobs';
// Import { businessesReportConfig } from './businessesReportConfig.js';
import { startIncidents } from './flIncidentsCsv.js';
import tree from './tree.js';

const DOMAIN = config.get('trellis.domain');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const JUST_TPS = config.get('trellis.justTps');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const CONCURRENCY = config.get('trellis.concurrency');
const INTERVAL_MS = config.get('foodlogiq.interval') * 1000; // FL polling interval
const SERVICE_NAME = config.get('service.name');
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const FL_FORCE_WRITE = config.get('foodlogiq.force_write');
const DOC_FREQUENCY = config.get('trellis.reports.docFrequency');
const VENDOR_FREQUENCY = config.get('trellis.reports.vendorFrequency');
const REPORT_EMAIL = config.get('trellis.reports.email');
const REPORT_CC_EMAIL = config.get('trellis.reports.ccEmail');
const REPORT_REPLYTO_EMAIL = config.get('trellis.reports.replyToEmail');
const services = config.get('services');
const skipQueueOnStartup = config.get('skipQueueOnStartup');

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

let AUTO_APPROVE_ASSESSMENTS: boolean;
let TOKEN;

let CONNECTION: OADAClient;
const log = pino({ base: { service: SERVICE_NAME } });

async function handleConfigChanges(changes: AsyncIterable<Readonly<Change>>) {
  for await (const change of changes) {
    try {
      if (change.body && 'autoapprove-assessments' in change.body) {
        setAutoApprove(Boolean(change.body['autoapprove-assessments']));
      }
    } catch (cError: unknown) {
      log.error({ error: cError }, 'mirror watchCallback error');
    }
  }
}

/**
 * Watches FL config
 */
export async function watchFlSyncConfig() {
  let data: JsonObject = {};
  try {
    const response = (await CONNECTION.get({
      path: `${SERVICE_PATH}`,
    })) as { data: JsonObject };
    data = response.data ?? {};
  } catch (cError: unknown) {
    // @ts-expect-error stupid errors
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
    } else throw cError as Error;
  }

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

  log.info('Watching %s for changes to the config', SERVICE_PATH);
  void handleConfigChanges(changes);
} // WatchFlSyncConfig

export async function handleItem(
  type: string,
  item: FlObject,
  oada?: OADAClient,
) {
  let bid;
  try {
    let sync;
    bid =
      type === 'assessments'
        ? item?.performedOnBusiness?._id
        : item?.shareSource?.sourceBusiness?._id;

    if (!bid) {
      log.error(`FL BID undefined for this [${type}] item with _id [${item._id}].`);
      return true;
    }

    const path = `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`;
    try {
      const { data: resp } = (await (CONNECTION || oada).get({ path })) as {
        data: JsonObject;
      };

      // Check for changes to the resources
      const equals = equal(resp['food-logiq-mirror'], item);
      if (!equals || FL_FORCE_WRITE) {
        log.info(
          `Document difference in FL doc [${item._id}] detected. Syncing...`,
        );
        sync = true;
      }
    } catch (cError: unknown) {
      // @ts-expect-error stupid errors
      if (cError.status !== 404) {
        throw cError;
      }

      log.info('Resource is not already in trellis. Syncing...');
      sync = true;
    }

    // Now, sync
    if (sync) {
      // Delay += 500;
      // This tree put, when run on startup or other cases where we are going
      // through pages of data, causes if-match issues. The promise.map closure
      // this falls within was changed to .each for the time-being
      await (CONNECTION || oada).put({
        path: `${SERVICE_PATH}/businesses/${bid}/${type}/${item._id}`,
        data: { 'food-logiq-mirror': item } as unknown as JsonObject,
        tree,
      });
      log.info(
        `Document synced to mirror: type:${type} _id:${item._id} bid:${bid}`,
      );
    }

    return true;
  } catch (cError: unknown) {
    // TODO: Need to add this to some sort of retry
    log.error(
      { error: cError },
      `fetchCommunityResources errored on item ${item._id} bid ${bid}. Moving on`,
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
  pageIndex = 0,
  oada,
}: {
  type: string;
  startTime: string;
  endTime: string;
  pageIndex?: number;
  oada?: OADAClient;
}) {
  const parameters = new URLSearchParams({
    pageIndex: `${pageIndex}`,
  });
  if (type === 'assessments') {
    parameters.append('lastUpdatedAt', `${startTime}..${endTime}`);
  } else {
    parameters.append('versionUpdated', `${startTime}..${endTime}`);
    parameters.append('sourceCommunities', COMMUNITY_ID);
  }

  const url =
    type === 'assessments'
      ? `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment?${parameters}`
      : `${FL_DOMAIN}/v2/businesses/${CO_ID}/${type}?${parameters}`;
  const response = await fetch(url, {
    method: `get`,
    headers: { Authorization: FL_TOKEN },
  });
  const data = (await response.json()) as any;
  const delay = 0;

  // Manually check for changes; Only update the resource if it has changed!
  try {
    for await (const item of data.pageItems as FlObject[]) {
      let retries = 5;
      // eslint-disable-next-line no-await-in-loop
      while (retries-- > 0 && !(await handleItem(type, item, oada)));
    }
  } catch (cError: unknown) {
    log.error({ error: cError }, 'fetchCommunityResources');
    throw cError;
  }

  // Repeat for additional pages of FL results
  if (data.hasNextPage && pageIndex < 1000) {
    log.info(
      `Finished page ${pageIndex}. Item ${
        data.pageItemCount * (pageIndex + 1)
      }/${data.totalItemCount}`,
    );
    if (type === 'documents') log.info(`Pausing for ${delay / 60_000} minutes`);
    if (type === 'documents') await setTimeout(delay);
    await fetchCommunityResources({
      type,
      startTime,
      endTime,
      pageIndex: pageIndex + 1,
      oada,
    });
  }
}

/**
 * Gets resources
 */
async function getResources(startTime: string, endTime: string) {
  // Get pending resources
  for await (const type of ['products', 'locations', 'documents'] as const) {
    log.trace(`Fetching community ${type}`);
    await fetchCommunityResources({
      type,
      startTime,
      endTime,
      pageIndex: undefined,
    });
  }

  // Now get assessments (slightly different syntax)
  /*
  trace('Fetching community assessments');
  await fetchCommunityResources({
    type: 'assessments',
    startTime,
    endTime,
    pageIndex: undefined,
  });
  */
}

/**
 * The callback to be used in the poller. Gets lastPoll date
 */
export async function pollFl(lastPoll: Moment, end: Moment) {
  // Sync list of suppliers
  const startTime = (lastPoll || moment('20150101', 'YYYYMMDD')).utc().format();
  const endTime = end.utc().format();
  log.trace(`Fetching FL community members with start time: [${startTime}]`);

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
        // 'assessments',
      ] as const) {
        await CONNECTION.put({
          path: `${SERVICE_PATH}/businesses/${index.business._id}/${type}`,
          data: {},
          tree,
        });
      }
    },
  });
  // Now fetch community resources
  log.trace(`JUST_TPS set to ${Boolean(JUST_TPS)}`);
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
  pageIndex = 0,
  forEach,
}: {
  from: string;
  to:
    | string
    | ((input: { business: { _id: string } }) => string | PromiseLike<string>);
  pageIndex?: number;
  forEach: (input: { business: { _id: string } }) => PromiseLike<void>;
}) {
  try {
    const url = new URL(from);
    url.searchParams.append('pageIndex', `${pageIndex}`);
    const response = await fetch(url, {
      method: `get`,
      headers: { Authorization: FL_TOKEN },
    });
    const data = (await response.json()) as any;

    // Manually check for changes; Only update the resource if it has changed!
    await Bluebird.map(
      data.pageItems,
      async (item: FlObject) => {
        let sync;
        if (to) {
          const path =
            typeof to === 'function'
              ? await to(item as any)
              : `${to}/${item._id}`;
          try {
            const { data: resp } = (await CONNECTION.get({ path })) as {
              data: any;
            };
            if (
              typeof resp !== 'object' ||
              Buffer.isBuffer(resp) ||
              Array.isArray(resp)
            ) {
              throw new TypeError('Not an object');
            }

            // Check for changes to the resources
            const equals = equal(resp?.['food-logiq-mirror'], item);
            if (equals)
              log.info(
                `No resource difference in FL item [${item._id}]. Skipping...`,
              );
            if (!equals)
              log.info(
                `Resource difference in FL item [${item._id}] detected. Syncing to ${path}`,
              );
            if (!equals) {
              sync = true;
            }
          } catch (cError: unknown) {
            // @ts-expect-error stupid errors
            if (cError.status === 404) {
              log.info(
                `FL Resource ${item._id} is not already on trellis. Syncing...`,
              );
              sync = true;
            } else {
              log.error({ error: cError });
              throw cError;
            }
          }

          if (sync) {
            await CONNECTION.put({
              path,
              data: { 'food-logiq-mirror': item } as unknown as JsonObject,
              tree,
            });
          }
        }

        await forEach?.(item as any);
      },
      { concurrency: 20 },
    );

    // Repeat for additional pages of FL results
    if (data.hasNextPage) {
      log.info(
        `fetchAndSync Finished page ${pageIndex}. Item ${
          data.pageItemCount * (pageIndex + 1)
        }/${data.totalItemCount}`,
      );
      await fetchAndSync({ from, to, pageIndex: pageIndex + 1, forEach });
    }
  } catch (cError: unknown) {
    log.info({ error: cError }, 'getBusinesses Error, Please check error logs');
    throw cError;
  }
} // FetchAndSync

export function setConnection(conn: OADAClient) {
  CONNECTION = conn;
}

function setAutoApprove(value: boolean) {
  log.info(`Autoapprove value is ${value}`);
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
  mirrorWatch = false,
  watchConfig = false,
  incidents = false,
}: {
  polling?: boolean;
  mirrorWatch?: boolean;
  watchConfig?: boolean;
  incidents?: boolean;
}) {
  try {
    log.info(
      `<<<<<<<<<       Initializing fl-sync service. [v${process.env.npm_package_version}]       >>>>>>>>>>`,
    );
    TOKEN = await getToken();
    // Connect to oada
    try {
      const conn = await connect({
        domain: DOMAIN,
        token: TOKEN,
        concurrency: CONCURRENCY,
      });
      setConnection(conn);
    } catch (cError: unknown) {
      log.error({ error: cError }, 'Initializing Trellis connection failed');
      throw cError;
    }

    // Run populateIncomplete first so that the change feeds coming in will have
    // the necessary in-memory items for them to continue being processed.
    if (incidents === undefined || incidents) {
      await startIncidents(CONNECTION);
    }

    if (watchConfig === undefined || watchConfig) {
      await watchFlSyncConfig();
      log.info('Started fl-sync config handler.');
    }

    // Some queued jobs may depend on the poller to complete, so start it now.
    if (polling === undefined || polling) {
      poll({
        connection: CONNECTION,
        basePath: SERVICE_PATH,
        pollOnStartup: true,
        pollFunc: pollFl,
        interval: INTERVAL_MS,
        name: 'food-logiq-poll',
        async getTime() {
          const { headers } = await fetch(`${FL_DOMAIN}/businesses`, {
            method: 'head',
            headers: { Authorization: FL_TOKEN },
          });
          return headers.get('Date')!;
        },
      });
      log.info('Started fl-sync poller.');
    }

    // Create the service
    if (mirrorWatch === undefined || mirrorWatch) {
      const svc = new Service({
        name: SERVICE_NAME,
        oada: CONNECTION,
        concurrency: 10,
        opts: { skipQueueOnStartup },
      });

      // Set the job type handlers
      svc.on(
        'document-mirrored',
        config.get('timeouts.mirrorWatch'),
        handleDocumentJob,
      );
      svc.on(
        'assessment-mirrored',
        config.get('timeouts.mirrorWatch'),
        handleAssessmentJob,
      );
      svc.on(
        'business-lookup',
        config.get('timeouts.mirrorWatch'),
        handleFlBusiness,
      );
      svc.addReport({
        name: 'fl-sync-report',
        reportConfig: docReportConfig,
        frequency: DOC_FREQUENCY,
        email: prepEmail,
        type: 'document-mirrored',
      });
      svc.addReport({
        name: 'businesses-report',
        reportConfig: tpReportConfig,
        frequency: VENDOR_FREQUENCY,
        email: prepTpEmail,
        type: 'business-lookup',
        filter: tpReportFilter,
      });

      // Start the jobs watching service
      const serviceP = svc.start();

      // Start the things watching to create jobs
      const p = startJobCreator(CONNECTION, log);

      // Catch errors
      try {
        await Promise.all([serviceP, p]);
      } catch (cError: unknown) {
        log.error(cError);
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit(1);
      }

      log.info('Started fl-sync mirror handler.');
    }

    log.info('Initialize complete. Service running...');
  } catch (cError: unknown) {
    log.error(cError);
    throw cError;
  }
} // Initialize

function prepEmail() {
  const date = moment().subtract(1, 'day').format('YYYY-MM-DD');
  if (!REPORT_EMAIL) throw new Error('REPORT_EMAIL is required for prepEmail');
  if (!REPORT_REPLYTO_EMAIL)
    throw new Error('REPORT_REPLYTO_EMAIL is required for prepEmail');
  return {
    from: 'noreply@trellis.one',
    to: REPORT_CC_EMAIL ? [REPORT_EMAIL, REPORT_CC_EMAIL] : [REPORT_EMAIL],
    replyTo: { email: REPORT_REPLYTO_EMAIL },
    subject: `Trellis Automation Report - ${date}`,
    text: `Attached is the daily Trellis Automation Report for the FoodLogiQ documents process on ${date}.`,
    attachments: [
      {
        filename: `TrellisAutomationReport-${date}.csv`,
        type: 'text/csv',
        content: '',
      },
    ],
  };
}

export function prepTpEmail() {
  const date = moment().subtract(1, 'day').format('YYYY-MM-DD');
  if (!REPORT_EMAIL) throw new Error('REPORT_EMAIL is required for prepEmail');
  if (!REPORT_REPLYTO_EMAIL)
    throw new Error('REPORT_REPLYTO_EMAIL is required for prepEmail');
  return {
    from: 'noreply@trellis.one',
    to: REPORT_CC_EMAIL ? [REPORT_EMAIL, REPORT_CC_EMAIL] : [REPORT_EMAIL],
    replyTo: { email: REPORT_REPLYTO_EMAIL },
    subject: `Trellis Automation Report - ${date}`,
    text: `Attached is the daily Trellis Automation Report for the FoodLogiQ documents process on ${date}.`,
    attachments: [
      {
        filename: `VendorsReportWeekly-${date}.csv`,
        type: 'text/csv',
        content: '',
      },
    ],
  };
}

process.on('uncaughtExceptionMonitor', (cError: unknown) => {
  log.error({ error: cError }, 'Uncaught exception');
  // The code can carry on for most of these errors, but I'd like to know about
  // them. If I throw, it causes more trouble so I won't.
  //  throw cError;
});

if (esMain(import.meta)) {
  log.info('Starting up the service. Calling initialize');
  await initialize(services);
} else {
  log.info('Just importing fl-sync');
}

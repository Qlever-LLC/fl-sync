/*
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable unicorn/prevent-abbreviations */

import _ from 'lodash';
import config from '../dist/config.js';
import test from 'ava';
import type { JsonObject, OADAClient } from '@oada/client';
import type { Job, Logger } from '@oada/jobs';
import { ListWatch } from '@oada/list-lib';
import { setTimeout } from 'node:timers/promises';
import { connect } from '@oada/client';

import type { JobConfig } from '../dist/mirrorWatch.js';
import type { TreeKey } from '@oada/types/oada/tree/v1.js';
import { isObj, postJob, handleDocumentJob } from '../dist/mirrorWatch.js';
import { mostRecentKsuid } from '../dist/report.js';
import { initialize as service } from '../dist/index.js';
import { tree } from '../dist/tree.js';

// Import {makeTargetJob, sendUpdate} from './dummyTarget.js'
const TOKEN = process.env.TOKEN ?? ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const CO_ID = config.get('foodlogiq.community.owner.id');

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

// Const pending = `${SERVICE_PATH}/jobs/pending`
let oada: OADAClient;

test.before(async (t) => {
  t.timeout(60_000);
  oada = await connect({ domain: DOMAIN, token: TOKEN });
  await oada.delete({
    path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois/7061be84577255dca0c348f605cadf5e`,
  });
  return oada;
  /*
  await oada.put({
    path: `${SERVICE_PATH}/_meta/oada-poll/food-logiq-poll`,
    // Tree,
    data: { lastPoll: moment().subtract(1, 'minutes').utc().format() },
  });
  // Blow away the existing jobs queue
  let jobKeys;
  try {
    const r = await oada.get({
      path: `${SERVICE_PATH}/jobs/pending`,
    });
    jobKeys = Object.keys(r.data ?? {}).filter((key) => !key.startsWith('_'));
  } catch (error: unknown)separate {
    // @ts-expect-error error type
    if (error.status !== 404) throw error;
    return [];
  }

  await Promise.all(
    jobKeys.map(async (jobKey) => {
      await oada.delete({
        path: `${SERVICE_PATH}/jobs/pending/${jobKey}`,
      });
    })
  );

  // Blow away the existing coi docs created
  let keys;
  try {
    const r = await oada.get({
      path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois`,
    });
    keys = Object.keys(r.data ?? {}).filter((key) => !key.startsWith('_'));
  } catch (error: unknown) {
    // @ts-expect-error error type
    if (error.status !== 404) throw error;
    return [];
  }

  await Promise.all(
    keys.map(async (key) => resources/2GGoTs2WIPEzoa5mF5pe6XEkqKz{
      await oada.delete({
        path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois/${key}`,
      });
    })
    );
    */
});

test('A job that is started should be resumed on restart of the service', async (t) => {
  t.timeout(200_000);
  // 1. Create a job and call the job handler manually. This should allow the
  // doc to be written to trading-partner docs.
  // 2. turn on the fl-sync services
  // 3. The job should resume and finish with the same reference to the target job

  await watchTargetJobs();
  const jobConf: JobConfig = {
    'status': 'awaiting-review',
    'fl-sync-type': 'document',
    'type': 'Certificate of Insurance',
    'key': '634dc117bf1d87000fc4b7ef',
    'date': '10-14-2022',
    'bid': '61f95cd2df6175000f371494',
    '_rev': 1,
    'masterid':
      'd4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e',
    'mirrorid': 'resources/2GHq2HdwHPLDZ8cdsMynfALpGes',
    'bname': 'TrellisTestSupplier',
    'name': 'test coi',
    'link': `https://sandbox.foodlogiq.com/businesses/${CO_ID}/documents/detail/634dc117bf1d87000fc4b7ef`,
  };
  const jobId = await postJob(oada, jobConf, 'awaiting-review');
  const jobKey = jobId.replace(/^resources\//, '');

  const path = `/${jobId}`;
  await oada.put({
    path,
    data: { oadaId: jobId },
  });

  let { data: job } = await oada.get({
    path,
  });

  handleDocumentJob(job as unknown as Job, {
    oada,
    jobId: jobKey,
    log: undefined as unknown as Logger,
  });

  await setTimeout(30_000);
  // Get the job
  ({ data: job } = await oada.get({
    path,
  }));


  // @ts-expect-error Job bleh
  if (!isObj(job) || !isObj(job.config['target-jobs'])) throw new Error('Not object');
  // @ts-expect-error something
  const targetJobBefore = Object.keys(job.config['target-jobs'])[0];

  // Now start up the services
  await service({
    polling: true,
    master: false,
    mirrorWatch: true,
    watchConfig: true,
  });

  // Wait some time
  await setTimeout(80_000);

  // Get and check the target job
  ({ data: job } = await oada.get({
    path,
  }));

  // @ts-expect-error something
  if (!isObj(job) || !isObj(job.config['target-jobs'])) throw new Error('Not object');
  // @ts-expect-error something
  const targetJobAfter = Object.keys(job.config['target-jobs'])[0];

  t.is(targetJobBefore, targetJobAfter);
});

async function watchTargetJobs() {
  const watch = new ListWatch({
    path: `/bookmarks/services/target/jobs/pending`,
    name: `target-jobs-fl-sync`,
    conn: oada,
    resume: true,
    onAddItem: targetWatchOnAdd,
  });
  process.on('beforeExit', async () => {
    await watch.stop();
  });
}

export async function targetWatchOnAdd(item: any, key: string) {
  try {
    const { _id } = item;
    key = key.replace(/^\//, '');
    if (!(item.config && item.config.pdf && item.config.pdf._id)) return;
    const pdfId = item.config.pdf._id;
    if (!pdfId) return;

    // Fetch then store a mapping to the fl-sync job
    let { data } = await oada.get({
      path: `/${pdfId}/_meta`,
    });

    if (Buffer.isBuffer(data)) {
      data = JSON.parse((data ?? '').toString());
    }

    if (!isObj(data)) {
      throw new Error(`PDF _meta [${pdfId}] was not an object.`);
    }

    // @ts-expect-error
    const flJobKeys = Object.keys(data?.services?.['fl-sync']?.jobs || {});

    const jobKey = mostRecentKsuid(flJobKeys);
    if (!jobKey)
      return undefined;

    // @ts-expect-error
    const jobId = data?.services?.['fl-sync']?.jobs?.[jobKey]!._id;

    const {
      data: { bid, key: documentKey },
    } = (await oada.get({
      path: `/${jobId}/config`,
    })) as { data: JsonObject };

    await oada.put({
      path: `${SERVICE_PATH}/businesses/${bid}/documents/${documentKey}/_meta`,
      data: {
        services: {
          target: {
            jobs: {
              [key]: { _id },
            },
          },
        },
      },
    });

    await oada.put({
      path: `/${jobId}/config/target-jobs`,
      data: {
        [key]: { _id },
      },
    });

    return undefined;
  } catch (cError: unknown) {
    return undefined;
  }
}

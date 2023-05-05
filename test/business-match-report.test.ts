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

import { connect, doJob } from '@oada/client';
import type { OADAClient } from '@oada/client';
import { Service } from '@oada/jobs';
import type { TreeKey } from '@oada/types/oada/tree/v1.js';

import config from '../dist/config.js';
import debug from 'debug';
import { handleNewBusiness } from '../dist/masterData2.js';
import test from 'ava';
import { tree } from '../dist/tree.js';

const warn = debug('fl-sync:warn');
const TOKEN = process.env.TOKEN ?? ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const SERVICE_NAME = 'test-business-lookup';

if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

// Const pending = `${SERVICE_PATH}/jobs/pending`
let oada: OADAClient;

test.before(async (t) => {
  t.timeout(60_000);
  oada = await connect({ domain: DOMAIN, token: TOKEN });

  warn(`trellis-data-manager must be running for this set of tests`);
  //start the service listening for fl business lookup jobs
  const svc = new Service({
    name: SERVICE_NAME,
    oada,
  });
  svc.on(
    'business-lookup',
    config.get('timeouts.mirrorWatch'),
    handleNewBusiness
  );

  await svc.start();
});

test('Should return a temporary trading partner along with any matches', async (t) => {
  //1. In the service, FL businesses will show up.
  //2. The service ListWatch will detect new items, I believe
  //3. However, the main service should probably await on retrieving the business, but it should call more of an ensure on them
  //4. If the ensure finds nothing in the query, it'll just create one temporarily and then report on it
  //5. 

  const testFlBusiness = {
    business: {
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
      internalId: undefined,
    },
  };
  const job = await doJob(oada, {
    type: 'business-lookup',
    service: SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  //The result should contain 'temporary' and 'matches'
  t.assert(job?.result?.temporary);
  t.assert(job?.result?.matches);

  //The result should have a match
});

test.only('Should return an exact match if it exists', async (t) => {
  const testFlBusiness = {
    business: {
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
      internalId: 'testExactMatch',
    },
  };

  // Create a trading-partner to match against
  await doJob(oada, {
    type: 'trading-partners-ensure',
    service: 'trellis-data-manager',
    config: {
      element: testFlBusiness,
    },
  });

  const job = (await doJob(oada, {
    type: 'business-lookup',
    service: SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  })) as { result: any };

  //The result should contain
  t.assert(job.result.query.matches);
  t.assert(job.result.ensure.entry);
  t.is(job.result.query.matches.length, 1);
  t.is(job.result.ensure.entry.sapid, testFlBusiness.business.internalId);

});

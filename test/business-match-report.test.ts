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
import type { FlBusiness } from '../dist/mirrorWatch.js';
import { handleNewBusiness, mapTradingPartner } from '../dist/masterData2.js';
import test from 'ava';
import { tree } from '../dist/tree.js';

const warn = debug('fl-sync:warn');
const TOKEN = process.env.TOKEN ?? ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const TP_MANAGER_SERVICE = config.get('tp-manager');
const SERVICE_NAME = config.get('service.name');
const TEST_SERVICE_NAME = `test-${SERVICE_NAME}`;

if (TEST_SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[TEST_SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

// Const pending = `${TEST_SERVICE_PATH}/jobs/pending`
let oada: OADAClient;

test.before(async (t) => {
  t.timeout(60_000);
  oada = await connect({ domain: DOMAIN, token: TOKEN });

  await oada.delete({
    path: `/bookmarks/services/${TEST_SERVICE_NAME}`,
  });

  warn(`${TP_MANAGER_SERVICE} must be running for this set of tests`);
  // Start the service listening for fl business lookup jobs
  const svc = new Service({
    name: TEST_SERVICE_NAME,
    oada,
  });
  svc.on(
    'business-lookup',
    config.get('timeouts.mirrorWatch'),
    handleNewBusiness
  );
  await svc.start();
});

test.after(async () => {
  await oada.delete({
    path: `/bookmarks/services/${TEST_SERVICE_NAME}`,
  });
});

test('If no TP exists, it should create one with a food logiq external id', async (t) => {
  const testFlBusiness = {
    business: {
      _id: 'testid111111',
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
      internalId: '',
    },
  };

  const job = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  //The result should contain 'new' and 'matches'
  t.falsy(job.result?.new);
  t.true(job.result?.exact);
  t.assert(job?.result?.entry);
});

test('Should return an exact on foodlogiq externalId', async (t) => {
  const testFlBusiness = {
    business: {
      _id: 'testid111111',
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: 'ABC123',
  };

  const jobA = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  const jobB = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  //The result should contain 'new' and 'matches'
  t.falsy(jobB.result?.new);
  t.true(jobB.result?.exact);
  t.assert(jobB?.result?.entry);
  // @ts-expect-error object is of type unknown
  t.true(jobB?.result?.entry.externalIds.includes('sap:ABC123'));
});

test.only('Merge should combine two trading-partners and get rid of one of them', async (t) => {
  const testFlBusiness = {
    business: {
      _id: 'testid111111',
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
  };
  // Create two businesses
  const fromJob = await doJob(oada, {
    type: 'trading-partners-ensure',
    service: TP_MANAGER_SERVICE,
    config: {
      element: mapTradingPartner(testFlBusiness as unknown as FlBusiness),
    },
  });

  await oada.put({
    // @ts-expect-error type is messed up
    path: `/${fromJob.result.entry.masterid}/bookmarks/trellisfw/documents/test/abc123`,
    data: {
      foo: 'bar',
    },
    tree,
  });

  const toJob = await doJob(oada, {
    type: 'trading-partners-ensure',
    service: TP_MANAGER_SERVICE,
    config: {
      element: {
        name: 'TEST BUSINESS',
        address: '101 Test St',
        city: 'Testville',
        state: 'IN',
        email: 'someother@test.com',
        phone: '777-777-7777',
        externalIds: ['sap:efghij123098'],
      },
    },
  });

  await doJob(oada, {
    type: 'trading-partners-merge',
    service: TP_MANAGER_SERVICE,
    config: {
      // @ts-expect-error thing
      from: fromJob.result?.entry.masterid,
      // @ts-expect-error fixme
      to: toJob.result?.entry.masterid,
    },
  });

  const job = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: { 'fl-business': testFlBusiness },
  });

  // The from entity should no longer exist in the trading-partner list
  // The from entity should still exist via resource id
  t.assert(job?.result?.matches);
  t.assert(job?.result?.entry);
  // @ts-expect-error bar
  t.true(job?.result?.entry.externalIds.includes('sap:efghij123098'));
  // @ts-expect-error bar
  t.true(job?.result?.entry.externalIds.includes('foodlogiq:testid111111'));
});

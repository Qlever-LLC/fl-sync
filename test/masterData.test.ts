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
import { parseAttachment, Service } from '@oada/jobs';
import type { TreeKey } from '@oada/types/oada/tree/v1.js';

import config from '../dist/config.js';
import debug from 'debug';
import type { FlBusiness } from '../dist/mirrorWatch.js';
import { handleFlBusiness, mapTradingPartner } from '../dist/masterData2.js';
import test from 'ava';
import ksuid from 'ksuid';
import { tree } from '../dist/tree.js';
import type { JsonObject } from '@oada/client';
import { tpReportConfig, tpReportFilter } from '../dist/reportConfig.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'node:path';
import { prepTpEmail } from '../dist/index.js';

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
    handleFlBusiness
  );
  svc.addReport({
    name: 'businesses-report',
    reportConfig: tpReportConfig,
    frequency: `0 0 0 * * 1`,
    email: (() => {}) as any,
  });

  await svc.start();
});

test.after(async () => {
  await oada.delete({
    path: `/bookmarks/services/${TEST_SERVICE_NAME}`,
  });
});

test.beforeEach(async () => {
  const { data: tps } = (await oada.get({
    path: `/bookmarks/test/trading-partners`,
  })) as { data: JsonObject };

  const keys = Object.keys(tps).filter((k) => !k.startsWith('_'));
  for await (const tp of keys) {
    await oada.delete({
      path: `/bookmarks/services/${TEST_SERVICE_NAME}/trading-partners/${tp}`,
    });
  }
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

test('Should return an exact on sap externalId', async (t) => {
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

test('Should return an exact match on foodlogiq externalId', async (t) => {
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
    internalId: '',
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
  t.true(jobB?.result?.entry.externalIds.includes('foodlogiq:testid111111'));
});

test('Should return the correct trading partner after updating the internalId', async (t) => {
  let testFlBusiness = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: '',
  };

  await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });
  const internalIds = [ksuid.randomSync().string, ksuid.randomSync().string];
  testFlBusiness.internalId = internalIds.join(',');

  const jobB = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  t.falsy(jobB.result?.new);
  t.true(jobB.result?.exact);
  t.assert(jobB?.result?.entry);
  t.true(
    // @ts-expect-error object is of type unknown
    jobB?.result?.entry.externalIds.includes(`sap:${internalIds[0]}`)
  );
  t.true(
    // @ts-expect-error object is of type unknown
    jobB?.result?.entry.externalIds.includes(`sap:${internalIds[1]}`)
  );
});

test('Should return the correct trading partner if an already-used sapid is assigned to another FL business', async (t) => {
  const testFlBusiness = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: ksuid.randomSync().string,
  };
  await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  const internalIds = [ksuid.randomSync().string, testFlBusiness.internalId];
  const testFlBusinessTwo = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Biz, LLC',
      address: {
        addressLineOne: '200 Test Ave',
        city: 'Testing',
        region: 'TN',
      },
      email: 't@testing.com',
      phone: '888-888-8888',
    },
    internalId: internalIds.join(','),
  };
  const jobB = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusinessTwo,
    },
  });

  t.truthy(jobB.result?.new);
  t.falsy(jobB.result?.exact);
  t.assert(jobB?.result?.entry);
  t.true(
    // @ts-expect-error object is of type unknown
    jobB?.result?.entry.externalIds.includes(`sap:${internalIds[0]}`)
  );
  t.true(
    // @ts-expect-error object is of type unknown
    Object.values(jobB?.updates).some(({ meta }: { meta: string }) =>
      meta.includes(`sap:${internalIds[1]}`)
    )
  );
  t.false(
    // @ts-expect-error object is of type unknown
    jobB?.result?.entry.externalIds.includes(`sap:${internalIds[1]}`)
  );
});

test.only(`Should report on all jobs and filter report to just when the business is missing internalIds or a conflict in the data manager occurs`, async (t) => {
  t.timeout(600_000);
  const serveName = 'fl-tp-test-service';
  const reportName = 'test-tp-report';
  await oada.delete({
    path: `/bookmarks/services/${serveName}`,
  });
  const serv = new Service({
    name: 'fl-tp-test-service',
    oada,
  });
  serv.on(
    'business-lookup',
    config.get('timeouts.mirrorWatch'),
    handleFlBusiness
  );
  const dt = new Date();
  dt.setSeconds(dt.getSeconds() + 90);
  const offset = dt.getTimezoneOffset();
  const offsetDt = new Date(dt.getTime() - (offset * 60 * 1000));
  const date = offsetDt.toISOString().split('T')[0];
  serv.addReport({
    name: reportName,
    reportConfig: tpReportConfig,
    frequency: `0 ${dt.getMinutes()} ${dt.getHours()} * * ${dt.getDay()}`,
    email: prepTpEmail,
    type: 'business-lookup',
    filter: tpReportFilter,
  });
  await serv.start();

  const testFlBusiness = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: '',//ksuid.randomSync().string,
  };
  const jobA = (await doJob(oada, {
    type: 'business-lookup',
    service: serveName,
    config: {
      'fl-business': testFlBusiness,
    },
  })) as unknown as { [key: string]: any; _id: string };

  const testFlBusinessTwo = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Biz, LLC',
      address: {
        addressLineOne: '200 Test Ave',
        city: 'Testing',
        region: 'TN',
      },
      email: 't@testing.com',
      phone: '888-888-8888',
    },
    internalId: ksuid.randomSync().string,
  };
  const jobB = (await doJob(oada, {
    type: 'business-lookup',
    service: serveName,
    config: {
      'fl-business': testFlBusinessTwo,
    },
  })) as unknown as { [key: string]: any; _id: string };
  const testFlBusinessThree = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Test, LLC',
      address: {
        addressLineOne: '300 Test Blvd',
        city: 'Test City',
        region: 'TN',
      },
      email: 'test@tests.biz',
      phone: '222-222-2222',
    },
    internalId: `${testFlBusinessTwo.internalId},${ksuid.randomSync().string}`,
  };
  const jobC = (await doJob(oada, {
    type: 'business-lookup',
    service: serveName,
    config: {
      'fl-business': testFlBusinessThree,
    },
  })) as unknown as { [key: string]: any; _id: string };

  await setTimeout(25_000);
  const { data: result } = (await oada.get({
    path: `/bookmarks/services/${serveName}/jobs/reports/${reportName}/day-index/${date}`,
  })) as { data: any };

  const items = Object.fromEntries(
    Object.entries(result).filter(([k, _]) => !k.startsWith('_'))
  );

  t.is(Object.keys(items).length, 2);
  t.truthy(items[jobA._id.replace(/^resources\//, '')]);
  t.falsy(items[jobB._id.replace(/^resources\//, '')]);
  t.truthy(items[jobC._id.replace(/^resources\//, '')]);
  // @ts-expect-error stuff
  const diff = ((dt - Date.now()) as unknown as number) + 3000;
  await setTimeout(diff);
  const { data: emailJobs } = await oada.get({
    path: `/bookmarks/services/abalonemail/jobs/pending`,
  }) as { data: any };

  let keys = Object.keys(emailJobs).filter((k) => !k.startsWith('_'));
  keys = keys.sort();
  t.assert(keys.length);
  const key = keys[keys.length - 1];
  t.assert(key);
  const { data: email } = await oada.get({
    path: `/bookmarks/services/abalonemail/jobs/pending/${key}`,
  }) as unknown as { data: { config: { attachments: any[] } } };

  const objArr = parseAttachment(email?.config?.attachments[0].content) as any[];
  t.true(objArr.some((obj) => obj['FL ID'] === testFlBusiness.business._id));
  t.true(objArr.some((obj) => obj['FL ID'] === testFlBusinessThree.business._id));
});

// Edge case that now should not come up...
test.skip('Should return a new trading partner if the non-foodlogiq externalIds are already in use', async (t) => {
  t.timeout(300_000);
  let testFlBusiness = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: ksuid.randomSync().string,
  };
  await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });

  let testFlBusinessTwo = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Biz, LLC',
      address: {
        addressLineOne: '200 Test Ave',
        city: 'Testing',
        region: 'TN',
      },
      email: 't@testing.com',
      phone: '888-888-8888',
    },
    internalId: ksuid.randomSync().string,
  };
  const jobB = await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusinessTwo,
    },
  });
  let testFlBusinessThree = {
    business: {
      _id: `testid${ksuid.randomSync().string}`,
      name: 'Test Business, LLC',
      address: {
        addressLineOne: '101 Test Street',
        city: 'Testville',
        region: 'IN',
      },
      email: 'test@test.com',
      phone: '777-777-7777',
    },
    internalId: ksuid.randomSync().string,
  };
  await doJob(oada, {
    type: 'business-lookup',
    service: TEST_SERVICE_NAME,
    config: {
      'fl-business': testFlBusiness,
    },
  });
});

// Still needs tested. No longer needed in our workflow, but supported in general.
test.skip('Merge should combine two trading-partners and get rid of one of them', async (t) => {
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

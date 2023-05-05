/*
 * @license
 * Copyright 2023 Qlever LLC
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

import type { JsonObject, OADAClient } from '@oada/client';
import { connect } from '@oada/client';
import { initialize as service } from '../dist/index.js';
import { setTimeout } from 'node:timers/promises';
import test from 'ava';

import config from '../dist/config.js';
const SUPPLIER = config.get('foodlogiq.testSupplier.id');
const TOKEN = process.env.TOKEN ?? ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const SERVICE_PATH = config.get('service.path') || '';
let oada: OADAClient;

test.before(async () => {
  oada = await connect({ domain: DOMAIN, token: TOKEN });
  await service({
    polling: false,
    target: false,
    mirrorWatch: false,
    watchConfig: false,
    master: true,
  });
  await setTimeout(5000);
});

test('Should produce a new trading partner and masterid for a new FL business.', async (t) => {
  const { data: businesses } = (await oada.get({
    path: `${SERVICE_PATH}/businesses`,
  })) as { data: JsonObject };

  if (!businesses)
    throw new Error(
      `Missing businesses endpoint in Food Logiq mirror: ${SUPPLIER}`
    );
  if (!businesses[SUPPLIER])
    throw new Error(`Missing test supplier in Food Logiq mirror: ${SUPPLIER}`);
  const supplier = businesses[SUPPLIER] as JsonObject;

  if (!supplier && !isObject(supplier))
    throw new Error(`Missing test supplier in Food Logiq mirror: ${SUPPLIER}`);

  const { _id } = supplier;

  await oada.delete({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/masterid`,
  });

  await oada.delete({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
  });

  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
    data: {
      _id,
      _rev: 0,
    },
  });

  await setTimeout(5000);

  const { data: bus } = (await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}`,
  })) as { data: JsonObject };

  t.truthy(Object.keys(bus).includes('masterid'));
});

function isObject(o: any): boolean {
  return typeof o === 'object' && !Array.isArray(o) && !Buffer.isBuffer(o);
}

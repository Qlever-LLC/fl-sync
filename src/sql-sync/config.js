/* Copyright 2021 Qlever LLC
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

import convict from 'convict';
import { config as load } from 'dotenv';

load();

const config = convict({
  trellis: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'proxy',
      env: 'DOMAIN',
      arg: 'domain',
    },
    token: {
      doc: 'OADA API token',
      format: String,
      default: 'god-proxy',
      env: 'TOKEN',
      arg: 'token',
    },
    concurrency: {
      doc: 'OADA client concurrency',
      format: Number,
      default: 1,
      env: 'CONCURRENCY',
      arg: 'concurrency'
    },
  },
});

config.validate({ allowed: 'warn' });

export default config;

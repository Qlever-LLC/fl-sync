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
import convictValidator from 'convict-format-with-validator';
import { config as load } from 'dotenv';

load();

convict.addFormats(convictValidator);


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
      format: Array,
      default: ['god-proxy'],
      env: 'TOKEN',
      arg: 'token',
    },
    endpoints: {
      tps: {
        doc: 'trading partner endpoint in trellis',
        default: "/bookmarks/trellisfw/trading-partners/",
      },
      utps: {
       default: "/bookmarks/trellisfw/trading-partners/unidentified-trading-partners-index",
       doc: 'unidentified trading partner endpoint in trellis',
      },
      'fl-bus': {
        default: "/bookmarks/services/fl-sync/businesses",
        doc: 'business mirror endpoint in trellis',
      }
    },
    justTps: {
      doc: `Don't retrieve TP resources, just mirror only the TPs themselves.`,
      format: Boolean,
      default: true,
      env: 'JUST_TPS',
      arg: 'justTPs',
    },
    concurrency: {
      doc: 'OADA client concurrency',
      format: Number,
      default: 1,
      env: 'CONCURRENCY',
      arg: 'concurrency'
    },
  },
  foodlogiq: {
    interval: {
      doc: 'polling interval',
      default: 30,
      env: 'INTERVAL',
      arg: 'interval',
    },
    domain: {
      doc: 'food logiq api domain or base url',
      default: `https://sandbox-api.foodlogiq.com`,
    },
    'assessment-template': {
      id: {
        doc: 'template _id in food logiq',
        default: "606cc945c8f60c000e53947f",
      },
      name: {
        default: "Certificate of Insurance (COI) Requirements",
        doc: 'template name in food logiq',
      },
    },
    community: {
      id: {
        doc: 'community _id in food logiq to be synced',
        default: "5fff03e0458562000f4586e9",
      },
      name: {
        doc: 'name of community in food logiq to be synced',
        default: "Smithfield Foods",
      },
      owner: {
        id: {
          doc: 'community owner business _id',
          default: "5acf7c2cfd7fa00001ce518d",
        },
        name: {
          doc: 'community owner name',
          default: "Smithfield Foods",
        }
      }
    },
    token: {
      doc: 'Food Logiq API token',
      format: String,
      default: ['-----'],
      env: 'FL_TOKEN',
    }
  }
});

config.validate({ allowed: 'warn' });

export default config;

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
import convictMoment from 'convict-format-with-moment'
import convictValidator from 'convict-format-with-validator';
import { config as load } from 'dotenv';

load();

convict.addFormats(convictValidator);
convict.addFormats(convictMoment);


const config = convict({
  delay: {
    doc: 'amount to delay between pages of documents',
    default: 0,
    format: Number,
    env: 'DELAY',
    arg: 'delay'
  },
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
    handleIncompleteInterval: {
      doc: 'On this regular interval, items from the process queue that failed at some point will be reprocessed',
      format: Number,
      default: 3600000,
      env: 'HANDLE_INCOMPLETE_INTERVAL',
      arg: 'handleIncompleteInterval'
    },
    reportInterval: {
      doc: 'Time interval for reports to be generated.',
      format: Number,
      default: 86400000,
      env: 'REPORT_INTERVAL',
      arg: 'reportInterval'
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
      env: 'FL_DOMAIN'
    },
    'assessment-template': {
      id: {
        doc: 'template _id in food logiq',
        default: "606cc945c8f60c000e53947f",
        env: 'FL_COI_ASSESSMENT'
      },
      name: {
        default: "Certificate of Insurance (COI) Requirements",
        doc: 'template name in food logiq',
        env: 'FL_COI_ASSESSMENT_NAME'
      },
    },
    community: {
      id: {
        doc: 'community _id in food logiq to be synced',
        default: "5fff03e0458562000f4586e9",
        env: 'FL_COMMUNITY'
      },
      name: {
        doc: 'name of community in food logiq to be synced',
        default: "Smithfield Foods",
        env: 'FL_COMMUNITY_NAME'
      },
      owner: {
        id: {
          doc: 'community owner business _id',
          default: "5acf7c2cfd7fa00001ce518d",
          env: 'FL_OWNER'
        },
        name: {
          doc: 'community owner name',
          default: "Smithfield Foods",
          env: 'FL_OWNER_NAME'
        }
      }
    },
    supportedTypes: {
      doc: "Array of supported FL document types",
      format: Array,
      default: ["Certificate of Insurance"],
      env: "flTypes"
    },
    token: {
      doc: 'Food Logiq API token',
      format: String,
      default: '-----',
      env: 'FL_TOKEN',
    },
    trellisUser: {
      doc: 'User ID used by Trellis automation',
      format: String,
      default: "5e27480dd85523000155f6db",
      env: 'FL_TRELLIS_USER'
    }
  },
  slack: {
    posturl: {
      format: 'url',
      // Use a real slack webhook URL
      default: 'https://localhost',
      env: 'SLACK_WEBHOOK',
      arg: 'slack-webhook',
    },
  },
  timeouts: {
    mirrorWatch: {
      doc: 'Timeout duration for mirror handler jobs',
      format: 'duration',
      // The types for duration suck
      default: 3_600_000 as unknown as number,
      env: 'MIRROR_WATCH_TIMEOUT',
      arg: 'mirror-watch-timeout',
    },
  },
});

config.validate({ allowed: 'warn' });

export default config;

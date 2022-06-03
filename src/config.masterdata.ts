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
  service: {
    'name': {
      doc: 'service name',
      format: String,
      default: 'sap-sync',
      env: 'SERVICE_NAME',
      arg: 'SERVICE_NAME',
    },
    'path': {
      doc: 'service path',
      format: String,
      default: '/bookmarks/services/fl-sync',
      env: 'SERVICE_PATH',
      arg: 'SERVICE_PATH',
    },
    'startup-mode': {
      doc: 'startup mode',
      format: String,
      default: 'init',
      env: 'STARTUP',
      arg: 'startup',
    },
  },
  trellis: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'dev.trellis.one',
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
    endpoints: {
      'tps': {
        doc: 'trading partner endpoint in trellis',
        default: '/bookmarks/trellisfw/trading-partners',
      },
      'utps': {
        default:
          '/bookmarks/trellisfw/trading-partners/unidentified-trading-partners-index',
        doc: 'unidentified trading partner endpoint in trellis',
      },
      'fl-bus': {
        default: '/bookmarks/services/fl-sync/businesses',
        doc: 'business mirror endpoint in trellis',
      },
      'tpmidi': {
        doc: 'masterid-index endpoint in trading partners in trellis',
        default: '/bookmarks/trellisfw/trading-partners/masterid-index',
      },
      'service-tp': {
        doc: 'service trading partners endpoint',
        default: '/bookmarks/services/sap-sync/other/trading-partners',
      },
      'service-pr': {
        doc: 'service products endpoint',
        default: '/bookmarks/services/sap-sync/other/products',
      },
      'service-lo': {
        doc: 'service locations endpoint',
        default: '/bookmarks/services/sap-sync/other/locations',
      },
      'service-datasources-tp': {
        doc: 'service datasource trading partners endpoint',
        default: '/bookmarks/services/sap-sync/datasources/vendors',
      },
      'service-datasources-pr': {
        doc: 'service datasource products endpoint',
        default: '/bookmarks/services/sap-sync/datasources/products',
      },
      'service-datasources-lo': {
        doc: 'service datasource locations endpoint',
        default: '/bookmarks/services/sap-sync/datasources/locations',
      },
    },
    requiredendpoints: {
      doc: 'required endpoints',
      format: Array,
      default: [
        '/bookmarks/services/sap-sync/mirror',
        '/bookmarks/services/sap-sync/mapping-tables/suppliers',
        '/bookmarks/services/sap-sync/indexes',
        '/bookmarks/services/sap-sync/other',
        '/bookmarks/services/sap-sync/other/trading-partners/expand-index',
        '/bookmarks/services/sap-sync/other/trading-partners/masterid-index',
        '/bookmarks/services/sap-sync/other/trading-partners/local-masterid-index',
        '/bookmarks/services/sap-sync/other/products',
        '/bookmarks/services/sap-sync/other/products/expand-index',
        '/bookmarks/services/sap-sync/other/products/masterid-index',
        '/bookmarks/services/sap-sync/other/locations',
        '/bookmarks/services/sap-sync/other/customers',
        '/bookmarks/services/sap-sync/matching-issues/day-index',
        '/bookmarks/trellisfw/trading-partners/expand-index',
        '/bookmarks/trellisfw/trading-partners/masterid-index',
        '/bookmarks/services/fl-sync/businesses',
        '/bookmarks/services/sap-sync/datasources/vendors',
        '/bookmarks/services/sap-sync/datasources/products',
        '/bookmarks/services/sap-sync/datasources/locations',
        '/bookmarks/services/sap-sync/datasources/customers',
      ],
    },
    concurrency: {
      doc: 'OADA client concurrency',
      format: Number,
      default: 1,
      env: 'CONCURRENCY',
      arg: 'concurrency',
    },
  },
  foodlogiq: {
    domain: {
      doc: 'food logiq api domain or base url',
      default: `https://sandbox-api.foodlogiq.com`,
    },
    community: {
      id: {
        doc: 'community _id in food logiq to be synced',
        default: '5fff03e0458562000f4586e9',
      },
      name: {
        doc: 'name of community in food logiq to be synced',
        default: 'Smithfield Foods',
      },
      owner: {
        id: {
          doc: 'community owner business _id',
          default: '5acf7c2cfd7fa00001ce518d',
        },
        name: {
          doc: 'community owner name',
          default: 'Smithfield Foods',
        },
      },
    },
    token: {
      doc: 'Food Logiq API token',
      format: Array,
      default: ['-----'],
      env: 'FL_TOKEN',
    },
  },
  timeouts: {
    vendor: {
      doc: 'Timeout duration for vendor jobs',
      format: Number,
      default: 3_600_000 as unknown as number,
      env: 'VENDOR_TIMEOUT',
      arg: 'vendor-timeout',
    },
    product: {
      doc: 'Timeout duration for product jobs',
      format: Number,
      default: 3_600_000 as unknown as number,
      env: 'PRODUCT_TIMEOUT',
      arg: 'product-timeout',
    },
    location: {
      doc: 'Timeout duration for product jobs',
      format: Number,
      default: 3_600_000 as unknown as number,
      env: 'LOCATION_TIMEOUT',
      arg: 'location-timeout',
    },
  },
  slack: {
    posturl: {
      format: String,
      // Use a real slack webhook URL
      default: 'https://localhost',
      env: 'SLACK_WEBHOOK',
      arg: 'slack-webhook',
    },
  },
});

config.validate({ allowed: 'warn' });

export default config;

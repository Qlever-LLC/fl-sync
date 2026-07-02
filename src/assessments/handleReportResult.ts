/**
 * @license
 * Copyright 2024 Qlever LLC
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
import '@oada/pino-debug';
import type {
  AttachmentResources,
  AutoLiability,
  CoiAssessment,
  EmployersLiability,
  ErrObj,
  ExcelRow,
  ExtractPdfResult,
  FlDocComment,
  FlDocument,
  FlDocumentError,
  FlQuery,
  GeneralLiability,
  Limit,
  LimitResult,
  Policy,
  PolicyType,
  ReportDataSave,
  TargetJob,
  TrellisCOI,
  UmbrellaLiability,
  WorkersCompensation,
} from '../types.js';
import { type ErrorObject, serializeError } from 'serialize-error';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { groupBy, minimumDate, sum } from '../utils.js';
import config from '../config.js';
import { connect } from '@oada/client';
import debug from 'debug';
import { doJob } from '@oada/client/jobs';
// @ts-expect-error jsonpath lacks types
import jp from 'jsonpath';

import Excel from 'exceljs';
import JsZip from 'jszip';
import type { OADAClient } from '@oada/client';
const { domain, token } = config.get('trellis');
const FL_TOKEN = config.get('foodlogiq.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');

const fail = 'FFb96161';
const passFill = 'FF80a57d';
const warnFill = 'FFffff93';
const actionFill = 'FFffffa6';

const limits: Record<string, Limit> = {
  '$.policies.cgl.each_occurrence': {
    limit: 2_000_000,
    title:
      'General Liability\n(Per Occurrence)\n(Greater than or equal\nto 2000000)',
    name: 'General Liability',
    longname: 'General Liability (Per Occurrence)',
    path: '$.policies.cgl.each_occurrence',
    type: 'cgl',
  },
  '$.policies.cgl.general_aggregate': {
    limit: 5_000_000,
    title: 'General Liability\n(Aggregate)\n(Greater than or equal\nto 5000000)',
    name: 'General Liability',
    longname: 'General Liability (Aggregate)',
    path: '$.policies.cgl.general_aggregate',
    type: 'cgl',
  },
  '$.policies.al.combined_single_limit': {
    limit: 1_000_000,
    title: 'Automobile Liability\n(Greater than or equal\nto 1000000)',
    name: 'Automobile Liability',
    path: '$.policies.al.combined_single_limit',
    type: 'al',
  },
  '$.policies.el.el_each_accident': {
    limit: 1_000_000,
    title: `Employer's Liability\n(Greater than or equal\nto 1000000)`,
    name: `Employer's Liability`,
    path: '$.policies.el.el_each_accident',
    type: 'el',
  },
};

const coiReportColumns = {
  'Trading Partner': 40,
  'FoodLogiq Document Link': 35,
  'Grouped FoodLogiq\nDocuments': 18,
  'Recommended Action': 18,
  'ACTION SELECTION': 18,
  'Rejection Reasons': 30,
  'Custom Message': 30,
  'Minimum Policy\nExpiration Date': 15,
  'Different FoodLogiq\nExpiration Date': 20,
  ...Object.fromEntries(Object.values(limits).map(({ title }) => [title, 20])),
  'Umbrella Liability': 15,
  'Workers Compensation\n(per Statutory Requirements)\n(Is equal to Yes)': 20,
  'FoodLogiq Comments': 30,
  'Attachment Parsing Details': 30,
  'Additional FoodLogiq \nDocs Considered': 20,
}

const info = debug('fl-sync:info');
const error = debug('fl-sync:error');
const warn = debug('fl-sync:warn');
let oada: OADAClient;
try {
  oada = await connect({ domain, token });
} catch (error_) {
  error(error_);
}

export async function rejectDoc() {

}

export async function approveDoc() {

}

/*
export async function archiveDoc(_id: string) {
  const request : AxiosRequestConfig = {
    method: 'put',
    url: `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${_id}/archive/true`,
    data: {},
    headers: {
      Authorization: `${FL_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  return axios<FlQuery>(request);
}
  */

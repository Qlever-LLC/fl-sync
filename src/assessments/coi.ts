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
  AutoLiability,
  EmployersLiability,
  ExcelRow,
  FlDocComment,
  FlDocument,
  FlObject,
  FlQuery,
  GeneralLiability,
  Limit,
  Policy,
  PolicyType,
  TargetJob,
  TrellisCOI,
  UmbrellaLiability,
  WorkersCompensation,
} from '../types.js';
import { 
  type AxiosRequestConfig,
  isAxiosError
} from 'axios';
import {
  type ErrorObject,
  serializeError
} from 'serialize-error'
import {
  groupBy,
  minimumDate,
  sum
} from '../utils.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { default as axios } from 'axios';
import config from '../config.js';
import { connect } from '@oada/client';
import debug from 'debug';
import { doJob } from '@oada/client/jobs';
import Excel from 'exceljs';
// @ts-expect-error jsonpath lacks types
import jp from 'jsonpath';
import JsZip from 'jszip';

import type { Job } from '@oada/jobs';
import type { OADAClient } from '@oada/client';
const { domain, token } = config.get('trellis');
const FL_TOKEN = config.get('foodlogiq.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');

const filename = `cois-report-${new Date().toISOString()}.xlsx`
// Let fname = 'cois-08-09-2024.json';
const fail = 'FFb96161';
const pass = 'FF80a57d';
const warnFill = 'FFffff93';
const actionFill = 'FFffff00';

const limits : Record<string, Limit> = {
  '$.policies.cgl.each_occurrence': {
    limit: 2_000_000,
    title: 'General Liability\n(Per Occurrence)\n(Greater than or equal\nto 2000000)',
    name: 'General Liability',
    path: '$.policies.cgl.each_occurrence',
    type: 'cgl',
  },
  '$.policies.cgl.general_aggregate': {
    limit: 5_000_000,
    title: 'General Liability\n(General Aggregate)\n(Greater than or equal\nto 5000000)',
    name: 'General Liability',
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
  }
}

const coiReportColumns = {
  'Trading Partner': 40,
  'FoodLogiq Document Links': 35,
  'Grouped FoodLogiq\nDocuments': 18,
  'Recommended Action': 18,
  'ACTION SELECTION': 18,
  'Rejection Reasons': 30,
  'Minimum Policy\nExpiration Date': 15,
  'Different FoodLogiq\nExpiration Date': 20,
  ...Object.fromEntries(
    Object.values(limits).map(({ title }) => [title, 20])
  ),
  'Umbrella Liability': 15,
  'Workers Compensation\n(per Statutory Requirements)\n(Is equal to Yes)': 20,
  'Comments': 30
}

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
const warn = debug('fl-sync:warn');
let oada: OADAClient;
try {
  oada = await connect( { domain, token});
} catch(error_) {
  error(error_);
}

export async function gatherCoiRecords(fname: string) {
  const cois = await getFlCois(fname, []); 
  writeFileSync(fname, JSON.stringify(cois));
}

interface COI {
  _id: string;
  flCoi: FlDocument;
  attachments?: Record<string, TrellisCOI | ErrorObject>;
  combined?: TrellisCOI;
  jobs?: Record<string, string | ErrorObject | undefined>;
  error?: ErrorObject;
  thisCoiOnlyCombined?: TrellisCOI;
  part?: string;
}

async function getFlCois(fname: string, coiResults?: COI[], pageIndex?: number) {
  coiResults ||= [];
  const request : AxiosRequestConfig = {
    method: 'get',
    url: `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents?sourceCommunities=5fff03e0458562000f4586e9&approvalStatus=awaiting-review&shareSourceTypeId=60653e5e18706f0011074ec8`,
    headers: { Authorization: `${FL_TOKEN}` },
  };

  if (pageIndex) {
    request.params = { pageIndex };
  }

  const { data }  = await axios<FlQuery>(request)

  // Manually check for changes; Only update the resource if it has changed!
  let index = 0;
  for await (const flCoi of data.pageItems) {
    try {
      index++;
      info(`processing coi ${(((pageIndex ?? 0))*50) + index} / ${data.totalItemCount} (${(((((pageIndex ?? 0))*50) + index)/(data.totalItemCount) * 100).toFixed(2)} %)`);
      const pdfs = await fetchAttachments(flCoi);
      coiResults.push({
        _id: flCoi._id,
        ...await processCoi(flCoi, pdfs)
      });
    } catch (cError: unknown) {
      coiResults.push({
        _id: flCoi._id,
        flCoi,
        error: serializeError(cError),
      });
    }
  }

  writeFileSync(fname, JSON.stringify(coiResults));
  // Repeat for additional pages of FL results
  if (data.hasNextPage) {
    await getFlCois(fname, coiResults, data.nextPageIndex);
  }

  return coiResults;
}

async function fetchAttachments(item: FlObject): Promise<string[]> {
  try {
    const { data: zipFile } = await axios<Uint8Array>({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseEncoding: 'binary',
    })

    const zip = await new JsZip().loadAsync(zipFile);
    const files = Object.keys(zip.files);

    const resources: string[] = [];

    for await (const fKey of files) {

      if (!fKey) {
        info(`Could not get file key for item ${item._id}`);
        continue
      }

      // Prepare the pdf resource
      const ab = await zip.file(fKey)!.async('uint8array');
      const zdata = Buffer.alloc(ab.byteLength).map((_, index) => ab[index]!);

      try {
        const { headers } = await oada.post({
          path: `/resources`,
          data: zdata,
          contentType: 'application/pdf',
        });
        const _id = headers['content-location']!.replace(/^\//, '');
        resources.push(_id);
      } catch (cError) {
        throw Buffer.byteLength(zdata) === 0
          ? new Error(`Attachment Buffer data 'zdata' was empty.`)
          : (cError);
      }
    }

    return resources;
  } catch (error_: unknown) {
    if (isAxiosError(error_) && error_.response?.status === 404) {
      info(`Bad attachments on item ${item._id}. Throwing Error`);
      throw new Error('FL Attachments no longer exist');
    } else throw error_;
  }
}

async function getFlDoc(_id: string) {
  return axios<FlDocument>({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${_id}`,
    headers: { Authorization: FL_TOKEN },
  })
}

async function processCoi(flCoi: FlDocument, pdfs: string[]) {
  // 2. Post the pdfs

  const attachments: COI['attachments'] = {};
  const jobs : Record<string, string | ErrorObject | undefined> = {};

  for await (const _id of pdfs) {
    try {
      const { _id: jobId, result } = (await doJob(oada, {
        "service": "target",
        "type": "transcription-only",
        "config": {
          "type": "pdf",
          "pdf": {
            _id
          },
          "document-type": "application/vnd.trellisfw.coi.accord.1+json",
          "oada-doc-type": "cois"
        }
      })) as unknown as TargetJob;
      jobs[_id] = jobId;

      // Accumulate the attachments
      // Target result is like { cois: { abcx123: {_id: "resources/abc123"}}}
      if (result.cois) {
        for await (const [key, value] of Object.entries(result.cois)) {
          const { data: doc } = (await oada.get({
            path: `/${value._id}`,
          })) as unknown as { data: TrellisCOI };

          attachments[key] = doc;
        }
      } else {
        jobs[_id] = serializeError(result);
      }
    } catch (error_) {
      jobs[_id] = serializeError(error_);
      attachments[_id] = serializeError(error_);
      error(error_);
    }
  }

  // Now go fetch all of the links


  return { 
    flCoi,
    attachments, 
    combined: combineCois(Object.values(attachments)),
    jobs,
  }
}

/*
 * Does a few things:
 * - filters out improperly extracted dates resulting in dates with year 1900
 * - filters out expired policies
*/
function combineCois(mixedCois: Array<TrellisCOI | ErrorObject>): TrellisCOI {
  const cois: TrellisCOI[] = mixedCois.filter(coi => '_id' in coi) as TrellisCOI[]
    
  return {
    _id: cois.map(coi => coi._id).join(';'),
    policies: {
      expire_date: cois
        .flatMap(coi => Object.values(coi.policies || {}))
        .filter(p => typeof p !== 'string')
        .filter(p => new Date(p.expire_date) > new Date())
        .map((policy: Policy) => policy.expire_date)
        .filter((date: string) => {
          const wierdDate = new Date(date).getFullYear() === 1900;
          return !wierdDate;
        })
        .sort((a: string, b: string) => 
          new Date(a).getTime() - new Date(b).getTime()
        )[0]!,
      cgl: composePolicy(cois, 'Commercial General Liability') as GeneralLiability,
      al: composePolicy(cois, 'Automobile Liability') as AutoLiability,
      el: composePolicy(cois, `Employers' Liability`) as EmployersLiability,
      ul: composePolicy(cois, 'Umbrella Liability') as UmbrellaLiability,
      wc: composePolicy(cois, `Worker's Compensation`) as WorkersCompensation,
    },
  };
}

// Compose a single policy of a particular type from an array of COIs (each with 
// several policies of different types).
// -filters out already-expired policies
// -gives last expiration date if there were only expired policies
// -should it handle uploading the same PDF twice?? i.e., idempotent merge on policy ID or something?
function composePolicy(cois: TrellisCOI[], type: PolicyType): Policy {
  let policies : Policy[] = cois
    .flatMap(coi => Object.values(coi.policies || {}))
    .filter(p => typeof p !== 'string') as Policy[];

  policies = policies.filter((p)=> p.type === type)
 
  const activePolicies = policies.filter((p) => new Date(p.expire_date) > new Date() || hasBadDates([p.expire_date]));

  const combined: Policy = activePolicies[0]!;

  if (activePolicies.length === 0 && policies.length > 0) {
    for (const pol of policies) {
      combined.expire_date = minimumDate(combined.expire_date, pol.expire_date);
    }

    return combined;
  }

  for (const pol of activePolicies) {
    combined.effective_date = minimumDate(combined.effective_date, pol.effective_date);
    combined.expire_date = minimumDate(combined.expire_date, pol.expire_date);
    switch(type) {
      case 'Commercial General Liability': {
        combined.each_occurrence = sum(combined, pol, 'each_occurrence') 
        combined.general_aggregate = sum(combined, pol, 'general_aggregate'); 
        combined["products_-_compop_agg"] = sum(combined, pol, "products_-_compop_agg");
        break;
      }

      case 'Automobile Liability': {
        combined.combined_single_limit = sum(combined, pol, 'combined_single_limit');
        break;
      }

      case 'Umbrella Liability': {
        combined.each_occurrence = sum(combined, pol as UmbrellaLiability, 'each_occurrence');
        break;
      }

      case "Employers' Liability": {
        combined.el_each_accident = sum(combined, pol as EmployersLiability, 'el_each_accident');
        break;
      }

      case "Worker's Compensation": {
        break;
      }
    }
  }

  return combined;
}


function hasBadDates(allExpirations: string[]): boolean {
  return allExpirations.some(date => new Date(date).getFullYear() === 1900);
}

async function generateCoiReport(path: string) {
  const json = readFileSync(path, 'utf8');
  const data = JSON.parse(json);
  const results : Array<Record<string, ExcelRow>> = [];
  for await (const item of data) {
    results.push(await assessCoi(item));
  }

  await writeExcelFile(results, coiReportColumns, filename);
}

// eslint-disable-next-line complexity
async function assessCoi({
  _id,
  flCoi,
  combined,
  thisCoiOnlyCombined,
  error,
  attachments,
  part,
}: COI /*{
  _id: string,
  coi: FlDocument, 
  combined: TrellisCOI,
  thisCoiOnlyCombined: TrellisCOI,
  attachments: any,
  error: any,
  part: string,
}*/): Promise<Record<string, ExcelRow>> {
  trace(error, attachments);

  if (!flCoi) {
    const { data } = await getFlDoc(_id);
    flCoi = data
  }

  const reasons = [];
  // Check if the coverages are satisfactory
  const umbrella = Number.parseInt(String(combined?.policies?.ul?.each_occurrence ?? '0'), 10);
  const limitResults = Object.fromEntries(
    Object.entries(limits).map(([path, limit]) => {
      const value = (jp.query(combined ?? {}, path))[0] ?? '';
      // Compute the "effective" coverage with umbrella liability included
      const effValue = Number.parseInt(value ?? '0') + umbrella;

      const expireDate = combined?.policies?.[limit.type as 'el' | 'al' | 'cgl']?.expire_date;
      const expired = new Date(expireDate) < new Date();
      const dateParseWarning = hasBadDates([expireDate]);

      if (expired && !dateParseWarning) reasons.push(`${limit.name} policy expired ${expireDate.split('T')[0]}`)

      const pass = !dateParseWarning && effValue >= limit.limit;
      if (!pass && !Number.isNaN(effValue)) {
        reasons.push(
          `Insufficient ${limit.name} coverage (${limit.limit} required). Coverage${
            umbrella > 0 ? ' including Umbrella policy' : ''
          } is only ${effValue}`
        )
      }


      return [
        limit.title, 
        {
          ...limit,
          pass,
          value: expired 
            ? dateParseWarning
              ? `${value} (Confirm Effective Dates)`
              : `Expired ${expireDate.split('T')[0]}`
            : value,
          dateParseWarning,
        }
      ]
    })
  );

  //const allExpirations = Object.values(attachments || {}).flatMap((obj: any) =>
  //  Object.values(obj.policies || {}).map((policy) => (policy as Policy).expire_date)
  //)
  
  let allExpirations = Object.values(combined.policies || {})
    .filter(p => p)
    .filter((policy) => typeof policy !== 'string' && 'expire_date' in (policy as Policy))
    .map((policy) => (policy as Policy).expire_date);

  const warnBadDate = hasBadDates(allExpirations);
  allExpirations = allExpirations.filter(d => (new Date(d).getFullYear() !== 1900))

  const parsingError = allExpirations.length === 0;

  if (parsingError) {
    reasons.push('PDF Parsing error')
  }

  const minExpiration = allExpirations
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];

  const limitsPassed = Object.values(limitResults).every(({ pass }) => pass)

  // Verify Expiration Dates
  const expiryPassed = minExpiration// Combined?.policies?.expire_date
    && new Date(minExpiration) > new Date();
    // && new Date(combined.policies.expire_date) > new Date();
 
  const flExp = new Date(flCoi.expirationDate)
  const flExpString = flExp.toISOString().split('T')[0];
  flExp.setHours(0);
  
  const expiryMismatch = thisCoiOnlyCombined ? new Date(thisCoiOnlyCombined.policies.expire_date) < flExp : undefined;
  
  if (expiryMismatch) {
    warn(`The policy expiration date does not match the FL expiration date.`)
  }

  // Verify Worker's Compensation coverage
  const workersExists = combined?.policies?.wc?.expire_date
  if (!workersExists && !parsingError) reasons.push(`Worker's Comp policy required.`);
  let workersExpired;
  if (workersExists) {
    const workersExpireDate = combined.policies.wc.expire_date;
    const workersExpireDateBad = hasBadDates([workersExpireDate]);
    workersExpired = new Date(combined.policies.wc.expire_date) < new Date();
    if (workersExpired && !workersExpireDateBad)
      reasons.push(`Worker's Comp policy is expired ${workersExpireDate.split('T')[0]}`);
  }

  const workersPassed = workersExists && !workersExpired;

  const assessment = {
    passed: Boolean(limitsPassed && expiryPassed && workersPassed),
    reasons: reasons.length > 0 ? reasons.join('; ') : '',
  }


  return {
    'Trading Partner': {
      value: flCoi?.shareSource?.sourceBusiness?.name,
    },

    'FoodLogiq Document Links': {
      value: flCoi?.name,
      hyperlink: 
        `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${_id}/${COMMUNITY_ID}`,
    },

    'Grouped FoodLogiq\nDocuments': {
      value: part 
    },

    'Recommended Action': {
      value: assessment.passed ?
        'Approve'
        : parsingError ? 'Ignore' : 'Reject',
    },


    'ACTION SELECTION': {
      value: assessment.passed ?
        'Approve'
        : parsingError ? 'Ignore' : 'Reject',
      dropdown: {
        formulae: '"Ignore,Approve,Reject"'
      },
    },
    
    'Rejection Reasons': {
      value: assessment.passed 
        ? ''
        : assessment.reasons || '',
      //...(assessment.passed ? {fill: pass}: parsingError ? {fill: warnFill } : {}), // {fill: fail}),
    },

    'Minimum Policy\nExpiration Date': {
      value: minExpiration ? minExpiration.split('T')[0] : '',
      ...(expiryPassed === undefined ? {} 
        : expiryPassed ? {}
          : parsingError ? {}
            : { fill: fail }
      ),
    },

    'Different FoodLogiq\nExpiration Date': {
      value: expiryMismatch ? flExpString : '',
      ...(expiryMismatch ? {fill: fail} : {}),
    },

    ...Object.fromEntries(Object.entries(limitResults)
      .map(([, object]) => (
        [
          object?.title, 
          {
            value: object?.value,
            ...(object.pass 
              ? {}
              : object.dateParseWarning
                ? {fill: warnFill}
                : parsingError
                  ? {}
                  : {fill: fail}
            ),
          }
        ])
      )
    ),

    'Umbrella Liability (Per Accident) (Greater than or equal\nto 1000000)': {
      value: combined?.policies?.ul?.each_occurrence,
    },

    'Workers Compensation (per Statutory Requirements) (Is equal to Yes)': {
      value: workersPassed ? 'Yes' : 'No',
      ...(workersPassed ? {} : parsingError ? {} : { fill: fail }),
    },

    'Comments': gatherComments(flCoi),
  } 
}

function gatherComments(coi: FlDocument) {
  const comments = Object.values(coi.comments || {})
    .map((comsArray: FlDocComment[]) => comsArray
      .map(com => `${com.createdBy.firstName} ${com.createdBy.lastName}: ${com.comment}`).join('\n')
    )

  return {
    value: comments.join('\n')
  }
}

async function writeExcelFile(rows: Array<Record<string, ExcelRow>>, columns: Record<string, number>, fname: string) {
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet("Report", {
    views:[{
      state: 'frozen',
      xSplit: 1,
    }]
  });

  worksheet.columns = Object.entries(columns).map(
    ([header, width]) => ({ header, width })
  )

  const startRow = 2;
  const startCol = 1;

  for (const [rowIndex, row] of rows.entries()) {
    for (const [colIndex, { value, fill, hyperlink, dropdown }] of Object.values(row).entries()) {
      const cell = worksheet.getCell(
        startRow + rowIndex,
        startCol + colIndex,
      );
      if (hyperlink) {
        cell.value = {
          text: value,
          hyperlink,
        }
      } else {
        cell.value = value;
      }

      if (fill) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fill }
        }
      }

      if (dropdown) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [dropdown.formulae]
        } 
      }
    }
  }

  // Changing this appears to change the font different from the rest, so I apparently need to specify it now...
  worksheet.getColumn(5).font = { bold: true, name: 'Calibri' };

  worksheet.getColumn(5).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: actionFill }
  }

  worksheet.getRow(1).height = 40;

  // Save the modified workbook
  await workbook.xlsx.writeFile(fname);
}

/* 
 * The original setup in generateCoisReport used the attachments on a single FL doc; Instead, let's combine documents
 * across the trading partner to handle multiple FL docs.
 */
export async function recombineGenerateCoisReport(path: string) {
  const json = readFileSync(path, 'utf8');
  const data = JSON.parse(json) as COI[];
  const results : Array<Record<string, ExcelRow>> = [];

  const grouped : Record<string, COI[]> = groupBy(
    data,
    (item) => item.flCoi?.shareSource?.sourceBusiness?.name
  )

  for await (const tp of Object.values(grouped)) {
    const attachments = tp.flatMap(item => Object.values(item.attachments || {}));
    const combined = combineCois(attachments as TrellisCOI[]);
    for await (const [i, item] of tp.entries()) {
      results.push(await assessCoi({
        ...item,
        attachments,
        combined,
        thisCoiOnlyCombined: combineCois(Object.values(item.attachments || {})),
        part: tp.length <= 1 ? '' : (i+1).toLocaleString(),
      }));
    }
  }

  await writeExcelFile(results, coiReportColumns, filename);
}
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
  Policy,
  PolicyType,
  ReportDataSave,
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
  serializeError,
  isErrorLike
} from 'serialize-error'
import {
  groupBy,
  minimumDate,
  sum
} from '../utils.js';
import { default as axios } from 'axios';
import config from '../config.js';
import { connect } from '@oada/client';
import debug from 'debug';
import { doJob } from '@oada/client/jobs';
// @ts-expect-error jsonpath lacks types
import jp from 'jsonpath';
import { writeFileSync } from 'node:fs';

import Excel from 'exceljs';
import JsZip from 'jszip';
import type { OADAClient } from '@oada/client';
const { domain, token } = config.get('trellis');
const FL_TOKEN = config.get('foodlogiq.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');

const filename = `cois-report-${new Date().toISOString()}.xlsx`
// Let fname = 'cois-08-09-2024.json';
const fail = 'FFb96161';
const passFill = 'FF80a57d';
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
const error = debug('fl-sync:error');
const warn = debug('fl-sync:warn');
let oada: OADAClient;
try {
  oada = await connect( { domain, token});
} catch(error_) {
  error(error_);
}

/*
 *  Fetch some Food Logiq COIs
*/ 
async function getFlCois(
  queryString: string,
  coiResults?: Record<string, FlDocument>,
  pageIndex?: number
): Promise<Record<string, FlDocument>> {
  coiResults ||= {};
  const request : AxiosRequestConfig = {
    method: 'get',
    url: `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents${queryString}`,
    headers: { Authorization: `${FL_TOKEN}` },
  };

  if (pageIndex) {
    request.params = { pageIndex };
  }

  const { data }  = await axios<FlQuery>(request)

  for await (const flCoi of data.pageItems) {
    coiResults[flCoi._id] = flCoi;
  }

  // Repeat for additional pages of FL results
  if (data.hasNextPage) {
    await getFlCois(queryString, coiResults, data.nextPageIndex);
  }

  return coiResults;
}

/*
 * Fetch the attachments associated with a particular Food Logiq document.
 * For each attachment, return the OADA resource ID where the binary was stored.
*/ 
async function fetchAndExtractAttachments(item: FlDocument | FlDocumentError): Promise<AttachmentResources> {
  const attachments: AttachmentResources = {};

  let zipFile: Uint8Array;
  try {
    const { data } = await axios<Uint8Array>({
      method: 'get',
      url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
      headers: { Authorization: FL_TOKEN },
      responseEncoding: 'binary',
    })
    zipFile = data;
  } catch (error_: unknown) {
    if (isAxiosError(error_) && error_.response?.status === 404) {
      info(`Bad attachments on item ${item._id}. Returning with no attachments`);
      return {
        msg: `Bad attachments on item ${item._id}.`,
        serialized: serializeError(error_),
      };
    } 

    info(`Errored on item ${item._id}. Returning with no attachments`);
    return {
      serialized: serializeError(error_),
    }
  }

  const zip = await new JsZip().loadAsync(zipFile);
  const files = Object.keys(zip.files);

  for await (const fKey of files) {

    if (!fKey) {
      info(`Could not get file key for item ${item._id}`);
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] = { msg: `Could not get file key for item ${item._id}` };
      continue;
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

      info(`Extracting binary data for FL Doc ${item._id}. Attachment ${fKey}`);
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] = await extractPdfData(_id);
    } catch (cError) {
      (attachments as Record<string, ExtractPdfResult | ErrObj>)[fKey] = Buffer.byteLength(zdata) === 0
        ? { 
          msg: `Attachment data was corrupt or empty.`,
          serialized: serializeError(cError),
        }
        : { serialized: serializeError(cError) }
      continue;
    }
  }

  return attachments;
}

async function getFlDoc(_id: string) {
  return axios<FlDocument>({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${_id}`,
    headers: { Authorization: FL_TOKEN },
  })
}

async function extractPdfData(_id: string): Promise<ExtractPdfResult> {
  try {
    const job = (await doJob(oada, {
      "service": "target",
      "type": "transcription-only",
      "config": {
        "type": "pdf",
        "pdf": { _id },
        "document-type": "application/vnd.trellisfw.coi.accord.1+json",
        "oada-doc-type": "cois"
      }
    })) as unknown as TargetJob;

    // Accumulate the attachments
    // Target result is like { cois: { abcx123: {_id: "resources/abc123"}}}
    const results : ExtractPdfResult["results"] = {};
    if (job.result.cois) {
      for await (const [key, value] of Object.entries(job.result.cois)) {
        const { data: doc } = (await oada.get({
          path: `/${value._id}`,
        })) as unknown as { data: TrellisCOI };

        (results as Record<string, TrellisCOI>)[key] = doc;
      }

      return { job, results };
    }

    return {
      job,
      results: { 
        serialized: serializeError(job.result)
      },
    }
  } catch (error_) {
    error(error_);
    return {
      results: { serialized: serializeError(error_) }
    }
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
      expire_date: policiesToExpirations(
        cois.flatMap(coi => Object.values(coi?.policies) as Policy[])
      )
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

// Take a bunch of COIs and find the minimum expiration date
function policiesToExpirations(policies: Policy[]) {
  return policies
    .filter(Boolean)
    .filter(p => typeof p !== 'string')
    .filter(p => typeof p !== 'string' && 'expire_date' in p)
    .filter(p => new Date(p.expire_date) > new Date())
    .map((policy: Policy) => policy.expire_date)
    .filter(d => (new Date(d).getFullYear() !== 1900))
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
        (combined as GeneralLiability).each_occurrence = sum(combined as GeneralLiability, pol as GeneralLiability, 'each_occurrence');
        (combined as GeneralLiability).general_aggregate = sum(combined as GeneralLiability, pol as GeneralLiability, 'general_aggregate'); 
        (combined as GeneralLiability)["products_-_compop_agg"] = sum(combined as GeneralLiability, pol as GeneralLiability, "products_-_compop_agg");
        break;
      }

      case 'Automobile Liability': {
        (combined as AutoLiability).combined_single_limit = sum(combined as AutoLiability, pol as AutoLiability, 'combined_single_limit');
        break;
      }

      case 'Umbrella Liability': {
        (combined as UmbrellaLiability).each_occurrence = sum(combined as UmbrellaLiability, pol as UmbrellaLiability, 'each_occurrence');
        break;
      }

      case "Employers' Liability": {
        (combined as EmployersLiability).el_each_accident = sum(combined as EmployersLiability, pol as EmployersLiability, 'el_each_accident');
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

// eslint-disable-next-line complexity
async function assessCoi({
  flCoi,
  combined,
  part
} : {
  flCoi: FlDocument,
  combined: TrellisCOI,
  part: string | number
}): Promise<Record<string, ExcelRow>> {
//  Trace(error, attachments);
  const { _id } = flCoi;

  if (!flCoi) {
    const { data } = await getFlDoc(_id);
    flCoi = data
  }

  let reasons: string[] = [];

  // Check if the coverages are satisfactory
  const umbrella = Number.parseInt(String(combined?.policies?.ul?.each_occurrence ?? '0'), 10);

  // Check policies against limits
  const limitCheck = checkPolicyLimits(combined, reasons, umbrella);
  const { limitResults } = limitCheck;
  reasons = limitCheck.reasons;
  const limitsPassed = Object.values(limitResults).every(({ pass }) => pass)

  // Gather expiration dates
  const {
    parsingError, 
    minExpiration,
    expiryPassed,
    expiryMismatch,
    flExpString
   } = checkExpirations(combined, flCoi);

  if (parsingError) {
    reasons.push('PDF Parsing error')
  }

  // Check Worker's Comp
  const workersCheck = checkWorkersComp(combined, parsingError, reasons);
  const { workersPassed } = workersCheck;
  reasons = workersCheck.reasons;

  // Make overall assessment
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
      // ...(assessment.passed ? {fill: passFill}: parsingError ? {fill: warnFill } : {}), // {fill: fail}),
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

function checkExpirations(coi: TrellisCOI | undefined, flCoi: FlDocument) {
  const allExpirations = policiesToExpirations(Object.values(coi?.policies ?? {}) as Policy[])

  const parsingError = allExpirations.length === 0;

  const minExpiration = allExpirations
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const minExpirationDate = minExpiration && new Date(minExpiration)

  // Verify Expiration Dates
  const expiryPassed = minExpirationDate && minExpirationDate > new Date()
 
  const flExp = new Date(flCoi.expirationDate)
  const flExpString = flExp.toISOString().split('T')[0];
  flExp.setHours(0);
  
  // Check if the FL Document expiration date does not match the minimum of the COI doc
  // False and undefined are treated the same
  const expiryMismatch = minExpirationDate && minExpirationDate < flExp;
  if (expiryMismatch) {
    warn(`The policy expiration date does not match the FL expiration date.`);
  }

  return { parsingError, flExpString, expiryPassed, minExpiration, expiryMismatch };
}

function checkPolicyLimits(coi: TrellisCOI | undefined, reasons: string[], umbrella: number) {
  const limitResults = Object.fromEntries(
    Object.entries(limits).map(([path, limit]) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const value = ((jp.query(coi?? {}, path))[0] as string) ?? '';
      // Compute the "effective" coverage with umbrella liability included
      const effValue = Number.parseInt(value ?? '0', 10) + umbrella;

      const expireDate = coi?.policies?.[limit.type as 'el' | 'al' | 'cgl'].expire_date;


      const expired = expireDate ? new Date(expireDate) < new Date() : true;
      const dateParseWarning = expireDate ? hasBadDates([expireDate]) : false;

      if (expireDate === undefined) {
        reasons.push(`${limit.name} policy has no expiration date`)
      } else if (expired && !dateParseWarning) {
        reasons.push(`${limit.name} policy expired ${expireDate.split('T')[0]}`)
      }

      const pass = !dateParseWarning && effValue >= limit.limit;
      if (!pass && !Number.isNaN(effValue)) {
        reasons.push(
          `Insufficient ${limit.name} coverage (${limit.limit} required). Coverage${
            umbrella > 0 ? ' including Umbrella policy' : ''
          } is only ${effValue}`
        )
      }


      // Compose the entry
      return [
        limit.title, 
        {
          ...limit,
          pass,
          value: expired 
            ? dateParseWarning
              ? `${value} (Confirm Effective Dates)`
              : `Expired ${expireDate ? expireDate.split('T')[0] : '(unknown)'}`
            : value,
          dateParseWarning,
        }
      ]
    })
  )

  return {
    limitResults,
    reasons
  }
}

function checkWorkersComp(coi: TrellisCOI | undefined, parsingError: boolean, reasons: string[]) {
  // Verify Worker's Compensation coverage
  const workersExists = coi?.policies?.wc?.expire_date
  if (!workersExists && !parsingError) reasons.push(`Worker's Comp policy required.`);
  let workersExpired;
  if (workersExists) {
    const workersExpireDate = coi.policies.wc.expire_date;
    const workersExpireDateBad = hasBadDates([workersExpireDate]);
    workersExpired = new Date(coi.policies.wc.expire_date) < new Date();
    if (workersExpired && !workersExpireDateBad)
      reasons.push(`Worker's Comp policy is expired ${workersExpireDate.split('T')[0]}`);
  }

  return { 
    workersPassed: workersExists && !workersExpired,
    reasons
  };
}

function gatherComments(coi: FlDocument) {
  const comments = Object.values(coi.comments ?? {})
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
      cell.value = hyperlink ? {
          text: value as string,
          hyperlink,
        } : value;

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
export async function generateCoisReport(fname: string) {
  // 1. Grab all FL COIs currently awaiting-review
  const flBaseQuery = 
    '?sourceCommunities=5fff03e0458562000f4586e9' + 
    '&approvalStatuses=awaiting-review' +
    '&shareSourceTypeId=60653e5e18706f0011074ec8';
  let flCois = await getFlCois(flBaseQuery); 
  writeFileSync(fname, JSON.stringify(flCois));

  // Load the saved JSON data 
  // const json = readFileSync(fname, 'utf8');
  // const data = JSON.parse(json) as COI[];

  // 2. Group COIs by supplier
  const grouped : Record<string, Array<FlDocument | FlDocumentError>> = groupBy(
    Object.values(flCois),
    (flCoi) => flCoi?.shareSource?.sourceBusiness?._id
  )

  const attachments : ReportDataSave["attachments"] = {};
  const queryDate = new Date().setMonth(new Date().getMonth() - 18);
  const excelData: Array<Record<string, ExcelRow>> = [];
  for await (const [busId, cois] of Object.entries(grouped)) {

    // 3. Grab additional COIs of other statuses from that supplier 
    //    that may contribute to the assessment.
    const flTradingPartnerQuery = 
      '?sourceCommunities=5fff03e0458562000f4586e9' +
      '&approvalStatuses=approved' +
      `&sourceBusinesses=${busId}` +
      '&shareSourceTypeId=60653e5e18706f0011074ec8' +
      '&shareSourceTypeId=60653e5e18706f0011074ec8' +
      `&expirationDate=${queryDate}..`;
    const moreFlCois = await getFlCois(flTradingPartnerQuery);

    flCois = {
      ...flCois,
      ...moreFlCois,
    }

    cois.push(...Object.values(moreFlCois));

    /*

    for await (const coi of Object.values(cois)) {
      const att = await fetchAndExtractAttachments(coi);
      attachments[coi._id] = att;
    }

    // Filter the actual TrellisCOI attachments

    const combined = combineCois(att);
    for await (const [index, coi] of cois.entries()) {
      excelData.push(await assessCoi({
        _id: coi._id,
        flCoi: coi.flCoi,
        combined: coi.combined,
        part: cois.length <= 1 ? '' : (index+1).toLocaleString(),
      }));
    }
  }
  
  await writeExcelFile({
    flCois,
    attachments,
    trellisCois
  }, coiReportColumns, filename);
  */
  }
}

interface COI {
  _id: string;
  flCoi: FlDocument;
  combined?: TrellisCOI;
  jobs?: Record<string, string | ErrorObject | undefined>;
  err?: ErrorObject;
}



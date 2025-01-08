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
import { 
  type AxiosRequestConfig,
  isAxiosError
} from 'axios';
import {
  type ErrorObject,
  serializeError,
} from 'serialize-error'
import { 
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
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

const limits : Record<string, Limit> = {
  '$.policies.cgl.each_occurrence': {
    limit: 2_000_000,
    title: 'General Liability\n(Per Occurrence)\n(Greater than or equal\nto 2000000)',
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
  }
}

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
  ...Object.fromEntries(
    Object.values(limits).map(({ title }) => [title, 20])
  ),
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
async function fetchAndExtractAttachments(
  item: FlDocument | FlDocumentError
): Promise<AttachmentResources> {
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
        cois.flatMap(coi => Object.values(coi?.policies || {}) as Policy[])
      ).sort((a: string, b: string) => 
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

function policiesToExpirations(policies: Policy[]) {
  return policies
    .filter(Boolean)
    .filter(p => typeof p !== 'string' && 'expire_date' in p)
    //.filter(p => new Date(p.expire_date) > new Date())
    .map((policy: Policy) => policy.expire_date)
    .filter(d => (new Date(d).getFullYear() !== 1900))
}

// Compose a single policy of a particular type from an array of COIs (each with 
// several policies of different types).
// -filters out already-expired policies
// -gives last expiration date if there were only expired policies
// -should it handle uploading the same PDF twice?? i.e., idempotent merge on policy ID or something?
function composePolicy(cois: TrellisCOI[], type: PolicyType): Policy | undefined {
  let policies : Policy[] = cois
    .flatMap(coi => Object.values(coi.policies || {}))
    .filter(p => typeof p !== 'string') as Policy[];

  policies = policies.filter((p)=> p.type === type)

  const uniques = new Set<string>();
  const activePolicies = policies
    .filter((p) => new Date(p.expire_date) > new Date() || hasBadDates([p.expire_date]))
    .filter((p) => {
      if ('number' in p) {
        if (uniques.has(p.number as string)) {
          return false
        }

        uniques.add(p.number as string)
      }
     
      return true;
    })


  if (Object.values(activePolicies).length === 0) {
    return undefined;
  }

  const combined: Policy = {} as unknown as Policy; //Object.values(activePolicies)[0]!;

  if (Object.values(activePolicies).length === 0 && policies.length > 0) {
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

function assessCoi({
  flCoi,
  attachments,
  combinedTrellisCoi,
} : {
  flCoi: FlDocument | FlDocumentError,
  attachments: TrellisCOI[],
  combinedTrellisCoi: TrellisCOI,
}): CoiAssessment {
  let reasons: string[] = [];

  // First check for expirations using only this FL COI's attachments
  const {
    minExpiration,
    expiryPassed,
    expiryMismatch,
    flExpiration,
   } = checkExpirations(flCoi as FlDocument, attachments);

  // Check if the coverages are satisfactory
  const umbrella = Number.parseInt(String(combinedTrellisCoi?.policies?.ul?.each_occurrence ?? '0'), 10);

  // Check policies against limits
  const limitCheck = checkPolicyLimits(combinedTrellisCoi, reasons, umbrella);
  const { limitResults } = limitCheck;
  reasons = limitCheck.reasons;
  const limitsPassed = Object.values(limitResults).every(({ pass }) => pass)

  const parsingError = false;

  if (parsingError) {
    reasons.push('PDF Parsing error')
  }

  // Check Worker's Comp
  const workersCheck = checkWorkersComp(combinedTrellisCoi, parsingError, reasons);
  const { workersPassed } = workersCheck;
  reasons = workersCheck.reasons;

  // Make overall assessment
  const assessment = {
    passed: Boolean(limitsPassed && expiryPassed && workersPassed),
    dateParseWarning: Object.values(limitResults).some(({dateParseWarning}) => dateParseWarning),
    reasons: reasons.length > 0 ? reasons.join('\n') : '',
  }

  return {
    assessment,
    minExpiration,
    expiryPassed,
    expiryMismatch,
    flExpiration,
    parsingError,
    limitResults,
    workersPassed,
  }
}

export function generateAssessmentRow({
  flCoi,
  combinedTrellisCoi,
  assessment,
  part,
  additionalCoisConsidered,
  attachmentStatuses,
  minExpiration,
  expiryPassed,
  expiryMismatch,
  flExpiration,
  parsingError,
  invalidHolder,
  limitResults,
  workersPassed,
} :
  CoiAssessment 
  & {
    flCoi: FlDocument | FlDocumentError,
    combinedTrellisCoi: TrellisCOI,
    part: string,
    additionalCoisConsidered: string,
    attachmentStatuses: Record<string, string>,
  }
): Record<string, ExcelRow> {

  return {
    'Trading Partner': {
      // @ts-ignore
      value: flCoi?.shareSource?.sourceBusiness?.name ?? 'Unknown (error retrieving FL Doc)',
    },

    'FoodLogiq Document Link': {
      value: 'name' in flCoi ? flCoi.name : flCoi._id,
      hyperlink: flIdToLink(flCoi._id),
    },

    'Grouped FoodLogiq\nDocuments': {
      value: part 
    },

    'Recommended Action': {
      value: assessment.passed ?
        'Approve'
        : parsingError || assessment.dateParseWarning ? 'Ignore' : 'Reject',
    },

    'ACTION SELECTION': {
      value: assessment.passed ?
        'Approve'
        : '',
      dropdown: {
        formulae: '"Ignore,Approve,Reject"'
      },
    },
    
    'Rejection Reasons': {
      value: assessment.passed 
        ? ' '
        : parsingError
          ? `PDF extraction errors occurred. ${invalidHolder ? 'Invalid Holder info detected. ': ''}`
          : assessment.reasons || '',
      // ...(assessment.passed ? {fill: passFill}: parsingError ? {fill: warnFill } : {}), // {fill: fail}),
    },

    'Custom Message': { value: '' },

    'Minimum Policy\nExpiration Date': {
      value: minExpiration ? minExpiration.split('T')[0] : '',

      ...(expiryPassed === undefined ? {} 
        : expiryPassed ? {}
          : parsingError ? {}
            : { fill: fail }
      ),
    },

    'Different FoodLogiq\nExpiration Date': {
      value: expiryMismatch ? flExpiration: '',
      ...(expiryMismatch ? {fill: fail} : {}),
    },

    ...Object.fromEntries(Object.entries(limitResults ?? {})
      .map(([, object]) => (
        [
          object?.title, 
          {
            value: object?.value,
            ...(object.pass 
              ? {}
              : object.dateParseWarning
                ? {fill: warnFill}
                // Do not highlight when there is a parsing error or no value (no unexpired policies)
                : parsingError || !object?.value
                  ? {}
                  : {fill: fail}
            ),
          }
        ])
      )
    ),

    'Umbrella Liability (Per Accident) (Greater than or equal\nto 1000000)': {
      value: combinedTrellisCoi?.policies?.ul?.each_occurrence,
    },

    'Workers Compensation (per Statutory Requirements) (Is equal to Yes)': {
      value: workersPassed ? 'Yes' : 'No',
      ...(workersPassed ? {} : parsingError ? {} : { fill: fail }),
    },

    'Comments': gatherComments(flCoi as FlDocument),

    'Attachment Details': { 
      value: Object.entries(attachmentStatuses)
        .map(([id, status]) => `${id}: ${status}`)
        .join('\n'),
    },

    'Additional FoodLogiq Docs Considered': { value: additionalCoisConsidered },
  } 
}

function checkExpirations(flCoi: FlDocument, attachments?: TrellisCOI[]) {
  const allExpirations = (attachments ?? [])
    .flatMap(c => 
      policiesToExpirations(Object.values(c?.policies ?? {}) as Policy[])
    );

  const minExpiration = allExpirations
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const minExpirationDate = minExpiration && new Date(minExpiration)

  // Verify Expiration Dates
  const expiryPassed = minExpirationDate && minExpirationDate > new Date()
 
  const flExp = new Date(flCoi.expirationDate)
  const flExpiration = flExp.toISOString().split('T')[0];
  flExp.setHours(0);
  
  // Check if the FL Document expiration date does not match the minimum of the COI doc
  // False and undefined are treated the same
  const expiryMismatch = minExpirationDate && minExpirationDate < flExp;
  if (expiryMismatch) {
    warn(`The policy expiration date does not match the FL expiration date.`);
  }

  return { flExpiration, expiryPassed, minExpiration, expiryMismatch };
}

function checkPolicyLimits(
  coi: TrellisCOI | undefined,
  reasons: string[],
  umbrella: number
): {
  limitResults: Record<string, LimitResult>,
  reasons: string[], 
} {
  const limitResults = Object.fromEntries(
    Object.entries(limits)
    .map(([path, limit]) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const value = ((jp.query(coi ?? {}, path))[0] as string) ?? '';

      if (value === '') {
        reasons.push(`No unexpired ${limit.name} policies found`);
        return [
        limit.title, 
        {
          ...limit,
          pass: false,
          value: '', 
          dateParseWarning: false
        }
      ]
      }

      // Compute the "effective" coverage with umbrella liability included
      const effValue = Number.parseInt(value ?? '0', 10) + umbrella;

      const expireDate = coi?.policies?.[limit.type as 'el' | 'al' | 'cgl']?.expire_date;

      const expired = expireDate ? new Date(expireDate) < new Date() : true;
      const dateParseWarning = expireDate ? hasBadDates([expireDate]) : false;

      if (expireDate === undefined) {
        reasons.push(`${limit.name} policy has no expiration date`)
      } else if (expired && !dateParseWarning) {
        reasons.push(`${limit.name} policy expired ${expireDate.split('T')[0]}`)
      }

      const pass = !dateParseWarning && effValue >= limit.limit;
      if (dateParseWarning) {
        reasons.push(`Confirm Effective Dates for ${limit.name} policy.`)
      } else if (!pass && !Number.isNaN(effValue)) {
        reasons.push(
          `Insufficient ${limit.longname ?? limit.name} coverage (${limit.limit} required). Coverage${
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

async function writeExcelFile(
  rows: Array<Record<string, ExcelRow>>,
  columns: Record<string, number>,
  fname: string
) {
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
    fgColor: { argb: actionFill },
  }

  createOuterBorder(
    worksheet,
    {
      row: 2,
      col: 5,
    }, {
      row: rows.length + 1,
      col: 5,
    }
  )

  worksheet.getRow(1).height = 40;

  // Save the modified workbook
  await workbook.xlsx.writeFile(fname);
}

const defaultPosition = { row: 1, col: 1 };
const defaultBorderWidth = 'thick';
function createOuterBorder(
  worksheet: Excel.Worksheet,
  start: {
    row: number,
    col: number
  } = defaultPosition,
  end: { row: number, col: number } = defaultPosition,
  borderWidth: 'thick' = defaultBorderWidth,
) {

  const borderStyle = {
      style: borderWidth
  };
  for (let i = start.row; i <= end.row; i++) {
      const leftBorderCell = worksheet.getCell(i, start.col);
      const rightBorderCell = worksheet.getCell(i, end.col);
      leftBorderCell.border = {
          ...leftBorderCell.border,
          left: borderStyle
      };
      rightBorderCell.border = {
          ...rightBorderCell.border,
          right: borderStyle
      };
  }

  for (let i = start.col; i <= end.col; i++) {
      const topBorderCell = worksheet.getCell(start.row, i);
      const bottomBorderCell = worksheet.getCell(end.row, i);
      topBorderCell.border = {
          ...topBorderCell.border,
          top: borderStyle
      };
      bottomBorderCell.border = {
          ...bottomBorderCell.border,
          bottom: borderStyle
      };
  }
}

function flIdToLink(_id: string) {
  return `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${_id}/${COMMUNITY_ID}`;
}

/**
 * Find documents with drafts and apply an "Awaiting Approval" status. 
 * Because FL seems to lack the appropriate query parameters, a 2-year
 * limit is placed on versionUpdated (apart from the COI doc type). 
 * Then, we filter the returned results by presence of draftVersionId.
 *  
 * @returns voice
 */
export async function draftsToAwaitingApproval() {
  const queryDate = new Date()
  queryDate.setMonth(new Date().getMonth() - 24);
  const flBaseQuery = 
    '?sourceCommunities=5fff03e0458562000f4586e9' + 
    '&shareSourceTypeId=60653e5e18706f0011074ec8' +
    `&versionUpdated=${queryDate.toISOString()}..`;
  let flCois = await getFlCois(flBaseQuery); 
  
  // Find docs with drafts
  flCois = Object.fromEntries(
    Object.entries(flCois).filter(([_, flCoi]) => flCoi.shareSource.draftVersionId)
  );

  for await (const [_, coi] of Object.entries(flCois)) {
    const _id = coi.shareSource.draftVersionId;
    const request : AxiosRequestConfig = {
      method: 'put',
      url: `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${_id}/approvalStatus`,
      data: {
        comment: "",
        status: "Awaiting Approval",
        visibleForSupplier: false,
      },
      headers: { 
        Authorization: `${FL_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    await axios<FlQuery>(request)
  }

  return flCois;
}


/* 
 * The original setup in generateCoisReport used the attachments on a single FL doc; Instead, let's combine documents
 * across the trading partner to handle multiple FL docs.
 */
export async function gatherCoisReportData(fname: string) {
  let flCois: ReportDataSave["flCois"] = {};
  let attachments: ReportDataSave["attachments"] = {};


  // Try to load what we can
  if (existsSync(fname)) {
    // Load the saved JSON data 
    const json = readFileSync(fname, 'utf8');
    const obj = JSON.parse(json) as ReportDataSave;
    flCois = obj.flCois;
    attachments = obj.attachments;
  } else {
    // 1. Grab all FL COIs currently awaiting-review
    const queryDate = new Date();
    queryDate.setMonth(new Date().getMonth());
    const flBaseQuery = 
      '?sourceCommunities=5fff03e0458562000f4586e9' + 
      '&approvalStatuses=Awaiting Approval' +
      '&shareSourceTypeId=60653e5e18706f0011074ec8' +
      '&archived=false' +
      `&expirationDate=${queryDate.toISOString()}..`;
    flCois = await getFlCois(flBaseQuery); 
  }

  // 2. Group COIs by supplier
  const coisBySupplier: Record<string, Array<FlDocument | FlDocumentError>> = groupBy(
    Object.values(flCois),
    (flCoi) => flCoi?.shareSource?.sourceBusiness?._id
  )

  const queryDate = new Date();
  queryDate.setMonth(new Date().getMonth());
  let i = 0;
  for await (const [busId, supplierCois] of Object.entries(coisBySupplier)) {
    info(
      `Processing Business ${busId} (${i++}/${Object.values(coisBySupplier).length})`,
    );
    if (attachments[supplierCois[0]!._id]) {
      info(`Business ${busId} already processed.`);
      continue;
    }

    // 3. Grab additional COIs of other statuses from that supplier
    //    that may contribute to the assessment.
    const flTradingPartnerQuery =
      '?sourceCommunities=5fff03e0458562000f4586e9' +
      '&approvalStatuses=Approved' +
      `&sourceBusinesses=${busId}` +
      '&shareSourceTypeId=60653e5e18706f0011074ec8' +
      `&expirationDate=${queryDate.toISOString()}..`;
    const moreFlCois = await getFlCois(flTradingPartnerQuery);

    flCois = {
      ...flCois,
      ...moreFlCois,
    };

    // The collection of grouped flCois
    supplierCois.push(...Object.values(moreFlCois));

    // Fetch the attachments and save the job result(s) which are TrellisCOIs
    for await (const coi of Object.values(supplierCois)) {
      attachments[coi._id] = await fetchAndExtractAttachments(coi);
    }

    writeFileSync(fname, JSON.stringify({attachments, flCois}));
  }
  
  writeFileSync(fname, JSON.stringify({flCois, attachments}));
  return { flCois, attachments };
}

export async function generateCoisReport(reportDataSave: ReportDataSave, filename: string) {
  const { flCois, attachments } = reportDataSave;

  // 2. Group COIs by supplier
  const coisBySupplier: Record<string, Array<FlDocument | FlDocumentError>> = groupBy(
    Object.values(flCois),
    (flCoi) => flCoi?.shareSource?.sourceBusiness?._id
  )

  const excelData: Array<Record<string, ExcelRow>> = [];
  let i = 0;
  for (const [busId, supplierCois] of Object.entries(coisBySupplier)) {
    info(`Processing Business ${busId} (${i++}/${Object.values(coisBySupplier).length})`);

    // Filter the actual TrellisCOI attachments
    const coisToCombine = supplierCois
      // Filter errors at the coi level (failed to retrieve all attachments)
      .filter(({_id}) => !attachments[_id]!.serialized)
      .flatMap(({_id}) => Object.values((attachments[_id] ?? {}))
        // Filter ErrObjs at the individual attachment level
        .filter(value => ('results' in value))
        .flatMap(({results}: ExtractPdfResult) => Object.values(results) as TrellisCOI[])
      )

    const coisToReport = supplierCois
      // Filter errors at the coi level (failed to retrieve all attachments)
      .filter((flCoi) => 
        !('error' in flCoi) 
        && flCoi?.shareSource?.approvalInfo?.status === 'Awaiting Approval'
        && flCoi?.isArchived !== true
      )

    const additionalCoisConsidered = supplierCois
      .map(({_id}) => flIdToLink(_id))
      .join('\n')

    const combinedTrellisCoi = combineCois(coisToCombine);
    for (const [index, flCoi] of coisToReport.entries()) {
      const attachmentStatuses = Object.fromEntries(supplierCois
        // Filter errors at the coi level (failed to retrieve all attachments)
        .filter(({_id}) => !attachments[_id]!.serialized)
        .flatMap(({_id}) => 
          Object.entries(attachments[_id] ?? {})
            // Filter ErrObjs at the individual attachment level
            .map(([key, trellisCoiOrError]) => 
              ([
                key, 
                'serialized' in trellisCoiOrError || trellisCoiOrError.results.serialized 
                  ? `Parsing Error: ${(trellisCoiOrError?.results?.serialized?.cause?.cause?.information ?? trellisCoiOrError?.msg ?? '')
                      .replaceAll('!','')
                      .replaceAll(';', '; ')
                    }`
                  : 'Success'
              ])
            )
        )
      ) as unknown as Record<string, string>;
      const attachmentExtractionErrors = Object.fromEntries(supplierCois
        // Filter errors at the coi level (failed to retrieve all attachments)
        .filter(({_id}) => !attachments[_id]!.serialized)
        .flatMap(({_id}) => 
          Object.entries(attachments[_id] ?? {})
            // Filter ErrObjs at the individual attachment level
            .filter(([_, trellisCoiOrError]) => 
                'serialized' in trellisCoiOrError || trellisCoiOrError.results.serialized
            )
            .map(([key, trellisCoiOrError]) => 
              ([key, trellisCoiOrError?.results?.serialized?.cause?.cause?.information])
            )
        )
      ) as unknown as Record<string, string>;

      const invalidHolder = Object.values(attachmentExtractionErrors || {})
        .some(value => (value || '').includes('Holder'))

      const thisCoiAttachments = Object.values(attachments[flCoi._id] ?? {})
        // Filter ErrObjs at the individual attachment level
        .filter(value => ('results' in value))
        .flatMap(({results}: ExtractPdfResult) => Object.values(results) as TrellisCOI[])

      const coiAssessment = assessCoi({
        flCoi,
        attachments: thisCoiAttachments,
        combinedTrellisCoi,
      });

      const parsingError = Object.values(attachmentStatuses)
        .some(status => status.includes('Parsing Error'));

      excelData.push(generateAssessmentRow({
        flCoi,
        ...coiAssessment,
        combinedTrellisCoi,
        parsingError,
        invalidHolder,
        part: coisToReport.length <= 1 ? '' : (index+1).toLocaleString(),
        additionalCoisConsidered,
        attachmentStatuses,
      }));
    }
  }
  
  await writeExcelFile(excelData, coiReportColumns, filename);
}

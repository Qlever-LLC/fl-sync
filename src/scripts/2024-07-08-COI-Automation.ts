import { default as axios } from 'axios';
// @ts-ignore
import csvjson from 'csvjson';
import { connect, type OADAClient } from '@oada/client';
import { doJob } from '@oada/client/jobs';
import debug from 'debug';
import Excel from 'exceljs';
import config from '../config.js';
import jszip from 'jszip';
// @ts-ignore
import jp from 'jsonpath';
import type { AxiosRequestConfig } from 'axios';
import { serializeError } from 'serialize-error'
import { readFileSync, writeFileSync } from 'node:fs';
import type {
  AutoLiability,
  EmployersLiability,
  GeneralLiability,
  TrellisCOI,
  UmbrellaLiability,
  WorkersCompensation
} from '../mirrorWatch.js';
import _ from 'lodash';
const { domain, token } = config.get('trellis');
const FL_TOKEN = config.get('foodlogiq.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const CO_ID = config.get('foodlogiq.community.owner.id');
const COMMUNITY_ID = config.get('foodlogiq.community.id');

//let filename = 'cois-8-5-2024.json';
let filename = 'cois-08-13-2024.json';
//let fname = 'cois-08-09-2024.json';

const fail = 'FFdc4242';
const pass = 'FF77bc65';
const warnFill = 'FFf6ce1e';

const limits : Record<string, Limit> = {
  '$.policies.cgl.each_occurrence': { 
    limit: 2000000,
    title: 'General Liability\n(Per Occurrence)\n(Greater than or equal to 2000000)'
  },
  '$.policies.cgl.general_aggregate': {
    limit: 5000000,
    title: 'General Liability\n(General Aggregate)\n(Greater than or equal to 5000000)'
  },
  '$.policies.al.combined_single_limit': {
    limit: 1000000,
    title: 'Automobile Liability\n(Greater than or equal to 1000000)'
  },
  '$.policies.el.el_each_accident': {
    limit: 1000000,
    title: `Employer's Liability\n(Greater than or equal to 1000000)`
  }
}

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
const warn = debug('fl-sync:warn');
let oada: OADAClient;
try {
  oada = await connect( { domain, token});
} catch(err) {
  console.log(err);
}

async function generateCoiRecords(fname: string) {
  let cois = await getCois(fname, []); 
  writeFileSync(fname, JSON.stringify(cois));
  console.log('done');
}

async function fetchAttachments(item: any) {
  const { data: zipFile } = await axios({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${item._id}/attachments`,
    headers: { Authorization: FL_TOKEN },
    responseEncoding: 'binary',
  }).catch((error_) => {
    if (error_.response.status === 404) {
      info(`Bad attachments on item ${item._id}. Throwing Error`);
      throw new Error('FL Attachments no longer exist');
    } else throw error_;
  });

  const zip = await new jszip().loadAsync(zipFile);
  const files = Object.keys(zip.files);

  let resources = [];

  for await (const fKey of files) {

    if (!fKey) {
      console.log(`Could not get file key for item ${item._id}`);
      continue
    }

    // Prepare the pdf resource
    const ab = await zip.file(fKey)!.async('uint8array');
    const zdata = Buffer.alloc(ab.byteLength).map((_, i) => ab[i]!);

    try {
      let { headers } = await oada.post({
        path: `/resources`,
        data: zdata,
        contentType: 'application/pdf',
      });
      let _id = headers['content-location']!.replace(/^\//, '');
      resources.push(_id);
    } catch (cError) {
      throw Buffer.byteLength(zdata) === 0
        ? new Error(`Attachment Buffer data 'zdata' was empty.`)
        : (cError);
    }
  }
  return resources;
}

async function processCoi(coi: any, pdfs: any) {
  //2. Post the pdfs

  let results : Record<string, any> = {};
  let jobs : Record<string, any> = {};

  for await (const _id of pdfs) {
    try {
      let { _id: jobId, result } = await doJob(oada, {
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
      });
      jobs[_id] = jobId as string;

      // result is a { cois: { abcx123: {_id: "resources/abc123"}}}
      if (result!.cois) {
        results = {
          ...results,
          ...result!.cois,
        }
      } else {
        jobs[_id] = serializeError(result);
      }
    } catch (e) {
      jobs[_id] = serializeError(e);
      results[_id] = serializeError(e);
      console.log(e);
    }
  }

  // Now go fetch all of the links
  for await (const [key, { _id }] of Object.entries(results)) {
    let { data: doc } = await oada.get({
      path: `/${_id}`,
    });

    results[key] = doc;
  }

  return { 
    coi,
    attachments: results, 
    combined: combineCois(results, coi._id),
    jobs,
  }
}

function combineCois(cois: Record<string, TrellisCOI>, _id: string): TrellisCOI {
    
  return {
    policies: {
      // @ts-ignore
      expire_date: Object.values(cois)
        .flatMap(coi => Object.values(coi.policies || {}))
        .filter(p => typeof p !== 'string')
         // @ts-ignore
        .map((policy: Policy) => policy.expire_date)
        .filter((date: string) => {
          const wierdDate = new Date(date).getFullYear() === 1900;
          if (wierdDate) warn('Bad policy date extracted on COI', _id);
          return !wierdDate;
        })
        .sort((a: string, b: string) => 
          new Date(a).getTime() - new Date(b).getTime()
        )[0],
      cgl: composePolicy(cois, 'Commercial General Liability') as GeneralLiability,
      al: composePolicy(cois, 'Automobile Liability') as AutoLiability,
      el: composePolicy(cois, `Employers' Liability`) as EmployersLiability,
      ul: composePolicy(cois, 'Umbrella Liability') as UmbrellaLiability,
      wc: composePolicy(cois, `Worker's Compensation`) as WorkersCompensation,
    },
  };
}

async function getCois(fname: string, coiResults: any[], pageIndex?: number) {
  let request : AxiosRequestConfig = {
    method: 'get',
    url: `https://connect-api.foodlogiq.com/v2/businesses/5acf7c2cfd7fa00001ce518d/documents?sourceCommunities=5fff03e0458562000f4586e9&approvalStatus=awaiting-review&shareSourceTypeId=60653e5e18706f0011074ec8`,
    headers: { Authorization: `${FL_TOKEN}` },
  };

  if (pageIndex) {
    request.params = { pageIndex };
  }

  let { data: response } = await axios(request)

  // Manually check for changes; Only update the resource if it has changed!
  let i = 0;
  for await (const coi of response.pageItems) {
    try {
      i++;
      console.log(`processing coi ${(((pageIndex || 0))*50) + i} / ${response.totalItemCount} (${(((((pageIndex || 0))*50) + i)/(response.totalItemCount) * 100).toFixed(2)} %)`);
      let pdfs = await fetchAttachments(coi);
      coiResults.push({
        _id: coi._id,
        ...await processCoi(coi, pdfs)
      });
    } catch (cError: unknown) {
      coiResults.push({
        _id: coi._id,
        coi,
        error: serializeError(cError),
      });
    }
  }

  writeFileSync(fname, JSON.stringify(coiResults));
  // Repeat for additional pages of FL results
  if (response.hasNextPage) {
    await getCois(fname, coiResults, response.nextPageIndex);
  }

  return coiResults;
}

type PolicyType = 
  'Commercial General Liability' |
  'Automobile Liability' |
  `Employers' Liability` |
  'Umbrella Liability' |
  `Worker's Compensation`;

function composePolicy(cois: Record<string, TrellisCOI>, type: PolicyType): Policy {
  let policies : Policy[] = Object.values(cois)
    .flatMap(coi => Object.values(coi.policies || {}))
    .filter(p => typeof p !== 'string') as Policy[];

  policies = policies.filter((p)=> p.type === type);
  
  let combined : any = {};

  for (const pol of policies) {
    switch(type) {
      case 'Commercial General Liability':
        combined.each_occurrence = sum(combined, pol, 'each_occurrence') 
        combined.general_aggregate = sum(combined, pol, 'general_aggregate'); 
        combined["products_-_compop_agg"] = sum(combined, pol, "products_-_compop_agg");
        break;

      case 'Automobile Liability':
        combined.combined_single_limit = sum(combined, pol, 'combined_single_limit');
        break;

      case 'Umbrella Liability':
        combined.each_occurrence = sum(combined, pol as UmbrellaLiability, 'each_occurrence');
        break;

      case "Employers' Liability":
        combined.el_each_accident = sum(combined, pol as EmployersLiability, 'el_each_accident');
        break;

      case "Worker's Compensation":
        combined.effective_date = minimumDate(combined.effective_date, (pol as WorkersCompensation).effective_date);
        combined.expire_date = minimumDate(combined.expire_date, (pol as WorkersCompensation).expire_date);
        break;
      
      default:
        break;
    }
  }
  return combined;
}

function minimumDate(a: string, b: string) {
  const aDate = new Date(a);
  const bDate = new Date(b);

  return aDate < bDate ? a : b
}

function sum(a: Record<string, any>, b: Record<string, any>, key: string) {
  return (parseInt(a[key]) || 0) + (parseInt(b[key]) || 0); 
}

type Policy =
  GeneralLiability | 
  AutoLiability | 
  EmployersLiability | 
  UmbrellaLiability |
  WorkersCompensation;

function writeResults(results: Record<string, any>) {
  writeFileSync('cois-8-5-2024-report.csv', csvjson.toCSV(results, {
    delimiter : ',',
    quote     : '"',
    headers: "key"
  }));
}

async function generateCoiReport(path: string) {
  const json = readFileSync(path, 'utf8');
  const data = JSON.parse(json);
  const results : Array<Record<string, ExcelRow>> = [];
  for await (let item of data) {
    results.push(await assessCoi(item));
  }
  writeExcelFile(results);
}

interface Limit { 
  title: string;
  limit: number;
  value?: number;
  outString?: string;
  result?: string 
}

interface AssessmentResult {
  result: boolean;
  reasons: string;
}

interface ExcelRow {
  value: any
  fill?: any,
  hyperlink?: string,
}

async function assessCoi({
  _id,
  coi,
  combined,
  error,
  attachments,
}: {
  _id: string,
  coi: any, 
  combined: TrellisCOI,
  attachments: any,
  error: any,
}): Promise<Record<string, ExcelRow>> {
  trace(error, attachments);

  if (!coi) {
    let { data } = await getFlDoc(_id);
    coi = data
  }

  let reasons = [];
  // Check if the coverages are satisfactory
  const umbrella = parseInt(String(combined?.policies?.ul?.each_occurrence ?? '0'));
  const limitResults = Object.fromEntries(
    Object.entries(limits).map(([path, limit]) => {
      const value = (jp.query(combined ?? {}, path))[0] ?? '';
      // compute the "effective" coverage with umbrella liability included
      const effValue = parseInt(value ?? '0') + umbrella;

      return [
        limit.title, 
        {
          ...limit,
          pass: effValue >= limit.limit,
          value,
          reason:
            `Insufficient ${limit.title} coverage (${limit.limit} required). Coverage${umbrella > 0 ? ' including Umbrella policy' : ''} is only ${effValue}.`,
        }
      ]
    })
  );

  // @ts-ignore
  //const warnBadDates = allExpirations.some((date) => new Date(date).getFullYear() === 1900)
  let warnBadDate = false;
  // @ts-ignore
  const allExpirations = Object.values(attachments || {}).map(({ policies }) =>
    // @ts-ignore
    Object.values(policies || {}).map(({ expire_date }) => expire_date)
  ).flat()
  .filter((date) => {
    // @ts-ignore
    const wierdDate = new Date(date).getFullYear() === 1900;
    if (wierdDate) {
      warn('Bad policy date extracted on COI', _id);
      warnBadDate = true;
    }
    return !wierdDate;
  })

  // @ts-ignore
  const minExpiration = allExpirations.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];

  const limitsPassed = Object.values(limitResults).every(({ pass }) => pass)

  // Verify Expiration Dates
  let expiryPassed = minExpiration//combined?.policies?.expire_date
  //@ts-ignore
    && new Date(minExpiration) > new Date();
    //&& new Date(combined.policies.expire_date) > new Date();
 
  let flExp = new Date(coi.expirationDate)
  flExp.setHours(0);
  
  let expiryMismatch = expiryPassed &&
    new Date(combined.policies.expire_date) <= flExp;
  
  if (expiryMismatch) {
    //console.log(expiryMismatch, _id, combined.policies.expire_date, flExp);
    warn(`The policy expiration date does not match the FL expiration date.`)
  }

  // Verify Worker's Compensation coverage
  const workersExists = combined?.policies?.wc?.expire_date
  if (!workersExists) reasons.push(`No Worker's Compensation policy found.`);
  let workersExpired;
  if (workersExists) {
    workersExpired = new Date(combined.policies.wc.expire_date) < new Date();
    if (workersExpired)
      reasons.push(`Worker's Comp policy has expired.`);
  }
  const workersPassed = workersExists && !workersExpired;

  const assessment = {
    passed: Boolean(limitsPassed && expiryPassed && workersPassed),
    reasons: reasons.length > 0 ? reasons.join('\n') : '',
  }

  const parsingError = !(!error || (combined && Object.keys(combined).length > 0));

  return {
    'Trading Partner': {
      value: coi?.shareSource?.sourceBusiness?.name,
    },
    'FL Document Name': {
      value: coi?.name,
      hyperlink: 
        `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${_id}/${COMMUNITY_ID}`,
    },
    'Approval Recommendation': {
      value: assessment.passed ? 
        'Approve'
        : parsingError ? 'Parsing Error' : `Reject${assessment.reasons ? `: ${assessment.reasons}` : ''}`,
      ...(assessment.passed ? {fill: pass}: parsingError ? {fill: warnFill } : {}), //{fill: fail}),
    },
    /*
    'Parsing Errors': {
      value: parsingError
        ? 'Parsing Error' : '',
      ...(parsingError ? {fill: warn} : {}),
    },
    */
    'Min. Policy Expir. Date': {
      /*
      value: (combined?.policies?.expire_date || '').split('T')[0],
      */
       //@ts-ignore
      value: minExpiration ? minExpiration.split('T')[0] : '',
      ...(expiryPassed ? {} 
        : parsingError ? {}
          : warnBadDate ? {fill: warnFill}
            : {fill: fail}
      ),
    },
    ...Object.fromEntries(Object.entries(limitResults)
      .map(([, obj]) => (
        [
          obj?.title, 
          {
            value: obj?.value,
            ...(obj.pass ? {} : parsingError ? {} : {fill: fail}),
          }
        ])
      )
    ),
    'Umbrella Liability (Per Accident) (Greater than or equal to 1000000)': {
      value: combined?.policies?.ul?.each_occurrence,
    },
    'Workers Compensation (per Statutory Requirements) (Is equal to Yes)': {
      value: workersPassed ? 'Yes' : 'No',
      ...(workersPassed ? {} : parsingError ? {} : { fill: fail }),
    },
  } 
}

async function getFlDoc(_id: string) {
  return axios({
    method: 'get',
    url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${_id}`,
    headers: { Authorization: FL_TOKEN },
  })
}

async function writeExcelFile(rows: Array<Record<string, ExcelRow>>) {
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet("Report", {
    views:[{
      state: 'frozen',
      xSplit: 1,
    }]
  });
  // Another dataset for storing our full COI data info
  //const fullDataset = workbook.addWorksheet("Full Dataset");

  /*
  worksheet.tables[tableKey].table.style = {
    theme: undefined, // Example theme, can be changed
    // theme: "TableStyleMedium2", // Example theme, can be changed
    showRowStripes: true,
  };
  */

  worksheet.columns = Object.entries({
    'Trading Partner': 40,
    'FL Document Name': 40,
    'Approval Recommendation': 30,
    //'Parsing Errors': 30,
    'Min. Policy Expir. Date': 30,
    ...Object.fromEntries(
      Object.values(limits).map(({ title }) => [title, 20])
    ),
    'Umbrella Liability': 20,
    'Workers Compensation\n(per Statutory Requirements)\n(Is equal to Yes)': 20,
    'FL Doc Link': 40,
  }).map(
    ([header, width]) => ({ header, width })
  )

  const startRow = 2;
  const startCol = 1;

  for (const [rowIndex, row] of rows.entries()) {
    for (const [colIndex, {value, fill, hyperlink}] of Object.values(row).entries()) {
      const cell = worksheet.getCell(
        startRow + rowIndex,
        startCol + colIndex,
      );
      if (hyperlink) {
        // I thought this hyperlink was causing the script to take longer to run, but
        // its it doesn't seem to always be the case... If necessary, try uncommenting
        // the following line and commenting out the ones after that.
        //cell.value = value;
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
      
    }
  }
  worksheet.getRow(1).height = 40;

  // Save the modified workbook
  await workbook.xlsx.writeFile(`cois-report-${new Date().toISOString()}.xlsx`);
}

async function modifyJsonFile() {
  const json = readFileSync('cois-08-05-2024.json', 'utf8');
  let data = JSON.parse(json);
  let out = [];
  //@ts-ignore
  for await (const item of data) {

    if (item.coi) {
      out.push(item);
    } else {
      let { data } = await getFlDoc(item._id);
      out.push({
        ...item,
        coi: data
      })
    }
  }
  writeFileSync('cois-8-05-2024.json', JSON.stringify(out));
}

//generateCoiRecords('cois-08-13-2024.json');

generateCoiReport(filename);
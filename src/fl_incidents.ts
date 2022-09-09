/**
 * @license
 *  Copyright 2021 Qlever LLC
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

// Load config first so it can set up env
import config from './config.js';

import { default as axios, AxiosRequestConfig } from 'axios';
import _ from 'lodash';
import xlsx from 'xlsx';
import debug from 'debug';
import moment, { Moment } from 'moment';
import { poll } from '@oada/poll';
import sql from 'mssql';

import type { JsonObject, OADAClient } from '@oada/client';
import type { TreeKey } from '@oada/list-lib/dist/Tree.js';

import tree from './tree.js';
if (process.env.LOCAL) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const CO_ID = config.get('foodlogiq.community.owner.id');
// Const HANDLE_INCOMPLETE_INTERVAL = config.get('trellis.handleIncompleteInterval');
// const REPORT_INTERVAL = config.get('trellis.handleIncompleteInterval');
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
const { database, server, user, password, port, interval, table } = config.get('incidents');
const SQL_MAX_VALUE = 9007199254740991;

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

export async function handleItem(item: FlIncident, oada: OADAClient) {
  try {
    const type = item.incidentType._id;
    let sync = false;

    const path = `${SERVICE_PATH}/incident-types/${type}/incidents/${item._id}`;
    try {
      const { data: resp } = await oada.get({ path }) as {
        data: JsonObject;
      };

      // Check for changes to the resources
      const equals = _.isEqual(resp['food-logiq-mirror'], item);
      if (!equals) {
        info(
          `Document difference in FL doc [${item._id}] detected. Syncing...`
        );
        sync = true;
      }
    } catch (cError: unknown) {
      // @ts-expect-error stupid errors
      if (cError.status !== 404) {
        throw cError;
      }

      info('Resource is not already in trellis. Syncing...');
      sync = true;
    }

    // Now, sync
    if (sync) {
      await oada.put({
        path,
        data: { 'food-logiq-mirror': item } as any,
        tree,
      });
      info(`Document synced to mirror: type:${type} _id:${item._id}`);
    }

    return true;
  } catch (cError: unknown) {
    // TODO: Need to add this to some sort of retry
    error(
      { error: cError },
      `fetchIncidents errored on item ${item._id}. Moving on`
    );
    return false;
  }
}

/**
 * Fetches community resources
 * @param {*} param0 pageIndex, type, date
 */
export async function fetchIncidents({
  startTime,
  endTime,
  pageIndex,
  oada,
}: {
  startTime: string;
  endTime: string;
  pageIndex?: number;
  oada: OADAClient;
}) {
  pageIndex = pageIndex ?? 0;
  const url = `${FL_DOMAIN}/v2/businesses/${CO_ID}/incidents?updated=${startTime}..${endTime}`
  const request: AxiosRequestConfig = {
    method: `get`,
    url,
    headers: { Authorization: FL_TOKEN },
  };
  if (pageIndex) {
    request.params = { pageIndex };
  }

  const response = await axios(request);

  // Manually check for changes; Only update the resource if it has changed!
  try {
    for await (const item of response.data.pageItems as FlIncident[]) {
      let retries = 5;
      // eslint-disable-next-line no-await-in-loop
      while (retries-- > 0 && !(await handleItem(item, oada)));
    }
  } catch (cError: unknown) {
    error({ error: cError }, 'fetchIncidents');
    throw cError;
  }

  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(
      `Finished page ${pageIndex}. Item ${
        response.data.pageItemCount * (pageIndex + 1)
      }/${response.data.totalItemCount}`
    );
    await fetchIncidents({
      startTime,
      endTime,
      pageIndex: pageIndex + 1,
      oada,
    });
  }
}

export async function pollIncidents(
  lastPoll: Moment,
  end: Moment,
  oada: OADAClient
) {
  // Sync list of suppliers
  const startTime: string = (lastPoll || moment('20150101', 'YYYYMMDD'))
    .utc().format();
  const endTime: string = end.utc().format();

  await fetchIncidentTypes({ startTime, endTime, oada });
  await fetchIncidents({ startTime, endTime, oada });
  await fetchIncidentsCsv({ startTime, endTime });
}

/**
 * Fetch Incidents in csv format
 * @param {*} param0 pageIndex, type, date
 */
export async function fetchIncidentsCsv({
  startTime,
  endTime,
  pageIndex,
}: {
  startTime: string;
  endTime: string;
  pageIndex?: number;
}) {
  pageIndex = pageIndex ?? 0;
  const url = `${FL_DOMAIN}/v2/businesses/${CO_ID}/incidents/csv?updated=${startTime}..${endTime}`;
  const request: AxiosRequestConfig = {
    method: `get`,
    url,
    headers: { Authorization: FL_TOKEN },
  };
  if (pageIndex) {
    request.params = { pageIndex };
  }

  const response = await axios(request);

  let wb = xlsx.read(response.data, {type: 'string', cellDates: true});
  let sheetname = wb.SheetNames[0];
  if (sheetname === undefined) return;
  let sheet = wb.Sheets[sheetname];
  if (sheet === undefined) return;
  let csvData = xlsx.utils.sheet_to_json(sheet);
  console.log({csvData});

  //const arr = csvjson.toArray(response.data, { delimiter: ",", quote: '"' });
  //const headers = arr.shift();
  //const csvData = arr.map((values: string[]) => headers.reduce((a: any, b: string, i: number) => ({ ...a, [b]: a[b] || values[i]}), {}));

  //const csvData = csvjson.toObject(response.data, { delimiter: ",", quote: '"' });

  if (csvData.length > 0) {
    //csvData = csvData.filter((row:any) => row['Id'] === '60229d58f952a5000ea4fa5e');
    await syncToSql(csvData);
  }

  // Repeat for additional pages of FL results
  if (response.data.hasNextPage && pageIndex < 1000) {
    info(
      `Finished page ${pageIndex}. Item ${
        response.data.pageItemCount * (pageIndex + 1)
      }/${response.data.totalItemCount}`
    );
    await fetchIncidentsCsv({
      startTime,
      endTime,
      pageIndex: pageIndex + 1,
    });
  }
}

export async function startIncidents(connection: OADAClient) {
  const sqlConfig = {
    server,
    database,
    user,
    password,
    port,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  //@ts-ignore
  await sql.connect(sqlConfig);

  await ensureTable();

  await poll({
    connection,
    basePath: SERVICE_PATH,
    pollOnStartup: true,
    pollFunc: pollIncidents,
    interval,
    name: 'food-logiq-incidents',
    getTime: (async () =>
      axios({
        method: 'head',
        url: `${FL_DOMAIN}/businesses`,
        headers: { Authorization: FL_TOKEN },
      }).then((r) => r.headers.date)) as unknown as () => Promise<string>
  });
  info('Started fl-sync poller.');
}

async function ensureTable() {
  const tables = await sql.query`select * from INFORMATION_SCHEMA.TABLES`;
  const matches = tables.recordset.filter(
    (obj: any) => obj.TABLE_NAME === 'incidents')
  const tableColumns = Object.values(allColumns)
    .map((c) => `[${c.name}] ${c.type} ${c.allowNull ? 'NULL' : 'NOT NULL'}`)
    .join(', ');

  if (matches.length === 0) {
    const query = `create table incidents (${tableColumns} PRIMARY KEY (Id))`;
    await sql.query(query)
    trace(`Creating incidents table: ${query}`);
  }

}


let alters = {
  'Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? (Be sure to include your FoodLogiQ Incident ID in your email)': 'Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options?',
  //'incidentDate (Incident Date/Delivery Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  //'incidentDate (Delivery Date/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'Community': 'community (Community/Business Name)',
  //'location (My Location Name/Location Name)': 'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)',
  //'location (Location Name/My Location Name)': 'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)',
  //'location (Location GLN/My Location GLN)': 'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)',
  //'location (My Location GLN/Location GLN)': 'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)',
  'Affected Quantity': 'quantityAffected (Quantity Affected/Affected Quantity)',
  'IMAGE OF SUPPLIER CASE LABEL': 'images (Photo of Case Labels & Product/Photos or Documents)',
  //'product (Material GTIN/Product GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  //'product (Product Name GTIN/Material GTIN/Product GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  //'product (Product GTIN/Material GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  //'product (Product GTIN/Product Name GTIN/)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  //'quantityAffected (Affected Quantity/Quantity Affected)': 'quantityAffected (Quantity Affected/Affected Quantity)',
  //'incidentDate (Date of Delivery/Incident Date/Delivery Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  //'incidentDate (Delivery Date/Date of Delivery/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  //'incidentDate (Date of Delivery/Delivery Date/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
}

//1. If its a thing with some slashes in parentheses, allow them to be in any order;
function checkSlashThings(row: any) {
  const pattern = /[^()]+[ ]\(([^()]+[\/][^()]+)+\)/;
  for (const key in row) {

    if (key in allColumns) continue;

    if (pattern.test(key)) {
      const parts = key.split(' (');
      const first = parts[0];
      const set = parts[1]!.replace(/\)$/, '').split('/').sort();

      for (const col in allColumns) {
        if (pattern.test(col)) {
          const cParts = col.split(' (');
          const cFirst = cParts[0];
	  const cSet = cParts[1]!.replace(/\)$/, '').split('/').sort();
	  const same = cSet.every((item, i) => set[i] === item);
	  if (same) {
	    row[col] = row[key];
            delete row[key];
	  }
	}
      }
    }
  }
  return row;
}

let noDelete = [
  'Affected Quantity',
  'IMAGE OF SUPPLIER CASE LABEL',
  'incidentDate (Incident Date/Date of Delivery/Delivery Date)'
];

let notNull = {
  'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)': '0',
  'product (Product GTIN/Product Name GTIN/Material GTIN)': '0',
  'Invoice Photo': 'false',
  'DC Pick Label': 'false',
  'Invoice Image': 'false',
  'Purchase Order Image': 'false',
  'Supplier Label': 'false',
  'Incident Photo(s)': 'false',
  'SUPPLIER INVESTIGATION REPORT(S)': 'false',
  'SUPPLIER CREDIT DOCUMENTATION': 'false',
};

// Handle schema changes over time (get csv output for whole history versus a small, recent window and results will vary a lot)
function prepRow(row: any) {
  if ('CREDIT NOTE' in row) {
    row['Credit Note'] = row['CREDIT NOTE'];
    delete row['CREDIT NOTE'];
  }

  if (!('Credit note to supplier' in row)) {
    row['Credit note to supplier'] = row['Credit Note'];
  }

  if (!('DC Pick Label' in row)) {
    row['Credit note to supplier'] = row['Credit Note'];
  }

  row = checkSlashThings(row);

  for (const oldKey in alters) {
    if (oldKey in row) {
      // @ts-ignore
      row[alters[oldKey]] = row[alters[oldKey]] || row[oldKey];
      if (!noDelete.includes(oldKey)) {
        delete row[oldKey];
      }
    }
  }

  return row;
}


async function syncToSql(csvData: any) {
  const sqlConfig = {
    server,
    database,
    user,
    password,
    port,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  //@ts-ignore
  await sql.connect(sqlConfig);

  for await (const row of csvData) {
    info(`Incoming Row: ${row}`);
    let newRow = prepRow(row);

    let ColumnKeys = Object.keys(allColumns).sort();

    newRow = Object.fromEntries(ColumnKeys.map((key) => {
      if (newRow[key] === "" && allColumns[key]!.allowNull) {
        return [key, null]
      } else if (moment.isDate(newRow[key])) {
        return [key, moment(newRow[key]).toDate()];

      } else if (!isNaN(Number(newRow[key]))) {
        if (Number(newRow[key]) > SQL_MAX_VALUE) {
          return [key, newRow[key].toString()];
	} else {
	  return [key, Number(newRow[key])];
        }

      } else if (newRow[key] && newRow[key].toLowerCase() === 'no') {
	return [key, false];

      } else if (newRow[key] && newRow[key].toLowerCase() === 'yes') {
	return [key, true];

      } else if (typeof newRow[key] === 'string' && (newRow[key].toLowerCase() === 'true' || newRow[key].toLowerCase() === 'false')) {
        return [key, newRow[key].toLowerCase() === 'true'];

      } else if (newRow[key] === true || newRow[key] === false) {
        return [key, newRow[key]];

      } else if (moment(newRow[key], 'MMM DD, YYYY', true).isValid()) {
	return [key, moment(newRow[key], 'MMM DD, YYYY').toDate()];


      } else if (moment(newRow[key], 'MMMM D, YYYY hh:mma', true).isValid()) {
	return [key, moment(newRow[key], 'MMMM D, YYYY hh:mma',true).toDate()];

      } else if (moment(newRow[key], 'YYYY-MM-DD', true).isValid()) {
	return [key, moment(newRow[key], 'YYYY-MM-DD', true).toDate()];

      } else if (!newRow[key]) {
	return [key, null];

      } else if (newRow[key] === 'N/A' && allColumns[key]!.type === 'BIT') {
	return [key, null];

      } else {
        return [key, `'${newRow[key]}'`]
      }
    }));

    for (const item of Object.values(allColumns)) {
      let value = newRow[item.name];
      if (value === undefined || value === null) {
	if (item.type === 'BIT') {
	  value = false;
	} else if (item.type.includes('VARCHAR')) {
	  value = '';
	} else {
	  value = '0';
	}
      }
    }

    console.log({newRow});

    let req = new sql.Request();

    const selectString = ColumnKeys.map((key, i) => {
      req.input(`val${i}`, newRow[key]);
      return `@val${i} AS [${key}]`
    }).join(',');

    const setString = ColumnKeys.map(
    (key, i) => `[${key}] = @val${i}`).join(',');

    //const targetString = ColumnKeys.map(
    //      (key) => `target.[Incident ID] = source.[${key}]`).join(' AND ');

    const cols = ColumnKeys.map(key => `[${key}]`).join(',');

    const values = ColumnKeys.map((_, i) => `@val${i}`).join(',');

    const query = `MERGE
    INTO ${table} WITH (HOLDLOCK) AS target
      USING (SELECT ${selectString}) AS source
      (${cols})
      ON (target.[Incident ID] = source.[Incident ID])
      WHEN MATCHED
        THEN UPDATE
          SET ${setString}
      WHEN NOT MATCHED
        THEN INSERT (${cols})
        VALUES (${values});`
    console.log(`SQL Query: %s`, query);
    await req.query(query)
  }
}

export async function fetchIncidentTypes({
  startTime,
  endTime,
  pageIndex,
  oada,
}: {
  startTime: string;
  endTime: string;
  pageIndex?: number;
  oada: OADAClient;
}) {
  pageIndex = pageIndex ?? 0;
  const url = `${FL_DOMAIN}/businesses/${CO_ID}/incidentTypes?updated=${startTime}..${endTime}`;
  const request: AxiosRequestConfig = {
    method: `get`,
    url,
    headers: { Authorization: FL_TOKEN },
  };
  if (pageIndex) {
    request.params = { pageIndex };
  }

  const response = await axios(request);

  // Manually check for changes; Only update the resource if it has changed!
  try {
    for await (const item of response.data.items as FlIncidentType[]) {
      let retries = 5;
      // eslint-disable-next-line no-await-in-loop
      while (retries-- > 0 && !(await handleIncidentType(item, oada)));
    }
  } catch (cError: unknown) {
    error({ error: cError }, 'fetchIncidents');
    throw cError;
  }

  // Repeat for additional pages of FL results
  if (response.data.has_more) {
    info(
      `Finished page ${pageIndex}. Item ${
        response.data.items.length * (pageIndex + 1)
      }/${response.data.total}`
    );
    await fetchIncidentTypes({
      startTime,
      endTime,
      pageIndex: pageIndex + 1,
      oada,
    });
  }
}

export async function handleIncidentType(
  item: FlIncidentType,
  oada: OADAClient
) {
  try {
    const type = item._id;
    let sync = false;

    const path = `${SERVICE_PATH}/incident-types/${type}`;
    try {
      const { data: resp } = await oada.get({ path }) as {
        data: JsonObject;
      };

      // Check for changes to the resources
      const equals = _.isEqual(resp['food-logiq-mirror'], item);
      if (!equals) {
        info(
          `Document difference in FL doc [${item._id}] detected. Syncing...`
        );
        sync = true;
      }
    } catch (cError: unknown) {
      // @ts-expect-error stupid errors
      if (cError.status !== 404) {
        throw cError;
      }

      info('Resource is not already in trellis. Syncing...');
      sync = true;
    }

    // Now, sync
    if (sync) {
      await oada.put({
        path,
        data: { 'food-logiq-mirror': item } as any,
        tree,
      });
      info(`Document synced to mirror: type:${item.name} _id:${item._id}`);
    }

    return true;
  } catch (cError: unknown) {
    // TODO: Need to add this to some sort of retry
    error(
      { error: cError },
      `fetchIncidents errored on item ${item._id}. Moving on`
    );
    return false;
  }
}

export type FlIncident = {
  name: string;
  _id: string;
  state: string;
  lastUpdate: {
    userId: string;
  };
  performedOnBusiness: {
    _id: string;
  };
  shareSource: {
    approvalInfo: {
      status: string;
    };
    shareSpecificAttributes: {
      effectiveDate: string;
    };
    type: {
      name: string;
    };
    sourceBusiness: {
      name: string;
      _id: string;
      address: {
        addressLineOne: string;
        postalCode: string;
        city: string;
        region: string;
        country: string;
      };
    };
  };
  expirationDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: {
    _id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    phoneExt: string;
    mobile: string;
  };
  createSource: string;
  currentVersionId: string;
  isCurrentVersion: boolean;
  business: FlBusiness;
  community: {
    _id: string;
    name: string;
    iconURL: string;
    replyToEmail: string;
  };
  sourceMembership: {
    _id: string;
    business: FlBusiness;
    productGroup: {
      _id: string;
      name: string;
    };
    locationGroup: {
      _id: string;
      name: string;
    };
  };
  product: {
    _id: string;
    globalTradeItemNumber: string;
    name: string;
    lot: string;
    manualEntry: boolean;
  };
  location: {
    _id: string;
    name: string;
    globalLocationNumber: string;
    type: string;
  };
  groups: {
    locationGroupId: string;
    locationGroupName: string;
    productGroupId: string;
    productGroupName: string;
  };
  productType: {
    _id: string;
    name: string;
    gtinRequired: boolean;
    attributes: Array<Record<string, any>>;
    requirements: Array<Record<string, any>>;
  };
  packedDate: string;
  useByDate: string;
  incidentDate: string;
  images: FlAttachment[];
  creditRequest: boolean;
  customerComplaint: boolean;
  deliveryIssue: boolean;
  purchaseOrder: string;
  foundBy: string;
  quantityUnits: string;
  quantityAffected: number;
  details: string;
  type: string;
  sourceType: string;
  sourceStore: string;
  Status: string;
  title: string;
  distributionIssue: boolean;
  havePackaging: boolean;
  distributor: {
    _id: string;
    name: string;
    globalLocationNumber: string;
    type: string;
    business: FlBusiness;
  };
  invoiceDate: string;
  supplierLocation: {
    _id: string;
    name: string;
    globalLocationNumber: string;
    type: string;
  };
  imagesByField: Record<string, FlAttachment[]>;
  supplyChainMembersByField: {
    plant: {
      _id: string;
      business: FlBusiness;
      productGroup: {
        _id: string;
        name: string;
      };
      locationGroup: {
        _id: string;
        name: string;
      };
    };
  };
  supplyChainMembersOptions: FlOptions;
  aliasID: string;
  dueDate: string;
  autoChangeDate: string;
  incidentType: {
    _id: string;
    name: string;
  };
  currentStatus: FlStatus;
  timeToCompletion: number;
  statusHistory: FlStatusHistoryItem[];
  comment: string;
  extraAttributes: {
    defectGroup: string;
    doYouHaveEnoughInformationToBeginInvestigationOfTheIncidentAsDefinedAbove: boolean;
    estNo: string;
    labelingDefectType: string;
    poSto: number;
    problemStatement: string;
    quantityInvolved: number;
    quantityUnitOfMeasure: string;
    reporterName: string;
    reporterPhone: string;
    whatIsThePreventiveMeasure: string;
  };
};

export type FlStatusHistoryItem = {
  changedBy: FlChangedBy;
  changedAt: string;
  from: number;
  to: number;
  comment: string;
  action: string;
  aliasID: string;
};

export type FlChangedBy = {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  phoneExt: string;
  mobile: string;
};

export type FlAttachment = {
  S3Name: string;
  fileName: string;
  BucketName: string;
  updatedAt: string;
};

export type FlBusiness = {
  _id: string;
  name: string;
  heroURL: string;
  iconURL: string;
  address: {
    addressLineOne: string;
    addressLineTwo: string;
    addressLineThree: string;
    city: string;
    region: string;
    country: string;
    postalCode: string;
    latLng: {
      latitude: number;
      longitude: number;
    };
  };
  website: string;
  email: string;
  phone: string;
};

export type FlOptions = {
  isForSupplier: boolean;
  isForBuyer: boolean;
  isForDistributor: boolean;
  isForCreator: boolean;
  roles: string[];
  notifyOnAttributeSelection: Array<{
    attributeRequirement: {
      dataType: string;
      operator: string;
      storedAs: string;
      values: Array<Record<string, unknown>>;
    };
  }>;
  supplyChainMemberFields: string[];
};

export type FlIncidentType = {
  createdAt: string;
  updatedAT: string;
  business: FlBusiness;
  _id: string;
  name: string;
  incidentsConf: FlIncidentsConf[];
  statusSteps: FlStatus[];
  isActive: boolean;
  isForMobile: boolean;
  deletedStatusChange: Record<string, unknown>;
};

export type FlStatus = {
  id: number;
  name: string;
  visibilityOptions: FlOptions;
  editOptions: FlOptions;
  notificationOptions: FlOptions;
  attributesCaptured: number[];
  attributesVisible: number[];
  transitions: number[];
  emailSubject: string;
  emailText: string;
  deleteAllowed: boolean;
  isResolved: boolean;
  dueInHours: number;
  autoChange: {
    inHours: number;
    toStep: number;
  };
  reminderFrequencyInHours: number;
  stepType: string;
};

export type FlIncidentsConf = {
  id: number;
  name: string;
  condition: string;
  conditionVal: string;
  fields: Array<Record<string, unknown>>;
  isCustom: boolean;
  isHidden: boolean;
  notConfigurable: boolean;
};

interface Column {
  name: string,
  allowNull: Boolean,
  type: string;
}

//Edits to the columns:
//1) removed [CREDIT NOTE] as duplicate of [Credit Note]
//2) trimmed the really long potbelly column name that was > 128 characters
//3) set Id to VARCHAR(100)
const allColumns: Record<string,Column> = {
  'Id': {name: 'Id', type: 'VARCHAR(100)', allowNull: false },
  'Incident ID': {name: 'Incident ID', type: 'VARCHAR(max)', allowNull: false },
  'Incident Type': {name: 'Incident Type', type: 'VARCHAR(max)', allowNull: false },
  'Current Status': {name: 'Current Status', type:'VARCHAR(max)', allowNull: false },
  'Last Updated At': {name: 'Last Updated At', type:'DATE', allowNull: false },
  'Last Updated By': {name: 'Last Updated By', type:'VARCHAR(max)', allowNull: false },
  'Reported By': {name: 'Reported By', type:'VARCHAR(max)', allowNull: false },
  'Created At': {name: 'Created At', type:'DATE', allowNull: false },
  'Created From': {name: 'Created From', type:'VARCHAR(max)', allowNull: false },
  'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)': {name: 'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)', type:'VARCHAR(max)', allowNull: false },
  'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)': {name: 'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)', type:'VARCHAR(max)', allowNull: false },
  'community (Community/Business Name)': {name: 'community (Community/Business Name)', type:'VARCHAR(max)', allowNull: false },
  'incidentDate (Incident Date/Date of Delivery/Delivery Date)': {name: 'incidentDate (Incident Date/Date of Delivery/Delivery Date)', type:'DATE', allowNull: false },
  'Customer Complaint Related': {name: 'Customer Complaint Related', type:'BIT', allowNull: false },
  'Still have the product?': {name: 'Still have the product?', type:'BIT', allowNull: false },
  'quantityAffected (Quantity Affected/Affected Quantity)': {name: 'quantityAffected (Quantity Affected/Affected Quantity)', type:'DECIMAL(38, 2)', allowNull: false },
  'IMAGE OF SUPPLIER CASE LABEL': {name: 'IMAGE OF SUPPLIER CASE LABEL', type:'BIT', allowNull: false },
  'IMAGE(s) OF ISSUE AND QUANTITY AFFECTED': {name: 'IMAGE(s) OF ISSUE AND QUANTITY AFFECTED', type:'BIT', allowNull: false },
  'IMAGE OF DISTRIBUTOR LABEL, if applicable': {name: 'IMAGE OF DISTRIBUTOR LABEL, if applicable', type:'BIT', allowNull: false },
  'PPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT': {name: 'PPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT', type:'BIT', allowNull: false },
  'Supplier Investigation Report': {name: 'Supplier Investigation Report', type:'BIT', allowNull: false },
  'Corrective Action Report': {name: 'Corrective Action Report', type:'BIT', allowNull: false },
  'images (Photo of Case Labels & Product/Photos or Documents)': {name: 'images (Photo of Case Labels & Product/Photos or Documents)', type:'BIT', allowNull: false },
  'product (Product GTIN/Product Name GTIN/Material GTIN)': {name: 'product (Product GTIN/Product Name GTIN/Material GTIN)', type:'VARCHAR(max)', allowNull: false },
  'Invoice Photo': {name: 'Invoice Photo', type:'BIT', allowNull: false },
  'Incident Photo(s)': {name: 'Incident Photo(s)', type:'BIT', allowNull: false },
  'Supplier Label': {name: 'Supplier Label', type:'BIT', allowNull: false },
  'DC Pick Label': {name: 'DC Pick Label', type:'BIT', allowNull: false },
  'Purchase Order Image': {name: 'Purchase Order Image', type:'BIT', allowNull: false },
  'Invoice Image': {name: 'Invoice Image', type:'BIT', allowNull: false },
  'SUPPLIER INVESTIGATION REPORT(S)': {name: 'SUPPLIER INVESTIGATION REPORT(S)', type:'BIT', allowNull: false },
  'CORRECTIVE ACTION REPORTS': {name: 'CORRECTIVE ACTION REPORTS', type:'BIT', allowNull: false },
  'SUPPLIER CREDIT DOCUMENTATION': {name: 'SUPPLIER CREDIT DOCUMENTATION', type:'BIT', allowNull: false },
  'Supplier Documentation / Photos': {name: 'Supplier Documentation / Photos', type:'BIT', allowNull: false },
  'DC Documentation / Photos': {name: 'DC Documentation / Photos', type:'BIT', allowNull: false },
  'Corrective Action Document': {name: 'Corrective Action Document', type:'BIT', allowNull: false },
  'Credit note to supplier': {name: 'Credit note to supplier', type:'BIT', allowNull: false },
  'Credit Note': {name: 'Credit Note', type:'BIT', allowNull: false },
  'Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT': {name: 'Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT', type:'BIT', allowNull: false },
  'Produce Supplier + Distributor Investigation/Corrective Action Report': {name: 'Produce Supplier + Distributor Investigation/Corrective Action Report', type:'BIT', allowNull: false },
  'Supporting Details': {name: 'Supporting Details', type:'BIT', allowNull: false },
  'Supporting Document': {name: 'Supporting Document', type:'BIT', allowNull: false },
  'Photos or Documents': {name: 'Photos or Documents', type:'BIT', allowNull: false },
  'Supplier Photos or Documents': {name: 'Supplier Photos or Documents', type:'BIT', allowNull: false },
  'Distribution Center Photos or Documents': {name: 'Distribution Center Photos or Documents', type:'BIT', allowNull: false },
  'Load/Pallet Issue': {name: 'Load/Pallet Issue', type:'BIT', allowNull: false },
  'Trailer Number Photo': {name: 'Trailer Number Photo', type:'BIT', allowNull: false },
  'Document/BOL': {name: 'Document/BOL', type:'BIT', allowNull: false },
  'Case Label': {name: 'Case Label', type:'BIT', allowNull: false },
  'Other as Necessary': {name: 'Other as Necessary', type:'BIT', allowNull: false },
  'Evidence of Correction': {name: 'Evidence of Correction', type:'BIT', allowNull: false },
  'Evidence to Reassign': {name: 'Evidence to Reassign', type:'BIT', allowNull: false },
  'Combo/Case Label': {name: 'Combo/Case Label', type:'BIT', allowNull: false },
  'Quality Defect': {name: 'Quality Defect', type:'BIT', allowNull: false },
  'RCA Documentation': {name: 'RCA Documentation', type:'BIT', allowNull: false },
  'Additional Documentation': {name: 'Additional Documentation', type:'BIT', allowNull: false },
  'Due Date': {name: 'Due Date', type:'DATETIME', allowNull: true},
  'Issued By': {name: 'Issued By', type:'VARCHAR(max)', allowNull: true},
  'Title': {name: 'Title', type:'VARCHAR(max)', allowNull: true},
  'distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)': {name: 'distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)', type:'VARCHAR(max)', allowNull: true},
  'Country': {name: 'Country', type:'VARCHAR(max)', allowNull: true},
  'Type of Product Issue': {name: 'Type of Product Issue', type:'VARCHAR(max)', allowNull: true},
  'Type of Foreign Material': {name: 'Type of Foreign Material', type:'VARCHAR(max)', allowNull: true},
  'Type of Distribution Issue': {name: 'Type of Distribution Issue', type:'VARCHAR(max)', allowNull: true},
  'Type of Quality Issue': {name: 'Type of Quality Issue', type:'VARCHAR(max)', allowNull: true},
  'Description': {name: 'Description', type:'VARCHAR(max)', allowNull: true},
  'Do you still have the foreign object?': {name: 'Do you still have the foreign object?', type:'BIT', allowNull: true},
  'Requesting Credit?': {name: 'Requesting Credit?', type:'BIT', allowNull: true},
  'Invoice Date / Delivery Date': {name: 'Invoice Date / Delivery Date', type:'DATE', allowNull: true},
  'Invoice Number': {name: 'Invoice Number', type:'VARCHAR(max)', allowNull: true},
  'Affected Quantity': {name: 'Affected Quantity', type:'DECIMAL(38, 2)', allowNull: true},
  'Unit of Measurement': {name: 'Unit of Measurement', type:'VARCHAR(max)', allowNull: true},
  'productType (Product Name/Product Type/QA Product Category/Material Category)': {name: 'productType (Product Name/Product Type/QA Product Category/Material Category)', type:'VARCHAR(max)', allowNull: true},
  'Item Name': {name: 'Item Name', type:'BIT', allowNull: true},
  'sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)': {name: 'sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)', type:'VARCHAR(max)', allowNull: true},
  'Supplier Status': {name: 'Supplier Status', type:'VARCHAR(max)', allowNull: true},
  'Pack Date / Grind Date / Manufacture Date': {name: 'Pack Date / Grind Date / Manufacture Date', type:'BIT', allowNull: true},
  'Run Time': {name: 'Run Time', type:'BIT', allowNull: true},
  'Use By Date / Freeze By Date / Expiration Date': {name: 'Use By Date / Freeze By Date / Expiration Date', type:'DATE', allowNull: true},
  'Production Date / Julian Code / Case Code / Batch Code / Lot Code': {name: 'Production Date / Julian Code / Case Code / Batch Code / Lot Code', type:'VARCHAR(max)', allowNull: true},
  'Hold or Isolate': {name: 'Hold or Isolate', type:'BIT', allowNull: true},
  'Confirm Credit Request': {name: 'Confirm Credit Request', type:'BIT', allowNull: true},
  'Review and Action Comments': {name: 'Review and Action Comments', type:'VARCHAR(max)', allowNull: true},
  'supplierLocation (Supplier Location/Supplier Manufacturing Location)': {name: 'supplierLocation (Supplier Location/Supplier Manufacturing Location)', type:'VARCHAR(max)', allowNull: true},
  'Supplier Corrective Action': {name: 'Supplier Corrective Action', type:'VARCHAR(max)', allowNull: true},
  'Supplier Credit Decision': {name: 'Supplier Credit Decision', type:'VARCHAR(max)', allowNull: true},
  'Supplier Credit Approval - Rep Name': {name: 'Supplier Credit Approval - Rep Name', type:'VARCHAR(max)', allowNull: true},
  'Quantity Credit Amount (Not Dollars)': {name: 'Quantity Credit Amount (Not Dollars)', type:'DECIMAL(38, 0)', allowNull: true},
  'Quantity Unit of Measure': {name: 'Quantity Unit of Measure', type:'VARCHAR(max)', allowNull: true},
  'Comment': {name: 'Comment', type:'VARCHAR(max)', allowNull: true},
  'Credit Decision': {name: 'Credit Decision', type:'VARCHAR(max)', allowNull: true},
  'Credit Number': {name: 'Credit Number', type:'VARCHAR(max)', allowNull: true},
  'Credit Amount': {name: 'Credit Amount', type:'DECIMAL(38, 2)', allowNull: true},
  'Currency': {name: 'Currency', type:'VARCHAR(max)', allowNull: true},
  'Hold Product': {name: 'Hold Product', type:'BIT', allowNull: true},
  'Hold Comments': {name: 'Hold Comments', type:'BIT', allowNull: true},
  'Isolate Product': {name: 'Isolate Product', type:'BIT', allowNull: true},
  'Isolate Comments': {name: 'Isolate Comments', type:'BIT', allowNull: true},
  'CM Team Notified': {name: 'CM Team Notified', type:'BIT', allowNull: true},
  'CM Team Activated': {name: 'CM Team Activated', type:'BIT', allowNull: true},
  'Reason for Request': {name: 'Reason for Request', type:'VARCHAR(max)', allowNull: true},
  'Please describe further': {name: 'Please describe further', type:'VARCHAR(max)', allowNull: true},
  'Enter Product Name': {name: 'Enter Product Name', type:'VARCHAR(max)', allowNull: true},
  'Distributor Item Number': {name: 'Distributor Item Number', type:'VARCHAR(max)', allowNull: true},
  'Best By/Expiration Date': {name: 'Best By/Expiration Date', type:'DATE', allowNull: true},
  'Do you have enough usable product to last you until next delivery?': {name: 'Do you have enough usable product to last you until next delivery?', type:'BIT', allowNull: true},
  'Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ': {name: 'Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ', type:'BIT', allowNull: true},
  'Please describe why you are not emailing _supplychain@potbelly.com': {name: 'Please describe why you are not emailing _supplychain@potbelly.com', type:'VARCHAR(max)', allowNull: true},
  'Lot Code (enter N/A if this was a short)': {name: 'Lot Code (enter N/A if this was a short)', type:'VARCHAR(max)', allowNull: true},
  'product (Product Name Name/Material Name/Product Name)': {name: 'product (Product Name Name/Material Name/Product Name)', type:'VARCHAR(max)', allowNull: true},
  'product (Product Name LOT/Material LOT/Product LOT)': {name: 'product (Product Name LOT/Material LOT/Product LOT)', type:'VARCHAR(max)', allowNull: true},
  'Reason for DC Denial': {name: 'Reason for DC Denial', type:'VARCHAR(max)', allowNull: true},
  'Credit Memo': {name: 'Credit Memo', type:'DECIMAL(38, 2)', allowNull: true},
  'Credit Amount Approved': {name: 'Credit Amount Approved', type:'VARCHAR(max)', allowNull: true},
  'DC Comments': {name: 'DC Comments', type:'VARCHAR(max)', allowNull: true},
  'Reason for Supplier Denial': {name: 'Reason for Supplier Denial', type:'BIT', allowNull: true},
  'Supplier Comments': {name: 'Supplier Comments', type:'BIT', allowNull: true},
  'Comments': {name: 'Comments', type:'VARCHAR(max)', allowNull: true},
  'Credit Decision by DC': {name: 'Credit Decision by DC', type:'VARCHAR(max)', allowNull: true},
  'Rejection Reason': {name: 'Rejection Reason', type:'BIT', allowNull: true},
  'Credit Type': {name: 'Credit Type', type:'BIT', allowNull: true},
  'Type of Delivery Incident': {name: 'Type of Delivery Incident', type:'VARCHAR(max)', allowNull: true},
  'Still have the product': {name: 'Still have the product', type:'BIT', allowNull: true},
  'Do you still have the foreign object?  If so, please hold for further investigation.': {name: 'Do you still have the foreign object?  If so, please hold for further investigation.', type:'BIT', allowNull: true},
  'Date Product Was Received': {name: 'Date Product Was Received', type:'BIT', allowNull: true},
  'Pack Date / Manufacture Date': {name: 'Pack Date / Manufacture Date', type:'BIT', allowNull: true},
  'Shelf Life Issue': {name: 'Shelf Life Issue', type:'BIT', allowNull: true},
  'Supplier Initial Assessment': {name: 'Supplier Initial Assessment', type:'BIT', allowNull: true},
  'Supplier Credit Number': {name: 'Supplier Credit Number', type:'DECIMAL(38, 0)', allowNull: true},
  'Distribution Company': {name: 'Distribution Company', type:'BIT', allowNull: true},
  'Incident Acknowledged?': {name: 'Incident Acknowledged?', type:'BIT', allowNull: true},
  'Brand': {name: 'Brand', type:'VARCHAR(max)', allowNull: true},
  'Restaurant Contact Name': {name: 'Restaurant Contact Name', type:'VARCHAR(max)', allowNull: true},
  'Restaurant Phone Number': {name: 'Restaurant Phone Number', type:'VARCHAR(max)', allowNull: true},
  'Date Product Received': {name: 'Date Product Received', type:'DATE', allowNull: true},
  'DC Invoice Number': {name: 'DC Invoice Number', type:'DECIMAL(38, 0)', allowNull: true},
  'HAVI Product ID': {name: 'HAVI Product ID', type:'BIT', allowNull: true},
  'Manufacturer Code': {name: 'Manufacturer Code', type:'DECIMAL(38, 0)', allowNull: true},
  'DC Product Code': {name: 'DC Product Code', type:'DECIMAL(38, 0)', allowNull: true},
  'Best By/Use By Date': {name: 'Best By/Use By Date', type:'DATE', allowNull: true},
  'Complaint Type': {name: 'Complaint Type', type:'VARCHAR(max)', allowNull: true},
  'Complaint Subtype - Foreign Object': {name: 'Complaint Subtype - Foreign Object', type:'VARCHAR(max)', allowNull: true},
  'Complaint Subtype - Low Piece Count': {name: 'Complaint Subtype - Low Piece Count', type:'VARCHAR(max)', allowNull: true},
  'Complaint Subtype - Size and Weight': {name: 'Complaint Subtype - Size and Weight', type:'VARCHAR(max)', allowNull: true},
  'Complaint Subtype - Temperature Abuse': {name: 'Complaint Subtype - Temperature Abuse', type:'BIT', allowNull: true},
  'Complaint Subtype - Packaging': {name: 'Complaint Subtype - Packaging', type:'BIT', allowNull: true},
  'Complaint Subtype - Shelf Life': {name: 'Complaint Subtype - Shelf Life', type:'BIT', allowNull: true},
  'Complaint Subtype - Product Performance': {name: 'Complaint Subtype - Product Performance', type:'BIT', allowNull: true},
  'Complaint Subtype - Appearance': {name: 'Complaint Subtype - Appearance', type:'VARCHAR(max)', allowNull: true},
  'Complaint Subtype - Fresh Produce': {name: 'Complaint Subtype - Fresh Produce', type:'BIT', allowNull: true},
  'Complaint Details': {name: 'Complaint Details', type:'VARCHAR(max)', allowNull: true},
  'Quantity Affected': {name: 'Quantity Affected', type:'VARCHAR(max)', allowNull: true},
  'Additional Comments': {name: 'Additional Comments', type:'VARCHAR(max)', allowNull: true},
  'Fresh Produce DC Credit Decision': {name: 'Fresh Produce DC Credit Decision', type:'BIT', allowNull: true},
  'Fresh Produce DC Comments': {name: 'Fresh Produce DC Comments', type:'BIT', allowNull: true},
  'Feedback for Supplier': {name: 'Feedback for Supplier', type:'VARCHAR(max)', allowNull: true},
  'Supplier Additional Comments': {name: 'Supplier Additional Comments', type:'VARCHAR(max)', allowNull: true},
  'Reason For Denial': {name: 'Reason For Denial', type:'BIT', allowNull: true},
  'DC Credit Decision': {name: 'DC Credit Decision', type:'VARCHAR(max)', allowNull: true},
  'DC Additional Comments': {name: 'DC Additional Comments', type:'VARCHAR(max)', allowNull: true},
  'DC Reason For Denial': {name: 'DC Reason For Denial', type:'VARCHAR(max)', allowNull: true},
  'DC Corrective Action': {name: 'DC Corrective Action', type:'BIT', allowNull: true},
  'Corrective Action - Distributor Revised': {name: 'Corrective Action - Distributor Revised', type:'BIT', allowNull: true},
  'Produce Supplier + Distributor Credit Decision': {name: 'Produce Supplier + Distributor Credit Decision', type:'BIT', allowNull: true},
  'Quantity Credit Amount (Not currency)': {name: 'Quantity Credit Amount (Not currency)', type:'BIT', allowNull: true},
  'Produce Supplier + Distributor Corrective Action': {name: 'Produce Supplier + Distributor Corrective Action', type:'BIT', allowNull: true},
  'Failure Group': {name: 'Failure Group', type:'VARCHAR(max)', allowNull: true},
  'Failure Type': {name: 'Failure Type', type:'VARCHAR(max)', allowNull: true},
  'Severity': {name: 'Severity', type:'VARCHAR(max)', allowNull: true},
  'Additional Vendor Batch/Lots': {name: 'Additional Vendor Batch/Lots', type:'BIT', allowNull: true},
  'Quantity': {name: 'Quantity', type:'DECIMAL(38, 0)', allowNull: true},
  'Unit of Measure': {name: 'Unit of Measure', type:'VARCHAR(max)', allowNull: true},
  'PO Number': {name: 'PO Number', type:'DECIMAL(38, 0)', allowNull: true},
  'Inbound Freight Carrier': {name: 'Inbound Freight Carrier', type:'BIT', allowNull: true},
  'Initial Disposition': {name: 'Initial Disposition', type:'VARCHAR(max)', allowNull: true},
  'Downtime Caused (when applicable)': {name: 'Downtime Caused (when applicable)', type:'BIT', allowNull: true},
  'Potential for Claim': {name: 'Potential for Claim', type:'BIT', allowNull: true},
  'Root Cause': {name: 'Root Cause', type:'BIT', allowNull: true},
  'Action Plan': {name: 'Action Plan', type:'VARCHAR(max)', allowNull: true},
  'Responsible Party': {name: 'Responsible Party', type:'BIT', allowNull: true},
  'Additional Notes': {name: 'Additional Notes', type:'BIT', allowNull: true},
  'Final Disposition': {name: 'Final Disposition', type:'BIT', allowNull: true},
  'Resolution Details': {name: 'Resolution Details', type:'BIT', allowNull: true},
  'Best By Date': {name: 'Best By Date', type:'DATE', allowNull: true},
  'Incident Issue': {name: 'Incident Issue', type:'VARCHAR(max)', allowNull: true},
  'Appearance Issue': {name: 'Appearance Issue', type:'VARCHAR(max)', allowNull: true},
  'Fatty / Excess Fat Issue': {name: 'Fatty / Excess Fat Issue', type:'BIT', allowNull: true},
  'Foreign Object Issue': {name: 'Foreign Object Issue', type:'BIT', allowNull: true},
  'Fresh Produce Issue': {name: 'Fresh Produce Issue', type:'BIT', allowNull: true},
  'Fresh Produce Credit Decision': {name: 'Fresh Produce Credit Decision', type:'BIT', allowNull: true},
  'Low Piece Count': {name: 'Low Piece Count', type:'VARCHAR(max)', allowNull: true},
  'Off Odor / Flavor Issue': {name: 'Off Odor / Flavor Issue', type:'VARCHAR(max)', allowNull: true},
  'Packaging Issue': {name: 'Packaging Issue', type:'BIT', allowNull: true},
  'Product Performance Issue': {name: 'Product Performance Issue', type:'BIT', allowNull: true},
  'Size and Weight Issue': {name: 'Size and Weight Issue', type:'BIT', allowNull: true},
  'Temperature Abuse Issue': {name: 'Temperature Abuse Issue', type:'BIT', allowNull: true},
  'Wrong Product Issue': {name: 'Wrong Product Issue', type:'VARCHAR(max)', allowNull: true},
  'Incident Details': {name: 'Incident Details', type:'VARCHAR(max)', allowNull: true},
  'Supplier Credit Denial Reason': {name: 'Supplier Credit Denial Reason', type:'BIT', allowNull: true},
  'Dine Brands Quality Assurance Feedback': {name: 'Dine Brands Quality Assurance Feedback', type:'BIT', allowNull: true},
  'Distribution Center Credit Decision': {name: 'Distribution Center Credit Decision', type:'BIT', allowNull: true},
  'Distribution Center Credit Denial Reason': {name: 'Distribution Center Credit Denial Reason', type:'BIT', allowNull: true},
  'Distribution Center Additional Comments': {name: 'Distribution Center Additional Comments', type:'BIT', allowNull: true},
  'PO# / STO#': {name: 'PO# / STO#', type:'DECIMAL(38, 0)', allowNull: true},
  'Does your SAP plant number begin with a 2?': {name: 'Does your SAP plant number begin with a 2?', type:'BIT', allowNull: true},
  'Batch Code': {name: 'Batch Code', type:'VARCHAR(max)', allowNull: true},
  'Inbound Issue': {name: 'Inbound Issue', type:'VARCHAR(max)', allowNull: true},
  'Inbound Issue Details/Comments': {name: 'Inbound Issue Details/Comments', type:'VARCHAR(max)', allowNull: true},
  'Quantity Involved': {name: 'Quantity Involved', type:'DECIMAL(38, 0)', allowNull: true},
  'Labor Hours to Correct': {name: 'Labor Hours to Correct', type:'DECIMAL(38, 1)', allowNull: true},
  'Incident Investigator Comments': {name: 'Incident Investigator Comments', type:'VARCHAR(max)', allowNull: true},
  'Please provide root cause analysis': {name: 'Please provide root cause analysis', type:'VARCHAR(max)', allowNull: true},
  'Root Cause Analysis Resolution': {name: 'Root Cause Analysis Resolution', type:'VARCHAR(max)', allowNull: true},
  'What is the root cause?': {name: 'What is the root cause?', type:'VARCHAR(max)', allowNull: true},
  'What are the corrections you have made?': {name: 'What are the corrections you have made?', type:'VARCHAR(max)', allowNull: true},
  'What are the preventive measures you have taken?': {name: 'What are the preventive measures you have taken?', type:'VARCHAR(max)', allowNull: true},
  'CAPA Resolution': {name: 'CAPA Resolution', type:'VARCHAR(max)', allowNull: true},
  'Triage Manager Comments': {name: 'Triage Manager Comments', type:'VARCHAR(max)', allowNull: true},
  'Incident Investigator Review Comments': {name: 'Incident Investigator Review Comments', type:'VARCHAR(max)', allowNull: true},
  'Reporter Review Comments': {name: 'Reporter Review Comments', type:'VARCHAR(max)', allowNull: true},
  'Reason for incorrect information decision': {name: 'Reason for incorrect information decision', type:'VARCHAR(max)', allowNull: true},
  'Please confirm that you received the notification from "info@foodlogiq.com"': {name: 'Please confirm that you received the notification from "info@foodlogiq.com"', type:'VARCHAR(max)', allowNull: true},
  'Reporter Name': {name: 'Reporter Name', type:'VARCHAR(max)', allowNull: true},
  'Reporter Phone': {name: 'Reporter Phone', type:'VARCHAR(max)', allowNull: true},
  'Internal Supplier': {name: 'Internal Supplier', type:'VARCHAR(max)', allowNull: true},
  'Est No': {name: 'Est No', type:'VARCHAR(max)', allowNull: true},
  'Defect Group': {name: 'Defect Group', type:'VARCHAR(max)', allowNull: true},
  'Appearance/Color Defect Type': {name: 'Appearance/Color Defect Type', type:'BIT', allowNull: true},
  'Describe the Misc. Color': {name: 'Describe the Misc. Color', type:'BIT', allowNull: true},
  'Fat Defect Type': {name: 'Fat Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Foreign Materials Defect Type': {name: 'Foreign Materials Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Indigenous Materials Defect Type': {name: 'Indigenous Materials Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Labeling Defect Type': {name: 'Labeling Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Meat Quality Defect Type': {name: 'Meat Quality Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Off Condition Defect Type': {name: 'Off Condition Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Other Defect Type': {name: 'Other Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Package Condition Defect Type': {name: 'Package Condition Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Packaging Defect Type': {name: 'Packaging Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Product Age/Dating Defect Type': {name: 'Product Age/Dating Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Scheduling Defect Type': {name: 'Scheduling Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Shipping Defect Type': {name: 'Shipping Defect Type', type:'VARCHAR(max)', allowNull: true},
  'Temperature Defect Type': {name: 'Temperature Defect Type', type:'BIT', allowNull: true},
  'Transportation Defect Type': {name: 'Transportation Defect Type', type:'BIT', allowNull: true},
  'Weight/Fill Defect Type': {name: 'Weight/Fill Defect Type', type:'BIT', allowNull: true},
  'Problem Statement': {name: 'Problem Statement', type:'VARCHAR(max)', allowNull: true},
  'Do you acknowledge the incident as defined above?': {name: 'Do you acknowledge the incident as defined above?', type:'BIT', allowNull: true},
  'Will you begin investigation of the incident as described above?': {name: 'Will you begin investigation of the incident as described above?', type:'BIT', allowNull: true},
  'Please provide Root Cause': {name: 'Please provide Root Cause', type:'VARCHAR(max)', allowNull: true},
  'What is the preventive measure?': {name: 'What is the preventive measure?', type:'VARCHAR(max)', allowNull: true},
  'FSQA Manager Comments': {name: 'FSQA Manager Comments', type:'VARCHAR(max)', allowNull: true},
  'Rejection Action': {name: 'Rejection Action', type:'VARCHAR(max)', allowNull: true},
  'Reporter Comment': {name: 'Reporter Comment', type:'BIT', allowNull: true},
  'Buyer Final Review': {name: 'Buyer Final Review', type:'VARCHAR(max)', allowNull: true},
  'Buyer Final Review Comments': {name: 'Buyer Final Review Comments', type:'VARCHAR(max)', allowNull: true},
  'Reporter Final Review': {name: 'Reporter Final Review', type:'BIT', allowNull: true},
  'Protein Type': {name: 'Protein Type', type:'VARCHAR(max)', allowNull: true},
  'Do you have enough information to begin investigation of the incident as defined above?': {name: 'Do you have enough information to begin investigation of the incident as defined above?', type:'BIT', allowNull: true},
  'What information is still needed?': {name: 'What information is still needed?', type:'VARCHAR(max)', allowNull: true}
};



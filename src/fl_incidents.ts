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

import axios, { AxiosRequestConfig } from 'axios';
import _ from 'lodash';
//@ts-ignore
import csvjson from 'csvjson';
import debug from 'debug';
import moment, { Moment } from 'moment';
import { poll } from '@oada/poll';
import sql from 'mssql';

import type { JsonObject, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
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
const { database, server, user, password, port, interval } = config.get('incidents');

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
        data: { 'food-logiq-mirror': item } as unknown as Body,
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

  const csvData = csvjson.toObject(response.data, { delimiter: ",", quote: '"' });

  if (csvData.length > 0) {
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
  const matches = tables.recordset.filter((obj: any) => obj.TABLE_NAME === 'incidents')

  console.log(matches.length)
  if (matches.length === 0) {
    const query = `create table incidents (${TableColumns} PRIMARY KEY (Id))`;
    await sql.query(query)
    trace(`Creating incidents table: ${query}`);
  }

}

function prepRow(row: any) {
  if (row['CREDIT NOTE']) {
    delete row['CREDIT NOTE'];
  }

  let oldKey = `Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? (Be sure to include your FoodLogiQ Incident ID in your email)`;
  if (row[oldKey]) {
    let newKey =
      `Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options?`;
    row[newKey] = row[oldKey];
    delete row[oldKey];
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
    console.log('Row in', row);
    let newRow = prepRow(row);
    newRow = Object.fromEntries(
      ColumnKeys.map((key) => {
        if (!isNaN(Number(newRow[key]))) {
          return [key, Number(newRow[key])];
        } else if (newRow[key] === 'true' || newRow[key] === 'false') {
          return [key, newRow[key] === 'true'];
        } else if (!newRow[key]) {
          return [key, 'NULL'];
        } else {
          return [key, `'${newRow[key]}'`]
        }
      })
    );

    const selectString = ColumnKeys.map(
      (key) => `${newRow[key]} AS ${key}`).join(',');
    const setString = ColumnKeys.map(
      (key) => `SET ${key} = ${newRow[key]}`).join(' AND ');
    const targetString = ColumnKeys.map(
      (key) => `target.${key} = source.${key}`).join(',');

    const cols = ColumnKeys.join(',');
    const values = ColumnKeys.map((key) => newRow[key]).join(',');

    const query = `MERGE
      INTO incidents.incidents WITH (HOLDLOCK) AS target
      USING (SELECT ${selectString}) AS source
      (${cols})
      ON (${targetString})
      WHEN MATCHED
        THEN UPDATE
          SET ${setString}
      WHEN NOT MATCHED
        THEN INSERT (${cols})
        VALUES (${values})`
    trace(`SQL Query: %s`, query);
    await sql.query(query);
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
        data: { 'food-logiq-mirror': item } as unknown as Body,
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


//Edits to the columns:
//1) removed [CREDIT NOTE] as duplicate of [Credit Note]
//2) trimmed the really long potbelly column name that was > 128 characters
//3) set Id to VARCHAR(100)

const TableColumns = `
  [Id] VARCHAR(100) NOT NULL,
  [Incident ID] VARCHAR(max) NOT NULL,
  [Incident Type] VARCHAR(max) NOT NULL,
  [Current Status] VARCHAR(max) NOT NULL,
  [Last Updated At] DATE NOT NULL,
  [Last Updated By] VARCHAR(max) NOT NULL,
  [Due Date] DATETIME NULL,
  [Reported By] VARCHAR(max) NOT NULL,
  [Created At] DATE NOT NULL,
  [Created From] VARCHAR(max) NOT NULL,
  [location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)] VARCHAR(max) NOT NULL,
  [location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)] VARCHAR(max) NOT NULL,
  [community (Community/Business Name)] VARCHAR(max) NOT NULL,
  [incidentDate (Incident Date/Date of Delivery/Delivery Date)] DATE NOT NULL,
  [Issued By] VARCHAR(max) NULL,
  [Title] VARCHAR(max) NULL,
  [distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)] VARCHAR(max) NULL,
  [Country] VARCHAR(max) NULL,
  [Type of Product Issue] VARCHAR(max) NULL,
  [Type of Foreign Material] VARCHAR(max) NULL,
  [Type of Distribution Issue] VARCHAR(max) NULL,
  [Type of Quality Issue] VARCHAR(max) NULL,
  [Description] VARCHAR(max) NULL,
  [Customer Complaint Related] BIT NOT NULL,
  [Still have the product?] BIT NOT NULL,
  [Do you still have the foreign object?] BIT NULL,
  [Requesting Credit?] BIT NULL,
  [Invoice Date / Delivery Date] DATE NULL,
  [Invoice Number] VARCHAR(max) NULL,
  [Affected Quantity] DECIMAL(38, 2) NULL,
  [Unit of Measurement] VARCHAR(max) NULL,
  [productType (Product Name/Product Type/QA Product Category/Material Category)] VARCHAR(max) NULL,
  [Item Name] BIT NULL,
  [sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)] VARCHAR(max) NULL,
  [Supplier Status] VARCHAR(max) NULL,
  [quantityAffected (Quantity Affected/Affected Quantity)] DECIMAL(38, 2) NOT NULL,
  [Pack Date / Grind Date / Manufacture Date] BIT NULL,
  [Run Time] BIT NULL,
  [Use By Date / Freeze By Date / Expiration Date] DATE NULL,
  [Production Date / Julian Code / Case Code / Batch Code / Lot Code] VARCHAR(max) NULL,
  [IMAGE OF SUPPLIER CASE LABEL] BIT NOT NULL,
  [IMAGE(s) OF ISSUE AND QUANTITY AFFECTED] BIT NOT NULL,
  [IMAGE OF DISTRIBUTOR LABEL, if applicable] BIT NOT NULL,
  [Hold or Isolate] BIT NULL,
  [Confirm Credit Request] BIT NULL,
  [Review and Action Comments] VARCHAR(max) NULL,
  [supplierLocation (Supplier Location/Supplier Manufacturing Location)] VARCHAR(max) NULL,
  [SUPPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT] BIT NOT NULL,
  [Supplier Corrective Action] VARCHAR(max) NULL,
  [Supplier Credit Decision] VARCHAR(max) NULL,
  [Supplier Credit Approval - Rep Name] VARCHAR(max) NULL,
  [Quantity Credit Amount (Not Dollars)] DECIMAL(38, 0) NULL,
  [Quantity Unit of Measure] VARCHAR(max) NULL,
  [Comment] VARCHAR(max) NULL,
  [Credit Decision] VARCHAR(max) NULL,
  [Credit Number] VARCHAR(max) NULL,
  [Credit Amount] DECIMAL(38, 2) NULL,
  [Currency] VARCHAR(max) NULL,
  [Hold Product] BIT NULL,
  [Hold Comments] BIT NULL,
  [Isolate Product] BIT NULL,
  [Isolate Comments] BIT NULL,
  [CM Team Notified] BIT NULL,
  [CM Team Activated] BIT NULL,
  [Supplier Investigation Report] BIT NOT NULL,
  [Corrective Action Report] BIT NOT NULL,
  [Reason for Request] VARCHAR(max) NULL,
  [Please describe further] VARCHAR(max) NULL,
  [Enter Product Name] VARCHAR(max) NULL,
  [Distributor Item Number] VARCHAR(max) NULL,
  [Best By/Expiration Date] DATE NULL,
  [Do you have enough usable product to last you until next delivery?] BIT NULL,
  [Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ] BIT NULL,
  [Please describe why you are not emailing _supplychain@potbelly.com] VARCHAR(max) NULL,
  [Lot Code (enter N/A if this was a short)] VARCHAR(max) NULL,
  [images (Photo of Case Labels & Product/Photos or Documents)] BIT NOT NULL,
  [product (Product Name Name/Material Name/Product Name)] VARCHAR(max) NULL,
  [product (Product GTIN/Product Name GTIN/Material GTIN)] VARCHAR(max) NOT NULL,
  [product (Product Name LOT/Material LOT/Product LOT)] VARCHAR(max) NULL,
  [Reason for DC Denial] VARCHAR(max) NULL,
  [Credit Memo] DECIMAL(38, 2) NULL,
  [Credit Amount Approved] VARCHAR(max) NULL,
  [DC Comments] VARCHAR(max) NULL,
  [Reason for Supplier Denial] BIT NULL,
  [Supplier Comments] BIT NULL,
  [Comments] VARCHAR(max) NULL,
  [Credit Decision by DC] VARCHAR(max) NULL,
  [Rejection Reason] BIT NULL,
  [Credit Type] BIT NULL,
  [Type of Delivery Incident] VARCHAR(max) NULL,
  [Still have the product] BIT NULL,
  [Do you still have the foreign object?  If so, please hold for further investigation.] BIT NULL,
  [Invoice Photo] BIT NOT NULL,
  [Date Product Was Received] BIT NULL,
  [Pack Date / Manufacture Date] BIT NULL,
  [Incident Photo(s)] BIT NOT NULL,
  [Supplier Label] BIT NOT NULL,
  [DC Pick Label] BIT NOT NULL,
  [Purchase Order Image] BIT NOT NULL,
  [Invoice Image] BIT NOT NULL,
  [Shelf Life Issue] BIT NULL,
  [Supplier Initial Assessment] BIT NULL,
  [SUPPLIER INVESTIGATION REPORT(S)] BIT NOT NULL,
  [CORRECTIVE ACTION REPORTS] BIT NOT NULL,
  [Supplier Credit Number] DECIMAL(38, 0) NULL,
  [SUPPLIER CREDIT DOCUMENTATION] BIT NOT NULL,
  [Distribution Company] BIT NULL,
  [Incident Acknowledged?] BIT NULL,
  [Brand] VARCHAR(max) NULL,
  [Restaurant Contact Name] VARCHAR(max) NULL,
  [Restaurant Phone Number] VARCHAR(max) NULL,
  [Date Product Received] DATE NULL,
  [DC Invoice Number] DECIMAL(38, 0) NULL,
  [HAVI Product ID] BIT NULL,
  [Manufacturer Code] DECIMAL(38, 0) NULL,
  [DC Product Code] DECIMAL(38, 0) NULL,
  [Best By/Use By Date] DATE NULL,
  [Complaint Type] VARCHAR(max) NULL,
  [Complaint Subtype - Foreign Object] VARCHAR(max) NULL,
  [Complaint Subtype - Low Piece Count] VARCHAR(max) NULL,
  [Complaint Subtype - Size and Weight] VARCHAR(max) NULL,
  [Complaint Subtype - Temperature Abuse] BIT NULL,
  [Complaint Subtype - Packaging] BIT NULL,
  [Complaint Subtype - Shelf Life] BIT NULL,
  [Complaint Subtype - Product Performance] BIT NULL,
  [Complaint Subtype - Appearance] VARCHAR(max) NULL,
  [Complaint Subtype - Fresh Produce] BIT NULL,
  [Complaint Details] VARCHAR(max) NULL,
  [Quantity Affected] VARCHAR(max) NULL,
  [Additional Comments] VARCHAR(max) NULL,
  [Fresh Produce DC Credit Decision] BIT NULL,
  [Fresh Produce DC Comments] BIT NULL,
  [Feedback for Supplier] VARCHAR(max) NULL,
  [Supplier Documentation / Photos] BIT NOT NULL,
  [Supplier Additional Comments] VARCHAR(max) NULL,
  [Reason For Denial] BIT NULL,
  [DC Credit Decision] VARCHAR(max) NULL,
  [DC Documentation / Photos] BIT NOT NULL,
  [DC Additional Comments] VARCHAR(max) NULL,
  [DC Reason For Denial] VARCHAR(max) NULL,
  [DC Corrective Action] BIT NULL,
  [Corrective Action - Distributor Revised] BIT NULL,
  [Corrective Action Document] BIT NOT NULL,
  [Credit note to supplier] BIT NOT NULL,
  [Produce Supplier + Distributor Credit Decision] BIT NULL,
  [Quantity Credit Amount (Not currency)] BIT NULL,
  [Credit Note] BIT NOT NULL,
  [Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT] BIT NOT NULL,
  [Produce Supplier + Distributor Corrective Action] BIT NULL,
  [Produce Supplier + Distributor Investigation/Corrective Action Report] BIT NOT NULL,
  [Failure Group] VARCHAR(max) NULL,
  [Failure Type] VARCHAR(max) NULL,
  [Severity] VARCHAR(max) NULL,
  [Supporting Details] BIT NOT NULL,
  [Additional Vendor Batch/Lots] BIT NULL,
  [Quantity] DECIMAL(38, 0) NULL,
  [Unit of Measure] VARCHAR(max) NULL,
  [PO Number] DECIMAL(38, 0) NULL,
  [Inbound Freight Carrier] BIT NULL,
  [Initial Disposition] VARCHAR(max) NULL,
  [Downtime Caused (when applicable)] BIT NULL,
  [Supporting Document] BIT NOT NULL,
  [Potential for Claim] BIT NULL,
  [Root Cause] BIT NULL,
  [Action Plan] VARCHAR(max) NULL,
  [Responsible Party] BIT NULL,
  [Additional Notes] BIT NULL,
  [Final Disposition] BIT NULL,
  [Resolution Details] BIT NULL,
  [Best By Date] DATE NULL,
  [Incident Issue] VARCHAR(max) NULL,
  [Appearance Issue] VARCHAR(max) NULL,
  [Fatty / Excess Fat Issue] BIT NULL,
  [Foreign Object Issue] BIT NULL,
  [Fresh Produce Issue] BIT NULL,
  [Fresh Produce Credit Decision] BIT NULL,
  [Low Piece Count] VARCHAR(max) NULL,
  [Off Odor / Flavor Issue] VARCHAR(max) NULL,
  [Packaging Issue] BIT NULL,
  [Product Performance Issue] BIT NULL,
  [Size and Weight Issue] BIT NULL,
  [Temperature Abuse Issue] BIT NULL,
  [Wrong Product Issue] VARCHAR(max) NULL,
  [Incident Details] VARCHAR(max) NULL,
  [Photos or Documents] BIT NOT NULL,
  [Supplier Photos or Documents] BIT NOT NULL,
  [Supplier Credit Denial Reason] BIT NULL,
  [Dine Brands Quality Assurance Feedback] BIT NULL,
  [Distribution Center Credit Decision] BIT NULL,
  [Distribution Center Photos or Documents] BIT NOT NULL,
  [Distribution Center Credit Denial Reason] BIT NULL,
  [Distribution Center Additional Comments] BIT NULL,
  [PO# / STO#] DECIMAL(38, 0) NULL,
  [Does your SAP plant number begin with a 2?] BIT NULL,
  [Batch Code] VARCHAR(max) NULL,
  [Inbound Issue] VARCHAR(max) NULL,
  [Inbound Issue Details/Comments] VARCHAR(max) NULL,
  [Quantity Involved] DECIMAL(38, 0) NULL,
  [Labor Hours to Correct] DECIMAL(38, 1) NULL,
  [Load/Pallet Issue] BIT NOT NULL,
  [Trailer Number Photo] BIT NOT NULL,
  [Document/BOL] BIT NOT NULL,
  [Case Label] BIT NOT NULL,
  [Other as Necessary] BIT NOT NULL,
  [Incident Investigator Comments] VARCHAR(max) NULL,
  [Please provide root cause analysis] VARCHAR(max) NULL,
  [Root Cause Analysis Resolution] VARCHAR(max) NULL,
  [What is the root cause?] VARCHAR(max) NULL,
  [What are the corrections you have made?] VARCHAR(max) NULL,
  [What are the preventive measures you have taken?] VARCHAR(max) NULL,
  [Evidence of Correction] BIT NOT NULL,
  [CAPA Resolution] VARCHAR(max) NULL,
  [Triage Manager Comments] VARCHAR(max) NULL,
  [Incident Investigator Review Comments] VARCHAR(max) NULL,
  [Reporter Review Comments] VARCHAR(max) NULL,
  [Reason for incorrect information decision] VARCHAR(max) NULL,
  [Evidence to Reassign] BIT NOT NULL,
  [Please confirm that you received the notification from "info@foodlogiq.com"] VARCHAR(max) NULL,
  [Reporter Name] VARCHAR(max) NULL,
  [Reporter Phone] VARCHAR(max) NULL,
  [Internal Supplier] VARCHAR(max) NULL,
  [Est No] VARCHAR(max) NULL,
  [Defect Group] VARCHAR(max) NULL,
  [Appearance/Color Defect Type] BIT NULL,
  [Describe the Misc. Color] BIT NULL,
  [Fat Defect Type] VARCHAR(max) NULL,
  [Foreign Materials Defect Type] VARCHAR(max) NULL,
  [Indigenous Materials Defect Type] VARCHAR(max) NULL,
  [Labeling Defect Type] VARCHAR(max) NULL,
  [Meat Quality Defect Type] VARCHAR(max) NULL,
  [Off Condition Defect Type] VARCHAR(max) NULL,
  [Other Defect Type] VARCHAR(max) NULL,
  [Package Condition Defect Type] VARCHAR(max) NULL,
  [Packaging Defect Type] VARCHAR(max) NULL,
  [Product Age/Dating Defect Type] VARCHAR(max) NULL,
  [Scheduling Defect Type] VARCHAR(max) NULL,
  [Shipping Defect Type] VARCHAR(max) NULL,
  [Temperature Defect Type] BIT NULL,
  [Transportation Defect Type] BIT NULL,
  [Weight/Fill Defect Type] BIT NULL,
  [Problem Statement] VARCHAR(max) NULL,
  [Combo/Case Label] BIT NOT NULL,
  [Quality Defect] BIT NOT NULL,
  [Do you acknowledge the incident as defined above?] BIT NULL,
  [Will you begin investigation of the incident as described above?] BIT NULL,
  [Please provide Root Cause] VARCHAR(max) NULL,
  [RCA Documentation] BIT NOT NULL,
  [What is the preventive measure?] VARCHAR(max) NULL,
  [FSQA Manager Comments] VARCHAR(max) NULL,
  [Rejection Action] VARCHAR(max) NULL,
  [Reporter Comment] BIT NULL,
  [Buyer Final Review] VARCHAR(max) NULL,
  [Buyer Final Review Comments] VARCHAR(max) NULL,
  [Reporter Final Review] BIT NULL,
  [Protein Type] VARCHAR(max) NULL,
  [Do you have enough information to begin investigation of the incident as defined above?] BIT NULL,
  [What information is still needed?] VARCHAR(max) NULL,
  [Additional Documentation] BIT NOT NULL,`;

const ColumnKeys = [
  'Id',
  'Incident ID',
  'Incident Type',
  'Current Status',
  'Last Updated At',
  'Last Updated By',
  'Due Date',
  'Reported By',
  'Created At',
  'Created From',
  'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)',
  'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)',
  'community (Community/Business Name)',
  'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'Issued By',
  'Title',
  'distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)',
  'Country',
  'Type of Product Issue',
  'Type of Foreign Material',
  'Type of Distribution Issue',
  'Type of Quality Issue',
  'Description',
  'Customer Complaint Related',
  'Still have the product?',
  'Do you still have the foreign object?',
  'Requesting Credit?',
  'Invoice Date / Delivery Date',
  'Invoice Number',
  'Affected Quantity',
  'Unit of Measurement',
  'productType (Product Name/Product Type/QA Product Category/Material Category)',
  'Item Name',
  'sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)',
  'Supplier Status',
  'quantityAffected (Quantity Affected/Affected Quantity)',
  'Pack Date / Grind Date / Manufacture Date',
  'Run Time',
  'Use By Date / Freeze By Date / Expiration Date',
  'Production Date / Julian Code / Case Code / Batch Code / Lot Code',
  'IMAGE OF SUPPLIER CASE LABEL',
  'IMAGE(s) OF ISSUE AND QUANTITY AFFECTED',
  'IMAGE OF DISTRIBUTOR LABEL, if applicable',
  'Hold or Isolate',
  'Confirm Credit Request',
  'Review and Action Comments',
  'supplierLocation (Supplier Location/Supplier Manufacturing Location)',
  'SUPPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT',
  'Supplier Corrective Action',
  'Supplier Credit Decision',
  'Supplier Credit Approval - Rep Name',
  'Quantity Credit Amount (Not Dollars)',
  'Quantity Unit of Measure',
  'Comment',
  'Credit Decision',
  'Credit Number',
  'Credit Amount',
  'Currency',
  'Hold Product',
  'Hold Comments',
  'Isolate Product',
  'Isolate Comments',
  'CM Team Notified',
  'CM Team Activated',
  'Supplier Investigation Report',
  'Corrective Action Report',
  'Reason for Request',
  'Please describe further',
  'Enter Product Name',
  'Distributor Item Number',
  'Best By/Expiration Date',
  'Do you have enough usable product to last you until next delivery?',
  'Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ',
  'Please describe why you are not emailing _supplychain@potbelly.com',
  'Lot Code (enter N/A if this was a short)',
  'images (Photo of Case Labels & Product/Photos or Documents)',
  'product (Product Name Name/Material Name/Product Name)',
  'product (Product GTIN/Product Name GTIN/Material GTIN)',
  'product (Product Name LOT/Material LOT/Product LOT)',
  'Reason for DC Denial',
  'Credit Memo',
  'Credit Amount Approved',
  'DC Comments',
  'Reason for Supplier Denial',
  'Supplier Comments',
  'Comments',
  'Credit Decision by DC',
  'Rejection Reason',
  'Credit Type',
  'Type of Delivery Incident',
  'Still have the product',
  'Do you still have the foreign object?  If so, please hold for further investigation.',
  'Invoice Photo',
  'Date Product Was Received',
  'Pack Date / Manufacture Date',
  'Incident Photo(s)',
  'Supplier Label',
  'DC Pick Label',
  'Purchase Order Image',
  'Invoice Image',
  'Shelf Life Issue',
  'Supplier Initial Assessment',
  'SUPPLIER INVESTIGATION REPORT(S)',
  'CORRECTIVE ACTION REPORTS',
  'Supplier Credit Number',
  'SUPPLIER CREDIT DOCUMENTATION',
  'Distribution Company',
  'Incident Acknowledged?',
  'Brand',
  'Restaurant Contact Name',
  'Restaurant Phone Number',
  'Date Product Received',
  'DC Invoice Number',
  'HAVI Product ID',
  'Manufacturer Code',
  'DC Product Code',
  'Best By/Use By Date',
  'Complaint Type',
  'Complaint Subtype - Foreign Object',
  'Complaint Subtype - Low Piece Count',
  'Complaint Subtype - Size and Weight',
  'Complaint Subtype - Temperature Abuse',
  'Complaint Subtype - Packaging',
  'Complaint Subtype - Shelf Life',
  'Complaint Subtype - Product Performance',
  'Complaint Subtype - Appearance',
  'Complaint Subtype - Fresh Produce',
  'Complaint Details',
  'Quantity Affected',
  'Additional Comments',
  'Fresh Produce DC Credit Decision',
  'Fresh Produce DC Comments',
  'Feedback for Supplier',
  'Supplier Documentation / Photos',
  'Supplier Additional Comments',
  'Reason For Denial',
  'DC Credit Decision',
  'DC Documentation / Photos',
  'DC Additional Comments',
  'DC Reason For Denial',
  'DC Corrective Action',
  'Corrective Action - Distributor Revised',
  'Corrective Action Document',
  'Credit note to supplier',
  'Produce Supplier + Distributor Credit Decision',
  'Quantity Credit Amount (Not currency)',
  'Credit Note',
  'Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT',
  'Produce Supplier + Distributor Corrective Action',
  'Produce Supplier + Distributor Investigation/Corrective Action Report',
  'Failure Group',
  'Failure Type',
  'Severity',
  'Supporting Details',
  'Additional Vendor Batch/Lots',
  'Quantity',
  'Unit of Measure',
  'PO Number',
  'Inbound Freight Carrier',
  'Initial Disposition',
  'Downtime Caused (when applicable)',
  'Supporting Document',
  'Potential for Claim',
  'Root Cause',
  'Action Plan',
  'Responsible Party',
  'Additional Notes',
  'Final Disposition',
  'Resolution Details',
  'Best By Date',
  'Incident Issue',
  'Appearance Issue',
  'Fatty / Excess Fat Issue',
  'Foreign Object Issue',
  'Fresh Produce Issue',
  'Fresh Produce Credit Decision',
  'Low Piece Count',
  'Off Odor / Flavor Issue',
  'Packaging Issue',
  'Product Performance Issue',
  'Size and Weight Issue',
  'Temperature Abuse Issue',
  'Wrong Product Issue',
  'Incident Details',
  'Photos or Documents',
  'Supplier Photos or Documents',
  'Supplier Credit Denial Reason',
  'Dine Brands Quality Assurance Feedback',
  'Distribution Center Credit Decision',
  'Distribution Center Photos or Documents',
  'Distribution Center Credit Denial Reason',
  'Distribution Center Additional Comments',
  'PO# / STO#',
  'Does your SAP plant number begin with a 2?',
  'Batch Code',
  'Inbound Issue',
  'Inbound Issue Details/Comments',
  'Quantity Involved',
  'Labor Hours to Correct',
  'Load/Pallet Issue',
  'Trailer Number Photo',
  'Document/BOL',
  'Case Label',
  'Other as Necessary',
  'Incident Investigator Comments',
  'Please provide root cause analysis',
  'Root Cause Analysis Resolution',
  'What is the root cause?',
  'What are the corrections you have made?',
  'What are the preventive measures you have taken?',
  'Evidence of Correction',
  'CAPA Resolution',
  'Triage Manager Comments',
  'Incident Investigator Review Comments',
  'Reporter Review Comments',
  'Reason for incorrect information decision',
  'Evidence to Reassign',
  'Please confirm that you received the notification from "info@foodlogiq.com"',
  'Reporter Name',
  'Reporter Phone',
  'Internal Supplier',
  'Est No',
  'Defect Group',
  'Appearance/Color Defect Type',
  'Describe the Misc. Color',
  'Fat Defect Type',
  'Foreign Materials Defect Type',
  'Indigenous Materials Defect Type',
  'Labeling Defect Type',
  'Meat Quality Defect Type',
  'Off Condition Defect Type',
  'Other Defect Type',
  'Package Condition Defect Type',
  'Packaging Defect Type',
  'Product Age/Dating Defect Type',
  'Scheduling Defect Type',
  'Shipping Defect Type',
  'Temperature Defect Type',
  'Transportation Defect Type',
  'Weight/Fill Defect Type',
  'Problem Statement',
  'Combo/Case Label',
  'Quality Defect',
  'Do you acknowledge the incident as defined above?',
  'Will you begin investigation of the incident as described above?',
  'Please provide Root Cause',
  'RCA Documentation',
  'What is the preventive measure?',
  'FSQA Manager Comments',
  'Rejection Action',
  'Reporter Comment',
  'Buyer Final Review',
  'Buyer Final Review Comments',
  'Reporter Final Review',
  'Protein Type',
  'Do you have enough information to begin investigation of the incident as defined above?',
  'What information is still needed?',
  'Additional Documentation'
];

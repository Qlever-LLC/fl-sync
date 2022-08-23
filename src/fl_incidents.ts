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
import sql from 'mssql';

import type { JsonObject, OADAClient } from '@oada/client';
import type { Body } from '@oada/client/lib/client';
import { ListWatch } from '@oada/list-lib';
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
const { database, server, user, password, port } = config.get('incidents-sql');

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}

/*
function transformIncident() {

}

async function syncIncident(incident: FlIncident) {
  transformIncident();
}
 */

export async function watchIncidents() {

  /*
  new ListWatch({
    basePath: `${SERVICE_PATH}/incident-types`,
    itemsPath: `$.*.incidents.*`,
    onAddItem: syncIncident
  })
  */
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
      console.log('SYNCING', path);
      await oada.put({
        path,
        data: { 'food-logiq-mirror': item } as unknown as Body,
        tree,
      });
      info(
        `Document synced to mirror: type:${type} _id:${item._id}`
      );
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
    await fetchIncidents({ startTime, endTime, pageIndex: pageIndex + 1, oada });
  }
}

/**
 * Fetches community resources
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
  oada: OADAClient;
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

  console.log('make request');
  /*
  const response = await axios(request);

  let csvData = csvjson.toObject(response.data, { delimiter: ",", quote: '"' });

  if (csvData.length > 0) {
    await syncToSql(csvData);
    }
  */
  syncToSql(undefined);


  // Manually check for changes; Only update the resource if it has changed!
  /*
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
    await fetchIncidents({ startTime, endTime, pageIndex: pageIndex + 1, oada });
  }
  */
}

function sanitize(key: string) {
  return key;
}

async function syncToSql(csvData: any) {
  console.log('syncToSql', csvData)
  /*
  let headers = Object.keys(csvData[0])
    .filter(key => key !== 'Id')
    .map(key => sanitize(key))
//    .map(key => key.replace(/ /, ''))
.map(key => `[${key}] text NULL`)
*/

  // First verify table
  console.log({
    server,
    database,
    user,
    password,
    port,
  })
  //@ts-ignore
  await sql.connect({
    server,
    database,
    user,
    password,
    port,
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  })
  /*

  const tables = await sql.query`select * from INFORMATION_SCHEMA.TABLES`;
  const matches = tables.recordset.filter((obj: any) => obj.TABLE_NAME === 'incidents')

  console.log(matches.length)
  if (matches.length === 0) {
    const query = `create table incidents (${TableColumns} PRIMARY KEY (Id))`;
    console.log(query);
    trace(`Creating incidents table: ${query}`);
    await sql.query(query)
  } else {
    await sql.query(`drop table incidents`);

  }

  */

  //Now, write the rows
  /*
  for await (let row of csvData) {
    row.Id = parseInt(row.Id);

    const values = Object.values(row);
    const entries = Object.entries(
      ([key, value]: [string, string]) => `[${key}] = ${value}`).join(', ');
    console.log({entries, values});

    await sql.query(`
    IF NOT EXISTS (SELECT * FROM incidents.incidents WHERE Id = ${row.Id})
      INSERT INTO incidents.incidents(${headers})
      VALUES(${values.join(',')})
    ELSE
      UPDATE incidents.incidents
      SET ${entries}
      WHERE Id = ${row.Id}
      `);
      }
   */

  /*
  await sql.query(`MERGE
INTO incidents.incidents WITH (HOLDLOCK) AS target
USING (SELECT
    77748 AS rtu_id
   ,'12B096876' AS meter_id
   ,56112 AS meter_reading
   ,'20150602 00:20:11' AS local_time) AS source
(rtu_id, meter_id, meter_reading, time_local)
ON (target.rtu_id = source.rtu_id
  AND target.time_local = source.time_local)
WHEN MATCHED
  THEN UPDATE
      SET meter_id = '12B096876'
         ,meter_reading = 56112
WHEN NOT MATCHED
  THEN INSERT (rtu_id, meter_id, meter_reading, time_local)
      VALUES (77748, '12B096876', 56112, '20150602 00:20:11')`);
      */
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
    await fetchIncidentTypes({ startTime, endTime, pageIndex: pageIndex + 1, oada });
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
      console.log('SYNCING', path);
      await oada.put({
        path,
        data: { 'food-logiq-mirror': item } as unknown as Body,
        tree,
      });
      info(
        `Document synced to mirror: type:${item.name} _id:${item._id}`
      );
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

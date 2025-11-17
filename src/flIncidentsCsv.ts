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

/*
An important detail about the incidents CSV API endpoint:
The data columns returned vary based on the time window requested. This
is what lead to many of the mappings and handlers used to handle column
name variations.

*/

import type { OADAClient } from "@oada/client";
import { poll } from "@oada/poll";
import dayjs, { type Dayjs } from "dayjs";
import debug from "debug";
import sql from "mssql";
import xlsx from "xlsx";

// Load config first so it can set up env
import config from "./config.js";

type DayjsInput = Parameters<typeof dayjs>[0];

const FL_DOMAIN = config.get("foodlogiq.domain");
const FL_TOKEN = config.get("foodlogiq.token");
const CO_ID = config.get("foodlogiq.community.owner.id");
const SERVICE_NAME = config.get("service.name");
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const { database, server, user, password, port, interval, table } =
  config.get("incidents");
const SQL_MAX_VALUE = 9_007_199_254_740_991;

const info = debug("fl-sync-incidents:info");
const trace = debug("fl-sync-incidents:trace");

// Normalize the configured table identifier and extract schema-qualified and bare names
function getTableIdentifiers(raw: unknown): { full: string; name: string; schema: string } {
  // Defaults when not configured
  const DEFAULT_SCHEMA = "dbo";
  const DEFAULT_TABLE = "incidents";

  let s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") {
    // Fall back to default schema-qualified table
    return { full: `[${DEFAULT_SCHEMA}].[${DEFAULT_TABLE}]`, name: DEFAULT_TABLE, schema: DEFAULT_SCHEMA };
  }

  // Remove surrounding brackets if present for robust splitting
  const unbracket = (p: string) => p.replace(/^\[|\]$/g, "");

  if (s.includes(".")) {
    // Handle schema-qualified forms, possibly with brackets: dbo.table or [dbo].[table]
    const parts = s.split(".").map((p) => unbracket(p.replace(/^\[(.*)\]$/, "$1")));
    const schema = parts[0] || DEFAULT_SCHEMA;
    const name = parts[parts.length - 1] || DEFAULT_TABLE;
    return { full: `[${schema}].[${name}]`, name, schema };
  }

  // Bare table name -> default to dbo
  const name = unbracket(s);
  const schema = DEFAULT_SCHEMA;
  return { full: `[${schema}].[${name}]`, name, schema };
}

export async function pollIncidents(lastPoll: Dayjs, end: Dayjs) {
  // Sync list of suppliers
  const startTime: string = (lastPoll || dayjs("20230801", "YYYYMMDD"))
    .utc()
    .format();
  const endTime: string = end.utc().format();

  info("Polling incidents");
  await fetchIncidentsCsv({ startTime, endTime });
}

/**
 * Fetch Incidents in CSV format for a time window.
 * Note: The CSV endpoint returns all rows for the window in a single response; pageIndex has no effect and is not used.
 */
export async function fetchIncidentsCsv({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
}) {
  const parameters = new URLSearchParams({
    updated: `${startTime}..${endTime}`,
  });
  const url = `${FL_DOMAIN}/v2/businesses/${CO_ID}/incidents/csv?${parameters}`;

  // Per-request timeout to avoid hangs
  const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? "30000");
  const ac = new AbortController();
  // Abort without a custom reason to ensure downstream APIs throw AbortError consistently
  const to = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: FL_TOKEN },
      signal: ac.signal,
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      // Try to include a short excerpt from the body for diagnostics (text only)
      let bodySnippet = "";
      try {
        if (contentType.includes("text")) {
          const txt = await response.text();
          bodySnippet = txt.slice(0, 200);
        }
      } catch {}
      throw new Error(
        `Incidents CSV fetch failed: HTTP ${response.status} ${response.statusText}; content-type=${contentType}; body=${bodySnippet}`,
      );
    }

    // Use content-type to pick the best reader path
    let wb: xlsx.WorkBook;
    if (contentType.includes("text/csv")) {
      const text = await response.text();
      wb = xlsx.read(text, { type: "string", cellDates: true });
    } else {
      // Fallback to arrayBuffer for XLSX or unknown types; SheetJS will sniff
      const ab = await response.arrayBuffer();
      wb = xlsx.read(new Uint8Array(ab), { type: "array", cellDates: true });
    }

    info({ SheetNames: wb.SheetNames }, "Workbook info");

    const sheetname = wb.SheetNames[0];
    if (sheetname === undefined) return;
    const sheet = wb.Sheets[String(sheetname)];
    if (sheet === undefined) return;

    const csvData = normalizeCsvData(sheet);

    if (csvData.length > 0) {
      info({ rowCount: csvData.length }, "Fetched incidents CSV data");
      await syncToSql(csvData);
    }
  } catch (err: any) {
    // Gracefully handle request abort/timeout
    const isAbort = err?.name === "AbortError" || err?.code === "ABORT_ERR" || err?.message?.toLowerCase?.().includes("aborted");
    if (isAbort || ac.signal.aborted) {
      info(`Incidents CSV request timed out after ${REQUEST_TIMEOUT_MS} ms`);
      return; // Do not throw; allow poll loop to continue
    }
    throw err;
  } finally {
    clearTimeout(to);
  }
}

export async function startIncidents(connection: OADAClient) {
  /*
  Const sqlConfig = {
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

  // @ts-expect-error mssql docs show an await on connect...
  await sql.connect(sqlConfig);

  await ensureTable();
  */

  await poll({
    connection,
    basePath: SERVICE_PATH,
    pollOnStartup: true,
    pollFunc: pollIncidents,
    interval,
    name: "foodlogiq-incidents",
    getTime: (async () => {
      const r = await fetch(`${FL_DOMAIN}/businesses`, {
        method: "head",
        headers: { Authorization: FL_TOKEN },
      });
      return r.headers.get("Date");
    }) as unknown as () => Promise<string>,
  });

  info(`Started foodlogiq-incidents poller. Polling interval: ${interval} ms`);
}

export async function ensureTable() {
  const { full: tableFull, name: tname, schema } = getTableIdentifiers(table);
  // Check for existence in the intended schema only
  const tables = await sql.query`select TABLE_SCHEMA, TABLE_NAME from INFORMATION_SCHEMA.TABLES where TABLE_NAME = ${tname} and TABLE_SCHEMA = ${schema}`;
  const exists = tables.recordset.length > 0;

  if (!exists) {
    const tableColumns = uniqueColumns(allColumns)
      .map((c) => `[${c.name}] ${c.type} ${c.allowNull ? "NULL" : "NOT NULL"}`)
      .join(", ");
    // Comma before PRIMARY KEY and bracket the Id identifier
    const query = `CREATE TABLE ${tableFull} (${tableColumns}, PRIMARY KEY ([Id]))`;
    info(`Creating incidents table: ${query}`);
    const response = await sql.query(query);
    return response;
  }

  return true;
}

export async function ensureColumns() {
  // Normalize table identifiers and determine bare table name for INFORMATION_SCHEMA lookup
  const { full: tableFull, name: tname, schema } = getTableIdentifiers(table);

  // Query existing columns for the intended schema only
  const cols = await sql.query`select COLUMN_NAME from INFORMATION_SCHEMA.COLUMNS where TABLE_NAME = ${tname} and TABLE_SCHEMA = ${schema}`;
  const existing = new Set(
    cols.recordset.map((r: any) => String(r.COLUMN_NAME).toLowerCase()),
  );

  // Compute missing columns from our schema (case-insensitive)
  const toAdd = uniqueColumns(allColumns)
    .filter((c) => !existing.has(String(c.name).toLowerCase()))
    .map((c) => `[${c.name}] ${c.type} NULL`); // add as NULL to avoid migration failures

  if (toAdd.length > 0) {
    // SQL Server syntax: one ADD followed by comma-separated column definitions
    const alter = `ALTER TABLE ${tableFull} ADD ${toAdd.join(", ")}`;
    info(`Ensuring columns on ${tableFull}: adding ${toAdd.length} column(s)`);
    info(`Executing: ${alter}`);
    await sql.query(alter);
  }

  return true;
}

/*
  'incidentDate (Incident Date/Delivery Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'incidentDate (Delivery Date/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'location (My Location Name/Location Name)': 'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)',
  'location (Location Name/My Location Name)': 'location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)',
  'location (Location GLN/My Location GLN)': 'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)',
  'location (My Location GLN/Location GLN)': 'location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)',
  'product (Material GTIN/Product GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  'product (Product Name GTIN/Material GTIN/Product GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  'product (Product GTIN/Material GTIN)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  'product (Product GTIN/Product Name GTIN/)': 'product (Product GTIN/Product Name GTIN/Material GTIN)',
  'quantityAffected (Affected Quantity/Quantity Affected)': 'quantityAffected (Quantity Affected/Affected Quantity)',
  'incidentDate (Date of Delivery/Incident Date/Delivery Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'incidentDate (Delivery Date/Date of Delivery/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
  'incidentDate (Date of Delivery/Delivery Date/Incident Date)': 'incidentDate (Incident Date/Date of Delivery/Delivery Date)',
*/

// 1. If its a thing with some slashes in parentheses, allow them to be in any order;
function checkSlashThings(row: Row) {
  const pattern = / \((?:[^()/]+\/)+[^()/]+\)/;

  const matches = Object.keys(allColumns).filter(
    (key): key is keyof typeof allColumns => pattern.test(key),
  );

  const keys = Object.keys(row).filter(
    (key): key is keyof Row => !(key in allColumns) && pattern.test(key),
  );
  for (const key of keys) {
    const parts = key.split(" (");
    const set = parts[1]!.replace(/\)$/, "").split("/").sort();

    for (const col of matches) {
      const cParts = col.split(" (");
      const cSet = cParts[1]!.replace(/\)$/, "").split("/").sort();
      const same = cSet.every((item, index) => set[index] === item);
      if (same) {
        // @ts-expect-error idk what this is
        row[col] = row[key];
        delete row[key];
      }
    }
  }

  return row;
}

const noDelete = new Set([
  "Affected Quantity",
  "IMAGE OF SUPPLIER CASE LABEL",
  "incidentDate (Incident Date/Date of Delivery/Delivery Date)",
]);

const alters: Record<keyof Row, keyof Row> = {
  // @ts-expect-error
  "Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? (Be sure to include your FoodLogiQ Incident ID in your email)":
    "Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options?",
  Community: "community (Community/Business Name)",
  "Affected Quantity": "quantityAffected (Quantity Affected/Affected Quantity)",
  "IMAGE OF SUPPLIER CASE LABEL":
    "images (Photo of Case Labels & Product/Photos or Documents)",
  // Normalize duplicate header variants that differ only by casing/punctuation
  "Still have the Product?": "Still have the product?",
  "Still have the product": "Still have the product?",
};

// Handle schema changes over time (get csv output for whole history versus a small, recent window and results will vary a lot)
function handleSchemaChanges(row: Row) {
  if ("CREDIT NOTE" in row) {
    // @ts-expect-error these types confuse ts
    // eslint-disable-next-line sonarjs/no-duplicate-string
    row["Credit Note"] = row["CREDIT NOTE"];
    delete row["CREDIT NOTE"];
  }

  // eslint-disable-next-line sonarjs/no-duplicate-string
  if (!("Credit note to supplier" in row)) {
    row["Credit note to supplier"] = row["Credit Note"];
  }

  if (!("DC Pick Label" in row)) {
    row["Credit note to supplier"] = row["Credit Note"];
  }

  row = checkSlashThings(row);

  for (const [oldKey, alter] of Object.entries(alters)) {
    if (oldKey in row) {
      const key = oldKey as keyof Row;
      // @ts-expect-error description
      row[alter] ??= row[oldKey];
      if (!noDelete.has(key)) {
        delete row[key];
      }
    }
  }

  return row;
}

// Helper: clean common Excel-protection wrappers from cell strings (e.g., ="0070800003129")
function cleanCell(val: unknown): unknown {
  if (typeof val !== "string") return val;
  let s = val.trim();
  // Pattern: ="value"
  const m = s.match(/^=\s*"([^"]*)"\s*$/);
  if (m) s = m[1] ?? "";
  // Some CSVs may include leading single quote to prevent formula evaluation
  if (s.startsWith("'")) s = s.slice(1);
  return s;
}

// Normalize a worksheet into array of objects and merge duplicate GTIN columns into a single GTIN field
function normalizeCsvData(sheet: xlsx.WorkSheet): any[] {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown as any[][];

  if (!rows || rows.length < 2) return [];

  const headers = rows[0] as string[];
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    let gtinSet = false;

    for (let c = 0; c < headers.length; c++) {
      const hRaw = headers[c];
      const h = typeof hRaw === "string" ? hRaw.trim() : String(hRaw ?? "").trim();
      if (!h) continue;
      const v = cleanCell(row[c]);

      if (h === "GTIN") {
        // Use the first non-empty GTIN across duplicates
        if (!gtinSet && v !== "" && v !== null && v !== undefined) {
          obj["GTIN"] = v;
          gtinSet = true;
        }
        continue;
      }

      // General rule for duplicate headers: prefer the first non-empty value.
      if (!(h in obj)) {
        obj[h] = v;
      } else {
        const curr = obj[h];
        const currEmpty = curr === "" || curr === null || curr === undefined;
        const nextHasValue = v !== "" && v !== null && v !== undefined;
        if (currEmpty && nextHasValue) obj[h] = v; // fill if we only had empty before
        // otherwise, keep the earlier non-empty value
      }
    }

    return obj;
  });
}

// Ensure unique, case-insensitive column definitions
function uniqueColumns<T extends Record<keyof Row, Column>>(cols: T): Column[] {
  const seen = new Set<string>();
  const result: Column[] = [];
  for (const c of Object.values(cols)) {
    const key = String(c.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
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

  info("Connecting to SQL Server");
  // @ts-expect-error mssql docs show an await on connect...
  await sql.connect(sqlConfig);

  // Ensure table exists, then ensure it has all needed columns before upserting
  info("Ensuring table and columns");
  await ensureTable();
  info("Ensured table, ensuring columns");
  await ensureColumns();
  info("Ensured columns, starting upsert");

  const { full: tableFull } = getTableIdentifiers(table);

  for await (const row of csvData) {
    let newRow = handleSchemaChanges(row);
    newRow = handleTypes(newRow);
    newRow = ensureNotNull(newRow);
    info({ row, newRow }, "Input Row and new Row");

    const columnKeys = Object.keys(allColumns).sort() as Array<keyof Row>;

    const request = new sql.Request();

    const selectString = columnKeys
      .map((key, index) => {
        request.input(`val${index}`, newRow[key]);
        return `@val${index} AS [${key}]`;
      })
      .join(",");

    const setString = columnKeys
      // .filter((key) => key !== 'Id')
      .map((key, index) => `[${key}] = @val${index}`)
      .join(",");

    const cols = columnKeys.map((key) => `[${key}]`).join(",");

    const values = columnKeys.map((_, index) => `@val${index}`).join(",");

    const query = /* sql */ `MERGE
    INTO ${tableFull} WITH (HOLDLOCK) AS target
      USING (SELECT ${selectString}) AS source
      (${cols})
      ON (target.[Id] = source.[Id])
      WHEN MATCHED
        THEN UPDATE
          SET ${setString}
      WHEN NOT MATCHED
        THEN INSERT (${cols})
	VALUES (${values});`;
    info(`Query: ${query}`);
    await request.query(query);
  }
}

function handleTypes(newRow: Row) {
  const columnKeys = Object.keys(allColumns).sort() as Array<
    keyof typeof allColumns
  >;

  return Object.fromEntries(
    columnKeys.map((key) => {
      if (allColumns[key].type.includes("DATE")) {
        const value = newRow[key] as DayjsInput;
        if (dayjs.isDayjs(value)) {
          return [key, dayjs(value).toDate()];
        }

        if (dayjs(value, "MMM DD, YYYY", true).isValid()) {
          return [key, dayjs(value, "MMM DD, YYYY").toDate()];
        }

        if (dayjs(value, "MMMM D, YYYY hh:mma", true).isValid()) {
          return [key, dayjs(value, "MMMM D, YYYY hh:mma", true).toDate()];
        }

        if (dayjs(value, "YYYY-MM-DD", true).isValid()) {
          return [key, dayjs(value, "YYYY-MM-DD", true).toDate()];
        }
      }

      if (allColumns[key].type === "BIT") {
        if (newRow[key] === true || newRow[key] === false) {
          return [key, newRow[key]];
        }

        if (typeof newRow[key] === "string") {
          if (
            newRow[key].toLowerCase() === "yes" ||
            newRow[key].toLowerCase() === "no"
          ) {
            return [key, newRow[key].toLowerCase() === "no"];
          }

          if (
            newRow[key].toLowerCase() === "true" ||
            newRow[key].toLowerCase() === "false"
          ) {
            return [key, newRow[key].toLowerCase() === "true"];
          }

          return [key, undefined];
        }
      }

      if (allColumns[key].type.includes("DECIMAL")) {
        if (!Number.isNaN(Number(newRow[key]))) {
          return [
            key,
            Number(newRow[key]) > SQL_MAX_VALUE
              ? newRow[key].toString()
              : Number(newRow[key]),
          ];
        }

        if (typeof newRow[key] === "string") {
          return [key, undefined];
        }
      }

      // Handle some other general cases. Null will be handled in the next step
      if (
        typeof newRow[key] === "string" &&
        ["", "na", "n/a"].includes(newRow[key].toLowerCase())
      ) {
        return [key, undefined];
      }

      if (!newRow[key]) {
        return [key, undefined];
      }

      if (
        allColumns[key].type.includes("VARCHAR") &&
        typeof newRow[key] === "string"
      ) {
        return [key, newRow[key]];
      }

      return [key, undefined];
    }),
  );
  return newRow;
}

function ensureNotNull(newRow: Row) {
  const nonNulls = Object.values(allColumns).filter(
    (col) =>
      (newRow[col.name] === null || newRow[col.name] === undefined) &&
      !col.allowNull,
  );
  for (const { name, type } of nonNulls) {
    if (type === "BIT") {
      // @ts-expect-error these types confuse ts
      newRow[name] = false;
    } else if (type.includes("VARCHAR")) {
      // @ts-expect-error these types confuse ts
      newRow[name] = "";
    } else if (type.includes("DECIMAL")) {
      // @ts-expect-error these types confuse ts
      newRow[name] = 0;
    } else if (type === "DATE") {
      // @ts-expect-error these types confuse ts
      newRow[name] = newRow["Created At"];
    }
  }

  return newRow;
}

interface Column {
  name: keyof Row;
  allowNull: boolean;
  type: string;
}

// Edits to the columns:
// 1) removed [CREDIT NOTE] as duplicate of [Credit Note]
// 2) trimmed the really long potbelly column name that was > 128 characters
// 3) set Id to VARCHAR(100)
const allColumns: Record<keyof Row, Column> = {
  Id: { name: "Id", type: "VARCHAR(100)", allowNull: false },
  "Incident ID": {
    name: "Incident ID",
    // eslint-disable-next-line sonarjs/no-duplicate-string
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Incident Type": {
    name: "Incident Type",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Current Status": {
    name: "Current Status",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Last Updated At": {
    name: "Last Updated At",
    type: "DATE",
    allowNull: false,
  },
  "Last Updated By": {
    name: "Last Updated By",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Reported By": {
    name: "Reported By",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Created At": {
    name: "Created At",
    type: "DATE",
    allowNull: false,
  },
  "Created From": {
    name: "Created From",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)":
    {
      name: "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)",
      type: "VARCHAR(max)",
      allowNull: false,
    },
  "location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)":
    {
      name: "location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)",
      type: "VARCHAR(max)",
      allowNull: false,
    },
  "community (Community/Business Name)": {
    name: "community (Community/Business Name)",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "incidentDate (Incident Date/Date of Delivery/Delivery Date)": {
    name: "incidentDate (Incident Date/Date of Delivery/Delivery Date)",
    type: "DATE",
    allowNull: false,
  },
  "Customer Complaint Related": {
    name: "Customer Complaint Related",
    type: "BIT",
    allowNull: false,
  },
  "Still have the product?": {
    name: "Still have the product?",
    type: "BIT",
    allowNull: false,
  },
  "Still have the Product?": {
    name: "Still have the Product?",
    type: "BIT",
    allowNull: false,
  },
  "quantityAffected (Quantity Affected/Affected Quantity)": {
    name: "quantityAffected (Quantity Affected/Affected Quantity)",
    type: "DECIMAL(38, 2)",
    allowNull: false,
  },
  "IMAGE OF SUPPLIER CASE LABEL": {
    name: "IMAGE OF SUPPLIER CASE LABEL",
    type: "BIT",
    allowNull: false,
  },
  "IMAGE(s) OF ISSUE AND QUANTITY AFFECTED": {
    name: "IMAGE(s) OF ISSUE AND QUANTITY AFFECTED",
    type: "BIT",
    allowNull: false,
  },
  "IMAGE OF DISTRIBUTOR LABEL, if applicable": {
    name: "IMAGE OF DISTRIBUTOR LABEL, if applicable",
    type: "BIT",
    allowNull: false,
  },
  "SUPPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT": {
    name: "SUPPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT",
    type: "BIT",
    allowNull: false,
  },
  "Supplier Investigation Report": {
    name: "Supplier Investigation Report",
    type: "BIT",
    allowNull: false,
  },
  "Corrective Action Report": {
    name: "Corrective Action Report",
    type: "BIT",
    allowNull: false,
  },
  "images (Photo of Case Labels & Product/Photos or Documents)": {
    name: "images (Photo of Case Labels & Product/Photos or Documents)",
    type: "BIT",
    allowNull: false,
  },
  "product (Product GTIN/Product Name GTIN/Material GTIN)": {
    name: "product (Product GTIN/Product Name GTIN/Material GTIN)",
    type: "VARCHAR(max)",
    allowNull: false,
  },
  "Invoice Photo": {
    name: "Invoice Photo",
    type: "BIT",
    allowNull: false,
  },
  "Incident Photo(s)": {
    name: "Incident Photo(s)",
    type: "BIT",
    allowNull: false,
  },
  "Supplier Label": {
    name: "Supplier Label",
    type: "BIT",
    allowNull: false,
  },
  "DC Pick Label": {
    name: "DC Pick Label",
    type: "BIT",
    allowNull: false,
  },
  "Purchase Order Image": {
    name: "Purchase Order Image",
    type: "BIT",
    allowNull: false,
  },
  "Invoice Image": {
    name: "Invoice Image",
    type: "BIT",
    allowNull: false,
  },
  "SUPPLIER INVESTIGATION REPORT(S)": {
    name: "SUPPLIER INVESTIGATION REPORT(S)",
    type: "BIT",
    allowNull: false,
  },
  "CORRECTIVE ACTION REPORTS": {
    name: "CORRECTIVE ACTION REPORTS",
    type: "BIT",
    allowNull: false,
  },
  "SUPPLIER CREDIT DOCUMENTATION": {
    name: "SUPPLIER CREDIT DOCUMENTATION",
    type: "BIT",
    allowNull: false,
  },
  "Supplier Documentation / Photos": {
    name: "Supplier Documentation / Photos",
    type: "BIT",
    allowNull: false,
  },
  "DC Documentation / Photos": {
    name: "DC Documentation / Photos",
    type: "BIT",
    allowNull: false,
  },
  "Corrective Action Document": {
    name: "Corrective Action Document",
    type: "BIT",
    allowNull: false,
  },
  "Credit note to supplier": {
    name: "Credit note to supplier",
    type: "BIT",
    allowNull: false,
  },
  "Credit Note": {
    name: "Credit Note",
    type: "BIT",
    allowNull: false,
  },
  "Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT":
    {
      name: "Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT",
      type: "BIT",
      allowNull: false,
    },
  "Produce Supplier + Distributor Investigation/Corrective Action Report": {
    name: "Produce Supplier + Distributor Investigation/Corrective Action Report",
    type: "BIT",
    allowNull: false,
  },
  "Supporting Details": {
    name: "Supporting Details",
    type: "BIT",
    allowNull: false,
  },
  "Supporting Document": {
    name: "Supporting Document",
    type: "BIT",
    allowNull: false,
  },
  "Photos or Documents": {
    name: "Photos or Documents",
    type: "BIT",
    allowNull: false,
  },
  "Supplier Photos or Documents": {
    name: "Supplier Photos or Documents",
    type: "BIT",
    allowNull: false,
  },
  "Distribution Center Photos or Documents": {
    name: "Distribution Center Photos or Documents",
    type: "BIT",
    allowNull: false,
  },
  "Load/Pallet Issue": {
    name: "Load/Pallet Issue",
    type: "BIT",
    allowNull: false,
  },
  "Trailer Number Photo": {
    name: "Trailer Number Photo",
    type: "BIT",
    allowNull: false,
  },
  "Document/BOL": {
    name: "Document/BOL",
    type: "BIT",
    allowNull: false,
  },
  "Case Label": {
    name: "Case Label",
    type: "BIT",
    allowNull: false,
  },
  "Other as Necessary": {
    name: "Other as Necessary",
    type: "BIT",
    allowNull: false,
  },
  "Evidence of Correction": {
    name: "Evidence of Correction",
    type: "BIT",
    allowNull: false,
  },
  "Evidence to Reassign": {
    name: "Evidence to Reassign",
    type: "BIT",
    allowNull: false,
  },
  "Combo/Case Label": {
    name: "Combo/Case Label",
    type: "BIT",
    allowNull: false,
  },
  "Quality Defect": {
    name: "Quality Defect",
    type: "BIT",
    allowNull: false,
  },
  "RCA Documentation": {
    name: "RCA Documentation",
    type: "BIT",
    allowNull: false,
  },
  "Additional Documentation": {
    name: "Additional Documentation",
    type: "BIT",
    allowNull: false,
  },
  "Due Date": {
    name: "Due Date",
    type: "DATETIME",
    allowNull: true,
  },
  "Issued By": {
    name: "Issued By",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  Title: {
    name: "Title",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)":
    {
      name: "distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)",
      type: "VARCHAR(max)",
      allowNull: true,
    },
  Country: {
    name: "Country",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Type of Product Issue": {
    name: "Type of Product Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Type of Foreign Material": {
    name: "Type of Foreign Material",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Type of Distribution Issue": {
    name: "Type of Distribution Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Type of Quality Issue": {
    name: "Type of Quality Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  Description: {
    name: "Description",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Do you still have the foreign object?": {
    name: "Do you still have the foreign object?",
    type: "BIT",
    allowNull: true,
  },
  "Requesting Credit?": {
    name: "Requesting Credit?",
    type: "BIT",
    allowNull: true,
  },
  "Invoice Date / Delivery Date": {
    name: "Invoice Date / Delivery Date",
    type: "DATE",
    allowNull: true,
  },
  "Invoice Number": {
    name: "Invoice Number",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Affected Quantity": {
    name: "Affected Quantity",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Unit of Measurement": {
    name: "Unit of Measurement",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "productType (Product Name/Product Type/QA Product Category/Material Category)":
    {
      name: "productType (Product Name/Product Type/QA Product Category/Material Category)",
      type: "VARCHAR(max)",
      allowNull: true,
    },
  "Item Name": {
    name: "Item Name",
    type: "BIT",
    allowNull: true,
  },
  "sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)":
    {
      name: "sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)",
      type: "VARCHAR(max)",
      allowNull: true,
    },
  "Supplier Status": {
    name: "Supplier Status",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Pack Date / Grind Date / Manufacture Date": {
    name: "Pack Date / Grind Date / Manufacture Date",
    type: "BIT",
    allowNull: true,
  },
  "Run Time": {
    name: "Run Time",
    type: "BIT",
    allowNull: true,
  },
  "Use By Date / Freeze By Date / Expiration Date": {
    name: "Use By Date / Freeze By Date / Expiration Date",
    type: "DATE",
    allowNull: true,
  },
  "Production Date / Julian Code / Case Code / Batch Code / Lot Code": {
    name: "Production Date / Julian Code / Case Code / Batch Code / Lot Code",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Hold or Isolate": {
    name: "Hold or Isolate",
    type: "BIT",
    allowNull: true,
  },
  "Confirm Credit Request": {
    name: "Confirm Credit Request",
    type: "BIT",
    allowNull: true,
  },
  "Review and Action Comments": {
    name: "Review and Action Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "supplierLocation (Supplier Location/Supplier Manufacturing Location)": {
    name: "supplierLocation (Supplier Location/Supplier Manufacturing Location)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Corrective Action": {
    name: "Supplier Corrective Action",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Credit Decision": {
    name: "Supplier Credit Decision",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Credit Approval - Rep Name": {
    name: "Supplier Credit Approval - Rep Name",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Quantity Credit Amount (Not Dollars)": {
    name: "Quantity Credit Amount (Not Dollars)",
    // eslint-disable-next-line sonarjs/no-duplicate-string
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Quantity Unit of Measure": {
    name: "Quantity Unit of Measure",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  Comment: {
    name: "Comment",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Credit Decision": {
    name: "Credit Decision",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Credit Number": {
    name: "Credit Number",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Credit Amount": {
    name: "Credit Amount",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  Currency: {
    name: "Currency",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Hold Product": {
    name: "Hold Product",
    type: "BIT",
    allowNull: true,
  },
  "Hold Comments": {
    name: "Hold Comments",
    type: "BIT",
    allowNull: true,
  },
  "Isolate Product": {
    name: "Isolate Product",
    type: "BIT",
    allowNull: true,
  },
  "Isolate Comments": {
    name: "Isolate Comments",
    type: "BIT",
    allowNull: true,
  },
  "CM Team Notified": {
    name: "CM Team Notified",
    type: "BIT",
    allowNull: true,
  },
  "CM Team Activated": {
    name: "CM Team Activated",
    type: "BIT",
    allowNull: true,
  },
  "Reason for Request": {
    name: "Reason for Request",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Please describe further": {
    name: "Please describe further",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Enter Product Name": {
    name: "Enter Product Name",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Distributor Item Number": {
    name: "Distributor Item Number",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Best By/Expiration Date": {
    name: "Best By/Expiration Date",
    type: "DATE",
    allowNull: true,
  },
  "Do you have enough usable product to last you until next delivery?": {
    name: "Do you have enough usable product to last you until next delivery?",
    type: "BIT",
    allowNull: true,
  },
  "Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ":
    {
      name: "Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ",
      type: "BIT",
      allowNull: true,
    },
  "Please describe why you are not emailing _supplychain@potbelly.com": {
    name: "Please describe why you are not emailing _supplychain@potbelly.com",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Lot Code (enter N/A if this was a short)": {
    name: "Lot Code (enter N/A if this was a short)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "product (Product Name Name/Material Name/Product Name)": {
    name: "product (Product Name Name/Material Name/Product Name)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "product (Product Name LOT/Material LOT/Product LOT)": {
    name: "product (Product Name LOT/Material LOT/Product LOT)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reason for DC Denial": {
    name: "Reason for DC Denial",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Credit Memo": {
    name: "Credit Memo",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Credit Amount Approved": {
    name: "Credit Amount Approved",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "DC Comments": {
    name: "DC Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reason for Supplier Denial": {
    name: "Reason for Supplier Denial",
    type: "BIT",
    allowNull: true,
  },
  "Supplier Comments": {
    name: "Supplier Comments",
    type: "BIT",
    allowNull: true,
  },
  Comments: {
    name: "Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Credit Decision by DC": {
    name: "Credit Decision by DC",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Rejection Reason": {
    name: "Rejection Reason",
    type: "BIT",
    allowNull: true,
  },
  "Credit Type": {
    name: "Credit Type",
    type: "BIT",
    allowNull: true,
  },
  "Type of Delivery Incident": {
    name: "Type of Delivery Incident",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Still have the product": {
    name: "Still have the product",
    type: "BIT",
    allowNull: true,
  },
  "Do you still have the foreign object?  If so, please hold for further investigation.":
    {
      name: "Do you still have the foreign object?  If so, please hold for further investigation.",
      type: "BIT",
      allowNull: true,
    },
  "Date Product Was Received": {
    name: "Date Product Was Received",
    type: "BIT",
    allowNull: true,
  },
  "Pack Date / Manufacture Date": {
    name: "Pack Date / Manufacture Date",
    type: "BIT",
    allowNull: true,
  },
  "Shelf Life Issue": {
    name: "Shelf Life Issue",
    type: "BIT",
    allowNull: true,
  },
  "Supplier Initial Assessment": {
    name: "Supplier Initial Assessment",
    type: "BIT",
    allowNull: true,
  },
  "Supplier Credit Number": {
    name: "Supplier Credit Number",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Distribution Company": {
    name: "Distribution Company",
    type: "BIT",
    allowNull: true,
  },
  "Incident Acknowledged?": {
    name: "Incident Acknowledged?",
    type: "BIT",
    allowNull: true,
  },
  Brand: {
    name: "Brand",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Restaurant Contact Name": {
    name: "Restaurant Contact Name",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Restaurant Phone Number": {
    name: "Restaurant Phone Number",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Date Product Received": {
    name: "Date Product Received",
    type: "DATE",
    allowNull: true,
  },
  "DC Invoice Number": {
    name: "DC Invoice Number",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "HAVI Product ID": {
    name: "HAVI Product ID",
    type: "BIT",
    allowNull: true,
  },
  "Manufacturer Code": {
    name: "Manufacturer Code",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "DC Product Code": {
    name: "DC Product Code",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Best By/Use By Date": {
    name: "Best By/Use By Date",
    type: "DATE",
    allowNull: true,
  },
  "Complaint Type": {
    name: "Complaint Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Complaint Subtype - Foreign Object": {
    name: "Complaint Subtype - Foreign Object",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Complaint Subtype - Low Piece Count": {
    name: "Complaint Subtype - Low Piece Count",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Complaint Subtype - Size and Weight": {
    name: "Complaint Subtype - Size and Weight",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Complaint Subtype - Temperature Abuse": {
    name: "Complaint Subtype - Temperature Abuse",
    type: "BIT",
    allowNull: true,
  },
  "Complaint Subtype - Packaging": {
    name: "Complaint Subtype - Packaging",
    type: "BIT",
    allowNull: true,
  },
  "Complaint Subtype - Shelf Life": {
    name: "Complaint Subtype - Shelf Life",
    type: "BIT",
    allowNull: true,
  },
  "Complaint Subtype - Product Performance": {
    name: "Complaint Subtype - Product Performance",
    type: "BIT",
    allowNull: true,
  },
  "Complaint Subtype - Appearance": {
    name: "Complaint Subtype - Appearance",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Complaint Subtype - Fresh Produce": {
    name: "Complaint Subtype - Fresh Produce",
    type: "BIT",
    allowNull: true,
  },
  "Complaint Details": {
    name: "Complaint Details",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Quantity Affected": {
    name: "Quantity Affected",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Additional Comments": {
    name: "Additional Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Fresh Produce DC Credit Decision": {
    name: "Fresh Produce DC Credit Decision",
    type: "BIT",
    allowNull: true,
  },
  "Fresh Produce DC Comments": {
    name: "Fresh Produce DC Comments",
    type: "BIT",
    allowNull: true,
  },
  "Feedback for Supplier": {
    name: "Feedback for Supplier",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Additional Comments": {
    name: "Supplier Additional Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reason For Denial": {
    name: "Reason For Denial",
    type: "BIT",
    allowNull: true,
  },
  "DC Credit Decision": {
    name: "DC Credit Decision",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "DC Additional Comments": {
    name: "DC Additional Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "DC Reason For Denial": {
    name: "DC Reason For Denial",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "DC Corrective Action": {
    name: "DC Corrective Action",
    type: "BIT",
    allowNull: true,
  },
  "Corrective Action - Distributor Revised": {
    name: "Corrective Action - Distributor Revised",
    type: "BIT",
    allowNull: true,
  },
  "Produce Supplier + Distributor Credit Decision": {
    name: "Produce Supplier + Distributor Credit Decision",
    type: "BIT",
    allowNull: true,
  },
  "Quantity Credit Amount (Not currency)": {
    name: "Quantity Credit Amount (Not currency)",
    type: "BIT",
    allowNull: true,
  },
  "Produce Supplier + Distributor Corrective Action": {
    name: "Produce Supplier + Distributor Corrective Action",
    type: "BIT",
    allowNull: true,
  },
  "Failure Group": {
    name: "Failure Group",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Failure Type": {
    name: "Failure Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  Severity: {
    name: "Severity",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Additional Vendor Batch/Lots": {
    name: "Additional Vendor Batch/Lots",
    type: "BIT",
    allowNull: true,
  },
  Quantity: {
    name: "Quantity",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Unit of Measure": {
    name: "Unit of Measure",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "PO Number": {
    name: "PO Number",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Inbound Freight Carrier": {
    name: "Inbound Freight Carrier",
    type: "BIT",
    allowNull: true,
  },
  "Initial Disposition": {
    name: "Initial Disposition",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Downtime Caused (when applicable)": {
    name: "Downtime Caused (when applicable)",
    type: "BIT",
    allowNull: true,
  },
  "Potential for Claim": {
    name: "Potential for Claim",
    type: "BIT",
    allowNull: true,
  },
  "Root Cause": {
    name: "Root Cause",
    type: "BIT",
    allowNull: true,
  },
  "Action Plan": {
    name: "Action Plan",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Responsible Party": {
    name: "Responsible Party",
    type: "BIT",
    allowNull: true,
  },
  "Additional Notes": {
    name: "Additional Notes",
    type: "BIT",
    allowNull: true,
  },
  "Final Disposition": {
    name: "Final Disposition",
    type: "BIT",
    allowNull: true,
  },
  "Resolution Details": {
    name: "Resolution Details",
    type: "BIT",
    allowNull: true,
  },
  "Best By Date": {
    name: "Best By Date",
    type: "DATE",
    allowNull: true,
  },
  "Incident Issue": {
    name: "Incident Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Appearance Issue": {
    name: "Appearance Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Fatty / Excess Fat Issue": {
    name: "Fatty / Excess Fat Issue",
    type: "BIT",
    allowNull: true,
  },
  "Foreign Object Issue": {
    name: "Foreign Object Issue",
    type: "BIT",
    allowNull: true,
  },
  "Fresh Produce Issue": {
    name: "Fresh Produce Issue",
    type: "BIT",
    allowNull: true,
  },
  "Fresh Produce Credit Decision": {
    name: "Fresh Produce Credit Decision",
    type: "BIT",
    allowNull: true,
  },
  "Low Piece Count": {
    name: "Low Piece Count",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Off Odor / Flavor Issue": {
    name: "Off Odor / Flavor Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Packaging Issue": {
    name: "Packaging Issue",
    type: "BIT",
    allowNull: true,
  },
  "Product Performance Issue": {
    name: "Product Performance Issue",
    type: "BIT",
    allowNull: true,
  },
  "Size and Weight Issue": {
    name: "Size and Weight Issue",
    type: "BIT",
    allowNull: true,
  },
  "Temperature Abuse Issue": {
    name: "Temperature Abuse Issue",
    type: "BIT",
    allowNull: true,
  },
  "Wrong Product Issue": {
    name: "Wrong Product Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Incident Details": {
    name: "Incident Details",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Credit Denial Reason": {
    name: "Supplier Credit Denial Reason",
    type: "BIT",
    allowNull: true,
  },
  "Dine Brands Quality Assurance Feedback": {
    name: "Dine Brands Quality Assurance Feedback",
    type: "BIT",
    allowNull: true,
  },
  "Distribution Center Credit Decision": {
    name: "Distribution Center Credit Decision",
    type: "BIT",
    allowNull: true,
  },
  "Distribution Center Credit Denial Reason": {
    name: "Distribution Center Credit Denial Reason",
    type: "BIT",
    allowNull: true,
  },
  "Distribution Center Additional Comments": {
    name: "Distribution Center Additional Comments",
    type: "BIT",
    allowNull: true,
  },
  "PO# / STO#": {
    name: "PO# / STO#",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Does your SAP plant number begin with a 2?": {
    name: "Does your SAP plant number begin with a 2?",
    type: "BIT",
    allowNull: true,
  },
  "Batch Code": {
    name: "Batch Code",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Inbound Issue": {
    name: "Inbound Issue",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Inbound Issue Details/Comments": {
    name: "Inbound Issue Details/Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Quantity Involved": {
    name: "Quantity Involved",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Labor Hours to Correct": {
    name: "Labor Hours to Correct",
    type: "DECIMAL(38, 1)",
    allowNull: true,
  },
  "Incident Investigator Comments": {
    name: "Incident Investigator Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Please provide root cause analysis": {
    name: "Please provide root cause analysis",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Root Cause Analysis Resolution": {
    name: "Root Cause Analysis Resolution",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "What is the root cause?": {
    name: "What is the root cause?",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "What are the corrections you have made?": {
    name: "What are the corrections you have made?",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "What are the preventive measures you have taken?": {
    name: "What are the preventive measures you have taken?",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "CAPA Resolution": {
    name: "CAPA Resolution",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Triage Manager Comments": {
    name: "Triage Manager Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Incident Investigator Review Comments": {
    name: "Incident Investigator Review Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reporter Review Comments": {
    name: "Reporter Review Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reason for incorrect information decision": {
    name: "Reason for incorrect information decision",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  'Please confirm that you received the notification from "info@foodlogiq.com"':
    {
      name: 'Please confirm that you received the notification from "info@foodlogiq.com"',
      type: "VARCHAR(max)",
      allowNull: true,
    },
  "Reporter Name": {
    name: "Reporter Name",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reporter Phone": {
    name: "Reporter Phone",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Internal Supplier": {
    name: "Internal Supplier",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Est No": {
    name: "Est No",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Defect Group": {
    name: "Defect Group",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Appearance/Color Defect Type": {
    name: "Appearance/Color Defect Type",
    type: "BIT",
    allowNull: true,
  },
  "Describe the Misc. Color": {
    name: "Describe the Misc. Color",
    type: "BIT",
    allowNull: true,
  },
  "Fat Defect Type": {
    name: "Fat Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Foreign Materials Defect Type": {
    name: "Foreign Materials Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Indigenous Materials Defect Type": {
    name: "Indigenous Materials Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Labeling Defect Type": {
    name: "Labeling Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Meat Quality Defect Type": {
    name: "Meat Quality Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Off Condition Defect Type": {
    name: "Off Condition Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Other Defect Type": {
    name: "Other Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Package Condition Defect Type": {
    name: "Package Condition Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Packaging Defect Type": {
    name: "Packaging Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product Age/Dating Defect Type": {
    name: "Product Age/Dating Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Scheduling Defect Type": {
    name: "Scheduling Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Shipping Defect Type": {
    name: "Shipping Defect Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Temperature Defect Type": {
    name: "Temperature Defect Type",
    type: "BIT",
    allowNull: true,
  },
  "Transportation Defect Type": {
    name: "Transportation Defect Type",
    type: "BIT",
    allowNull: true,
  },
  "Weight/Fill Defect Type": {
    name: "Weight/Fill Defect Type",
    type: "BIT",
    allowNull: true,
  },
  "Problem Statement": {
    name: "Problem Statement",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Do you acknowledge the incident as defined above?": {
    name: "Do you acknowledge the incident as defined above?",
    type: "BIT",
    allowNull: true,
  },
  "Will you begin investigation of the incident as described above?": {
    name: "Will you begin investigation of the incident as described above?",
    type: "BIT",
    allowNull: true,
  },
  "Please provide Root Cause": {
    name: "Please provide Root Cause",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "What is the preventive measure?": {
    name: "What is the preventive measure?",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "FSQA Manager Comments": {
    name: "FSQA Manager Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Rejection Action": {
    name: "Rejection Action",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reporter Comment": {
    name: "Reporter Comment",
    type: "BIT",
    allowNull: true,
  },
  "Buyer Final Review": {
    name: "Buyer Final Review",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Buyer Final Review Comments": {
    name: "Buyer Final Review Comments",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Reporter Final Review": {
    name: "Reporter Final Review",
    type: "BIT",
    allowNull: true,
  },
  "Protein Type": {
    name: "Protein Type",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Do you have enough information to begin investigation of the incident as defined above?":
    {
      name: "Do you have enough information to begin investigation of the incident as defined above?",
      type: "BIT",
      allowNull: true,
    },
  "What information is still needed?": {
    name: "What information is still needed?",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "location (My Location Name/Location Name)": {
    name: "location (My Location Name/Location Name)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "location (My Location GLN/Location GLN)": {
    name: "location (My Location GLN/Location GLN)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  Community: {
    name: "Community",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "incidentDate (Incident Date/Delivery Date)": {
    name: "incidentDate (Incident Date/Delivery Date)",
    type: "DATE",
    allowNull: true,
  },
  "distributor (Shipment Originator/Receiver)": {
    name: "distributor (Shipment Originator/Receiver)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product Name": {
    name: "Product Name",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product GTIN": {
    name: "Product GTIN",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product LOT": {
    name: "Product LOT",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "sourceMembership (Supplier/Product Supplier)": {
    name: "sourceMembership (Supplier/Product Supplier)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supplier Location": {
    name: "Supplier Location",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Description of Incident": {
    name: "Description of Incident",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Delivery Issue": {
    name: "Delivery Issue",
    type: "BIT",
    allowNull: true,
  },
  "Still have the Foreign Material?": {
    name: "Still have the Foreign Material?",
    type: "BIT",
    allowNull: true,
  },
  "Found By": {
    name: "Found By",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product Type (Non-Meat Ingredients, Product Contact Packaging - Plastic, Product Contact Packaging - Non-Plastic, Wood Chips)": {
    name: "Product Type (Non-Meat Ingredients, Product Contact Packaging - Plastic, Product Contact Packaging - Non-Plastic, Wood Chips)",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Incident Photos": {
    name: "Incident Photos",
    type: "BIT",
    allowNull: true,
  },
  "Would you like to request a credit?": {
    name: "Would you like to request a credit?",
    type: "BIT",
    allowNull: true,
  },
  "Vendor RMA": {
    name: "Vendor RMA",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Total Credit Request Amount ($)": {
    name: "Total Credit Request Amount ($)",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Original/Purchase PO": {
    name: "Original/Purchase PO",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Date Received Original PO": {
    name: "Date Received Original PO",
    type: "DATE",
    allowNull: true,
  },
  "Claim #": {
    name: "Claim #",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Downtime Hours": {
    name: "Downtime Hours",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Number of employees": {
    name: "Number of employees",
    type: "DECIMAL(38, 0)",
    allowNull: true,
  },
  "Hourly Rate": {
    name: "Hourly Rate",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Total Labor Cost": {
    name: "Total Labor Cost",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  Pounds: {
    name: "Pounds",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Price/lb": {
    name: "Price/lb",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Total Product Loss": {
    name: "Total Product Loss",
    type: "DECIMAL(38, 2)",
    allowNull: true,
  },
  "Attachments (if applicable)": {
    name: "Attachments (if applicable)",
    type: "BIT",
    allowNull: true,
  },
  "Do you accept the claim as submitted?": {
    name: "Do you accept the claim as submitted?",
    type: "BIT",
    allowNull: true,
  },
  "If no, please explain": {
    name: "If no, please explain",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Root Cause/Corrective Action Response": {
    name: "Root Cause/Corrective Action Response",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Corrective Action Response - Attachment": {
    name: "Corrective Action Response - Attachment",
    type: "BIT",
    allowNull: true,
  },
  "If Additional Information is Needed, Please Provide Comments Here:": {
    name: "If Additional Information is Needed, Please Provide Comments Here:",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Comments:": {
    name: "Comments:",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Comments/Requests:": {
    name: "Comments/Requests:",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Plant Production Date": {
    name: "Plant Production Date",
    type: "DATE",
    allowNull: true,
  },
  "Producing Plant": {
    name: "Producing Plant",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  GTIN: {
    name: "GTIN",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Noted Defects": {
    name: "Noted Defects",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Additional Description of Condition": {
    name: "Additional Description of Condition",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Product Condition (Please Attach 2 Photos of Product on Pallets)": {
    name: "Product Condition (Please Attach 2 Photos of Product on Pallets)",
    type: "BIT",
    allowNull: true,
  },
  "Inbound Issues Noted Defects": {
    name: "Inbound Issues Noted Defects",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Corrective Action Performed": {
    name: "Corrective Action Performed",
    type: "VARCHAR(max)",
    allowNull: true,
  },
  "Supporting Information": {
    name: "Supporting Information",
    type: "BIT",
    allowNull: true,
  },
};

interface Row {
  Id: string;
  "Incident ID": string;
  "Incident Type": string;
  "Current Status": string;
  "Last Updated At": string;
  "Last Updated By": string;
  "Reported By": string;
  "Created At": string;
  "Created From": string;
  "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)": string;
  "location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)": string;
  "community (Community/Business Name)": string;
  "incidentDate (Incident Date/Date of Delivery/Delivery Date)": string;
  "Customer Complaint Related": boolean;
  "Still have the product?": boolean;
  "quantityAffected (Quantity Affected/Affected Quantity)": number;
  "IMAGE OF SUPPLIER CASE LABEL": boolean;
  "IMAGE(s) OF ISSUE AND QUANTITY AFFECTED": boolean;
  "IMAGE OF DISTRIBUTOR LABEL, if applicable": boolean;
  "SUPPLIER INVESTIGATION / CORRECTIVE ACTION(S) REPORT": boolean;
  "Supplier Investigation Report": boolean;
  "Corrective Action Report": boolean;
  "images (Photo of Case Labels & Product/Photos or Documents)": boolean;
  "product (Product GTIN/Product Name GTIN/Material GTIN)": string;
  "Invoice Photo": boolean;
  "Incident Photo(s)": boolean;
  "Supplier Label": boolean;
  "DC Pick Label": boolean;
  "Purchase Order Image": boolean;
  "Invoice Image": boolean;
  "SUPPLIER INVESTIGATION REPORT(S)": boolean;
  "CORRECTIVE ACTION REPORTS": boolean;
  "SUPPLIER CREDIT DOCUMENTATION": boolean;
  "Supplier Documentation / Photos": boolean;
  "DC Documentation / Photos": boolean;
  "Corrective Action Document": boolean;
  "Credit note to supplier": boolean;
  "Credit Note": boolean;
  "Produce Supplier + Distributor INVESTIGATION / CORRECTIVE ACTION(S) REPORT": boolean;
  "Produce Supplier + Distributor Investigation/Corrective Action Report": boolean;
  "Supporting Details": boolean;
  "Supporting Document": boolean;
  "Photos or Documents": boolean;
  "Supplier Photos or Documents": boolean;
  "Distribution Center Photos or Documents": boolean;
  "Load/Pallet Issue": boolean;
  "Trailer Number Photo": boolean;
  "Document/BOL": boolean;
  "Case Label": boolean;
  "Other as Necessary": boolean;
  "Evidence of Correction": boolean;
  "Evidence to Reassign": boolean;
  "Combo/Case Label": boolean;
  "Quality Defect": boolean;
  "RCA Documentation": boolean;
  "Additional Documentation": boolean;
  "Due Date": string;
  "Issued By": string;
  Title: string;
  "distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)": string;
  Country: string;
  "Type of Product Issue": string;
  "Type of Foreign Material": string;
  "Type of Distribution Issue": string;
  "Type of Quality Issue": string;
  Description: string;
  "Do you still have the foreign object?": boolean;
  "Requesting Credit?": boolean;
  "Invoice Date / Delivery Date": string;
  "Invoice Number": string;
  "Affected Quantity": number;
  "Unit of Measurement": string;
  "productType (Product Name/Product Type/QA Product Category/Material Category)": string;
  "Item Name": boolean;
  "sourceMembership (Manufacturer of Product or Distributor Name/Supplier/Product Supplier/Supplier Name)": string;
  "Supplier Status": string;
  "Pack Date / Grind Date / Manufacture Date": boolean;
  "Run Time": boolean;
  "Use By Date / Freeze By Date / Expiration Date": boolean;
  "Production Date / Julian Code / Case Code / Batch Code / Lot Code": string;
  "Hold or Isolate": boolean;
  "Confirm Credit Request": boolean;
  "Review and Action Comments": string;
  "supplierLocation (Supplier Location/Supplier Manufacturing Location)": string;
  "Supplier Corrective Action": string;
  "Supplier Credit Decision": string;
  "Supplier Credit Approval - Rep Name": string;
  "Quantity Credit Amount (Not Dollars)": number;
  "Quantity Unit of Measure": string;
  Comment: string;
  "Credit Decision": string;
  "Credit Number": string;
  "Credit Amount": number;
  Currency: string;
  "Hold Product": boolean;
  "Hold Comments": boolean;
  "Isolate Product": boolean;
  "Isolate Comments": boolean;
  "CM Team Notified": boolean;
  "CM Team Activated": boolean;
  "Reason for Request": string;
  "Please describe further": string;
  "Enter Product Name": string;
  "Distributor Item Number": string;
  "Best By/Expiration Date": string;
  "Do you have enough usable product to last you until next delivery?": boolean;
  "Did you email your Distribution Account Rep and _SupplyChain@Potbelly.com for recovery options? ": boolean;
  "Please describe why you are not emailing _supplychain@potbelly.com": string;
  "Lot Code (enter N/A if this was a short)": string;
  "product (Product Name Name/Material Name/Product Name)": string;
  "product (Product Name LOT/Material LOT/Product LOT)": string;
  "Reason for DC Denial": string;
  "Credit Memo": number;
  "Credit Amount Approved": string;
  "DC Comments": string;
  "Reason for Supplier Denial": boolean;
  "Supplier Comments": boolean;
  Comments: string;
  "Credit Decision by DC": string;
  "Rejection Reason": boolean;
  "Credit Type": boolean;
  "Type of Delivery Incident": string;
  "Still have the product": boolean;
  "Do you still have the foreign object?  If so, please hold for further investigation.": boolean;
  "Date Product Was Received": boolean;
  "Pack Date / Manufacture Date": boolean;
  "Shelf Life Issue": boolean;
  "Supplier Initial Assessment": boolean;
  "Supplier Credit Number": number;
  "Distribution Company": boolean;
  "Incident Acknowledged?": boolean;
  Brand: string;
  "Restaurant Contact Name": string;
  "Restaurant Phone Number": string;
  "Date Product Received": string;
  "DC Invoice Number": number;
  "HAVI Product ID": boolean;
  "Manufacturer Code": number;
  "DC Product Code": number;
  "Best By/Use By Date": string;
  "Complaint Type": string;
  "Complaint Subtype - Foreign Object": string;
  "Complaint Subtype - Low Piece Count": string;
  "Complaint Subtype - Size and Weight": string;
  "Complaint Subtype - Temperature Abuse": boolean;
  "Complaint Subtype - Packaging": boolean;
  "Complaint Subtype - Shelf Life": boolean;
  "Complaint Subtype - Product Performance": boolean;
  "Complaint Subtype - Appearance": string;
  "Complaint Subtype - Fresh Produce": boolean;
  "Complaint Details": string;
  "Quantity Affected": string;
  "Additional Comments": string;
  "Fresh Produce DC Credit Decision": boolean;
  "Fresh Produce DC Comments": boolean;
  "Feedback for Supplier": string;
  "Supplier Additional Comments": string;
  "Reason For Denial": boolean;
  "DC Credit Decision": string;
  "DC Additional Comments": string;
  "DC Reason For Denial": string;
  "DC Corrective Action": boolean;
  "Corrective Action - Distributor Revised": boolean;
  "Produce Supplier + Distributor Credit Decision": boolean;
  "Quantity Credit Amount (Not currency)": boolean;
  "Produce Supplier + Distributor Corrective Action": boolean;
  "Failure Group": string;
  "Failure Type": string;
  Severity: string;
  "Additional Vendor Batch/Lots": boolean;
  Quantity: number;
  "Unit of Measure": string;
  "PO Number": number;
  "Inbound Freight Carrier": boolean;
  "Initial Disposition": string;
  "Downtime Caused (when applicable)": boolean;
  "Potential for Claim": boolean;
  "Root Cause": boolean;
  "Action Plan": string;
  "Responsible Party": boolean;
  "Additional Notes": boolean;
  "Final Disposition": boolean;
  "Resolution Details": boolean;
  "Best By Date": string;
  "Incident Issue": string;
  "Appearance Issue": string;
  "Fatty / Excess Fat Issue": boolean;
  "Foreign Object Issue": boolean;
  "Fresh Produce Issue": boolean;
  "Fresh Produce Credit Decision": boolean;
  "Low Piece Count": string;
  "Off Odor / Flavor Issue": string;
  "Packaging Issue": boolean;
  "Product Performance Issue": boolean;
  "Size and Weight Issue": boolean;
  "Temperature Abuse Issue": boolean;
  "Wrong Product Issue": string;
  "Incident Details": string;
  "Supplier Credit Denial Reason": boolean;
  "Dine Brands Quality Assurance Feedback": boolean;
  "Distribution Center Credit Decision": boolean;
  "Distribution Center Credit Denial Reason": boolean;
  "Distribution Center Additional Comments": boolean;
  "PO# / STO#": number;
  "Does your SAP plant number begin with a 2?": boolean;
  "Batch Code": string;
  "Inbound Issue": string;
  "Inbound Issue Details/Comments": string;
  "Quantity Involved": number;
  "Labor Hours to Correct": number;
  "Incident Investigator Comments": string;
  "Please provide root cause analysis": string;
  "Root Cause Analysis Resolution": string;
  "What is the root cause?": string;
  "What are the corrections you have made?": string;
  "What are the preventive measures you have taken?": string;
  "CAPA Resolution": string;
  "Triage Manager Comments": string;
  "Incident Investigator Review Comments": string;
  "Reporter Review Comments": string;
  "Reason for incorrect information decision": string;
  'Please confirm that you received the notification from "info@foodlogiq.com"': string;
  "Reporter Name": string;
  "Reporter Phone": string;
  "Internal Supplier": string;
  "Est No": string;
  "Defect Group": string;
  "Appearance/Color Defect Type": boolean;
  "Describe the Misc. Color": boolean;
  "Fat Defect Type": string;
  "Foreign Materials Defect Type": string;
  "Indigenous Materials Defect Type": string;
  "Labeling Defect Type": string;
  "Meat Quality Defect Type": string;
  "Off Condition Defect Type": string;
  "Other Defect Type": string;
  "Package Condition Defect Type": string;
  "Packaging Defect Type": string;
  "Product Age/Dating Defect Type": string;
  "Scheduling Defect Type": string;
  "Shipping Defect Type": string;
  "Temperature Defect Type": boolean;
  "Transportation Defect Type": boolean;
  "Weight/Fill Defect Type": boolean;
  "Problem Statement": string;
  "Do you acknowledge the incident as defined above?": boolean;
  "Will you begin investigation of the incident as described above?": boolean;
  "Please provide Root Cause": string;
  "What is the preventive measure?": string;
  "FSQA Manager Comments": string;
  "Rejection Action": string;
  "Reporter Comment": boolean;
  "Buyer Final Review": string;
  "Buyer Final Review Comments": string;
  "Reporter Final Review": boolean;
  "Protein Type": string;
  "Do you have enough information to begin investigation of the incident as defined above?": boolean;
  "What information is still needed?": string;
  "location (My Location Name/Location Name)": string;
  "location (My Location GLN/Location GLN)": string;
  Community: string;
  "incidentDate (Incident Date/Delivery Date)": string;
  "distributor (Shipment Originator/Receiver)": string;
  "Product Name": string;
  "Product GTIN": string;
  "Product LOT": string;
  "sourceMembership (Supplier/Product Supplier)": string;
  "Supplier Location": string;
  "Description of Incident": string;
  "Delivery Issue": boolean;
  "Still have the Foreign Material?": boolean;
  "Still have the Product?": boolean;
  "Found By": string;
  "Product Type (Non-Meat Ingredients, Product Contact Packaging - Plastic, Product Contact Packaging - Non-Plastic, Wood Chips)": string;
  "Incident Photos": boolean;
  "Would you like to request a credit?": boolean;
  "Vendor RMA": string;
  "Total Credit Request Amount ($)": number;
  "Original/Purchase PO": string;
  "Date Received Original PO": string;
  "Claim #": string;
  "Downtime Hours": number;
  "Number of employees": number;
  "Hourly Rate": number;
  "Total Labor Cost": number;
  Pounds: number;
  "Price/lb": number;
  "Total Product Loss": number;
  "Attachments (if applicable)": boolean;
  "Do you accept the claim as submitted?": boolean;
  "If no, please explain": string;
  "Root Cause/Corrective Action Response": string;
  "Corrective Action Response - Attachment": boolean;
  "If Additional Information is Needed, Please Provide Comments Here:": string;
  "Comments:": string;
  "Comments/Requests:": string;
  "Plant Production Date": string;
  "Producing Plant": string;
  GTIN: string;
  "Noted Defects": string;
  "Additional Description of Condition": string;
  "Product Condition (Please Attach 2 Photos of Product on Pallets)": boolean;
  "Inbound Issues Noted Defects": string;
  "Corrective Action Performed": string;
  "Supporting Information": boolean;
}

/**
 * @license
 * Copyright 2025 Qlever LLC
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

/* eslint-disable unicorn/no-null */

import test from "ava";
import sql from "mssql";

// Provide minimal env so config in flIncidentsCsv can initialize
process.env.FL_DOMAIN ||= "https://dummy.local";
process.env.FL_TOKEN ||= "Bearer dummy";
process.env.FL_OWNER ||= "owner-123";
process.env.SQL_COLUMNS_CSV ||= "./test/fixtures/sql-columns-min.csv";

// Dynamically import after env vars are set so config resolves
const { fetchIncidentsCsv } = await import("../dist/flIncidentsCsv.js");

// Stub SQL driver to avoid real DB usage
class StubRequest {
  inputs: Record<string, unknown> = {};
  static queries: string[] = [];
  input(name: string, value: unknown) {
    this.inputs[name] = value;
    return this;
  }
  async query(q: string) {
    StubRequest.queries.push(q);
    return { rowsAffected: [1] } as unknown as sql.IResult<any>;
  }
}

sql.Request = StubRequest as any;
sql.connect = (async () => undefined) as any;

// Stub global sql.query used by ensureTable/ensureColumns
(sql as any).query = (async (first: any) => {
  const text = Array.isArray(first) ? String(first.join("")) : String(first);

  if (text.includes("INFORMATION_SCHEMA.TABLES")) {
    return { recordset: [{ TABLE_NAME: "incidents" }] } as any;
  }

  if (text.includes("INFORMATION_SCHEMA.COLUMNS")) {
    return {
      recordset: [
        { COLUMN_NAME: "Id" },
        { COLUMN_NAME: "Incident ID" },
        {
          COLUMN_NAME:
            "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)",
        },
        {
          COLUMN_NAME:
            "location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)",
        },
        { COLUMN_NAME: "community (Community/Business Name)" },
        {
          COLUMN_NAME:
            "incidentDate (Incident Date/Date of Delivery/Delivery Date)",
        },
        {
          COLUMN_NAME:
            "distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)",
        },
      ],
    } as any;
  }

  return { recordset: [] } as any;
}) as any;

// Simple CSV payload with only a few columns; rest defaulted by ensureNotNull
const csv = ["Id,Incident ID,Created At", "test-001,22-999,2024-01-02"].join(
  "\n",
);

// Mock fetch to return CSV bytes
const enc = new TextEncoder();
const csvBytes = enc.encode(csv);
globalThis.fetch = (async () =>
  new Response(csvBytes, {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  })) as any;

test("fetchIncidentsCsv parses CSV and issues MERGE upserts", async (t) => {
  t.timeout(30_000);
  // Clear any previous queries
  (StubRequest as any).queries.length = 0;

  await fetchIncidentsCsv({ startTime: "2024-01-01", endTime: "2024-01-01" });

  t.true(StubRequest.queries.length > 0);
  const q = StubRequest.queries[0]!;
  t.true(q.includes("MERGE"));
});

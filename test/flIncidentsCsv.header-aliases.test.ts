/**
 * @license
 * Copyright 2026 Qlever LLC
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

import test from "ava";

// Provide minimal env so config in flIncidentsCsv can initialize
process.env.FL_DOMAIN ||= "https://dummy.local";
process.env.FL_TOKEN ||= "Bearer dummy";
process.env.FL_OWNER ||= "owner-123";

// Keep SQL whitelist small and deterministic for these unit tests
process.env.SQL_COLUMNS_CSV ||= "./test/fixtures/sql-columns-min.csv";

const { handleSchemaChanges } = await import("../dist/flIncidentsCsv.js");

const LONG_NAME =
  "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)";
const LONG_GLN =
  "location (Location GLN/Shop Name GLN/Restaurant Reporting Complaint GLN/My Location GLN)";
const DIST_PERSIST =
  "distributor (Distribution Center/Distributor/Shipment Originator/Smithfield Plant)";
const INCIDENT_DATE_CANON =
  "incidentDate (Incident Date/Date of Delivery/Delivery Date)";

test("maps short-window flat headers into canonical SQL columns", (t) => {
  const row = {
    Id: "test-001",
    "Incident ID": "22-222",
    "My Location Name": "5555 - Greentown DC",
    "My Location GLN": "9999999999999",
    "Shipment Originator": "1111 - Springport - IS",
    "Incident Date": "Feb 04, 2026",
  } as any;

  const out = handleSchemaChanges({ ...row });

  t.is(out[LONG_NAME], "5555 - Greentown DC");
  t.is(out[LONG_GLN], "9999999999999");
  t.is(out[DIST_PERSIST], "1111 - Springport - IS");
  t.is(out[INCIDENT_DATE_CANON], "Feb 04, 2026");
});

test("maps long-window paren headers into canonical SQL columns", (t) => {
  const row = {
    Id: "test-002",
    "Incident ID": "22-222",
    "location (My Location Name/Location Name)": "5555 - Greentown DC",
    "location (My Location GLN/Location GLN)": "9999999999999",
    "distributor (Shipment Originator/Smithfield Plant/Receiver)":
      "1111 - Springport - IS",
    "incidentDate (Incident Date/Delivery Date/Date)": "Feb 04, 2026",
  } as any;

  const out = handleSchemaChanges({ ...row });

  t.is(out[LONG_NAME], "5555 - Greentown DC");
  t.is(out[LONG_GLN], "9999999999999");
  t.is(out[DIST_PERSIST], "1111 - Springport - IS");
  // incidentDate (Incident Date/Delivery Date/Date) is normalized via `alters`
  t.truthy(out[INCIDENT_DATE_CANON]);
});

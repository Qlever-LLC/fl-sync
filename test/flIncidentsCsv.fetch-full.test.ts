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

// Use the project's config (compiled) so env-driven values are honored
import config from "../dist/config.js";
const FL_TOKEN = config.get("foodlogiq.token");
const FL_DOMAIN = config.get("foodlogiq.domain");
const CO_ID = config.get("foodlogiq.community.owner.id");

// If required env/config is missing, skip rather than failing
if (!FL_TOKEN || !FL_DOMAIN || !CO_ID) {
  test.skip("fetch full payload test skipped: missing FL config (FL_TOKEN/FL_DOMAIN/CO_ID)");
}

// Dynamically import after reading config
const { fetchIncidentsCsv } = await import("../dist/flIncidentsCsv.js");

// Stub MSSQL so no real DB activity occurs
class NoopRequest {
  input() { return this; }
  async query() { return { rowsAffected: [0] } as any; }
}
// @ts-expect-error override for test
sql.connect = async () => undefined as any;
// @ts-expect-error override for test
sql.Request = NoopRequest as any;

// Helper to ISO string
function iso(d: Date) { return d.toISOString(); }

// Narrow window by default to keep runtime reasonable but still "full payload" from API
const endTime = '';
const startTime = '2024-04-14T00:00:00.000Z..'

test("flIncidentsCsv fetches real payload and parses with xlsx without DB writes", async (t) => {
  t.timeout(10 * 60_000); // up to 10 minutes for network + parsing

  // Run the fetch + parse path; DB calls are no-ops
  await fetchIncidentsCsv({ startTime, endTime });

  // If we reached here without throwing, the fetch + xlsx parse path worked.
  t.pass();
});

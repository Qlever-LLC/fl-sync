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

// @ts-expect-error override for testing
sql.Request = StubRequest as any;
// @ts-expect-error override for testing
sql.connect = async () => undefined as any;

// Simple CSV payload with only a few columns; rest defaulted by ensureNotNull
const csv = [
  "Id,Incident ID,Created At",
  "test-001,22-999,2024-01-02",
].join("\n");

// Mock fetch to return CSV bytes
const enc = new TextEncoder();
const csvBytes = enc.encode(csv);
// @ts-expect-error override global fetch for test
globalThis.fetch = async () =>
  new Response(csvBytes, {
    headers: { "Content-Type": "text/csv; charset=utf-8" },
  });

test("fetchIncidentsCsv parses CSV and issues MERGE upserts", async (t) => {
  t.timeout(30_000);
  // Clear any previous queries
  (StubRequest as any).queries.length = 0;

  await fetchIncidentsCsv({ startTime: "2024-01-01", endTime: "2024-01-01" });

  t.true(StubRequest.queries.length > 0);
  const q = StubRequest.queries[0]!;
  t.true(q.includes("MERGE"));
});

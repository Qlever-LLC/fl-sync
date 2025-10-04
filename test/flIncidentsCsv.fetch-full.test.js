/**
 * Integration-style test: real fetch + xlsx parsing, no DB writes
 */
import test from "ava";
import sql from "mssql";
import config from "../dist/config.js";

const FL_TOKEN = config.get("foodlogiq.token");
const FL_DOMAIN = config.get("foodlogiq.domain");
const CO_ID = config.get("foodlogiq.community.owner.id");

if (!FL_TOKEN || !FL_DOMAIN || !CO_ID) {
  test.skip("fetch full payload test skipped: missing FL config (FL_TOKEN/FL_DOMAIN/CO_ID)");
}

const { fetchIncidentsCsv } = await import("../dist/flIncidentsCsv.js");

class NoopRequest {
  input() { return this; }
  async query() { return { rowsAffected: [0] }; }
}
// Stub MSSQL
// @ts-ignore
sql.connect = async () => undefined;
// @ts-ignore
sql.Request = NoopRequest;

function iso(d) { return d.toISOString(); }
const endTime = iso(new Date());
const startTime = iso(new Date(Date.now() - 24 * 60 * 60 * 1000));

test("flIncidentsCsv fetches real payload and parses with xlsx without DB writes (js)", async (t) => {
  t.timeout(10 * 60_000);
  await fetchIncidentsCsv({ startTime, endTime });
  t.pass();
});

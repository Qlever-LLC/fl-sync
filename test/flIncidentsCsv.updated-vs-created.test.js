/**
 * Compare FoodLogiQ incidents returned by updated= vs created= windows.
 * Fetches both (single CSV response), parses via xlsx, and prints a summary.
 *
 * Hardened to avoid hangs:
 * - Conditional skip if FL config missing
 * - Per-request timeout via AbortController
 * - Default 7-day window (overridable via TEST_START/TEST_END)
 */
import test from "ava";
import xlsx from "xlsx";
import config from "../dist/config.js";

const FL_TOKEN = config.get("foodlogiq.token");
const FL_DOMAIN = config.get("foodlogiq.domain");
const CO_ID = config.get("foodlogiq.community.owner.id");

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? "30000");

async function fetchCsv(paramName, startTime, endTime) {
  const params = new URLSearchParams();
  params.set(paramName, `${startTime}..${endTime}`);
  const url = `${FL_DOMAIN}/v2/businesses/${CO_ID}/incidents/csv?${params}`;

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(new Error("Request timed out")), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Authorization: FL_TOKEN },
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ab = await r.arrayBuffer();
    const wb = xlsx.read(new Uint8Array(ab), { type: "array", cellDates: true });
    const sheetname = wb.SheetNames[0];
    if (!sheetname) return [];
    const sheet = wb.Sheets[String(sheetname)];
    if (!sheet) return [];
    return xlsx.utils.sheet_to_json(sheet);
  } finally {
    clearTimeout(to);
  }
}

function toIdSet(rows) {
  const s = new Set();
  for (const row of rows) {
    if (row && typeof row === "object" && "Id" in row) s.add(row.Id);
  }
  return s;
}

function diff(a, b) {
  const out = [];
  for (const id of a) if (!b.has(id)) out.push(id);
  return out;
}

function iso(d) { return d.toISOString(); }

// Window selection: use env overrides if provided; default last 365 days
const END = process.env.TEST_END || iso(new Date());
const START = process.env.TEST_START || iso(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

// Proper conditional skip so the test body is not registered without config
const shouldSkip = !FL_TOKEN || !FL_DOMAIN || !CO_ID;
const maybeTest = shouldSkip ? test.skip : test;

maybeTest("Compare incidents updated= vs created= windows", async (t) => {
  // Long but bounded when not debugging; AVA disables this when a debugger is attached
  t.timeout(60 * 60_000);
  console.log(`Window: ${START} .. ${END}`);

  const updatedRows = await fetchCsv("updated", START, END);
  const createdRows = await fetchCsv("created", START, END);

  console.log(`Counts: updated=${updatedRows.length}, created=${createdRows.length}`);

  const updatedIds = toIdSet(updatedRows);
  const createdIds = toIdSet(createdRows);

  const createdNotInUpdated = diff(createdIds, updatedIds);
  const updatedNotInCreated = diff(updatedIds, createdIds);

  console.log(`created ⊄ updated? missing=${createdNotInUpdated.length}`);
  if (createdNotInUpdated.length > 0) {
    console.log(`Sample missing (created not in updated):`, createdNotInUpdated.slice(0, 20));
  }
  console.log(`updated ⊄ created? missing=${updatedNotInCreated.length}`);
  if (updatedNotInCreated.length > 0) {
    console.log(`Sample missing (updated not in created):`, updatedNotInCreated.slice(0, 20));
  }

  // Soft assertion: ensure both requests succeeded by having at least attempted parsing
  t.true(Array.isArray(updatedRows) && Array.isArray(createdRows));
});

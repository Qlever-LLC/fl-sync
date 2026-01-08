import xlsx from "xlsx";
import { promises as fs } from "node:fs";

import {
  normalizeCsvData,
  handleSchemaChanges,
  handleTypes,
  ensureNotNull,
} from "./flIncidentsCsv.js"; // adjust path if needed

import type { Row } from "./flIncidentsCsv.js";

const SHORT =
  "location (My Location Name/Location Name)" as const;
const LONG =
  "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)" as const;

async function dryRunFullLocations(
  incomingCsv: string,
  sqlCsv: string,
  outCsv: string
) {
  const sqlState = await loadSqlSnapshot(sqlCsv);
  console.log({sqlState})

  const incomingText = await fs.readFile(incomingCsv, "utf-8");
  const incomingRows : Row[] = parse(incomingText, {
    columns: true,
    skip_empty_lines: true,
  });

  const out: Record<string, unknown>[] = [];

  for (const row of incomingRows) {
    const id = row['Incident ID'];

    const afterSchema = handleSchemaChanges({ ...row } as Row);
    const afterTypes = handleTypes({ ...afterSchema } as Row);
    const afterDefaults = ensureNotNull({ ...afterTypes } as Row);

    const sql = sqlState.get(id);

    console.log('sql.short', id, sql, sql?.short)
    const short_before = sql?.short ?? null;
    const long_before = sql?.long ?? null;

    const short_after = mergeVarchar(
      afterDefaults[SHORT],
      short_before
    );

    const long_after = mergeVarchar(
      afterDefaults[LONG],
      long_before
    );

    out.push({
      Id: id,

      //the csv writer will probably change js null to "", so let's be
      //more explicit and change null to "null" first. do it here so
      //that the _would_change outputs below are not affected.
      short_sql_before: short_before === null ? 'null' : short_before,
      long_sql_before: long_before === null ? 'null' : long_before,

      short_incoming: afterDefaults[SHORT],
      long_incoming: afterDefaults[LONG],

      short_sql_after: short_after,
      long_sql_after: long_after,

      short_would_change: short_after !== short_before,
      long_would_change: long_after !== long_before,
    });
  }

  const xlsx = await import("xlsx");
  const ws = xlsx.utils.json_to_sheet(out);
  const csv = xlsx.utils.sheet_to_csv(ws);
  await fs.writeFile(outCsv, csv, "utf-8");
}

function normalizeSqlVarchar(v: unknown): string | null {
  if (v === undefined || v === null) return null;

  if (typeof v !== "string") return String(v);

  const s = v.trim();

  // SQL NULL sentinel
  if (s.toUpperCase() === "NULL") return null;

  // Preserve empty string as empty string
  // (this reflects actual SQL '')
  if (s === "") return "";

  return s;
}


/*
async function dryRunLocations(
  csvPath: string,
  sqlSnapshotPath: string
) {
  const sqlSnapshot = await loadSqlSnapshot(sqlSnapshotPath);

  const text = await fs.readFile(csvPath, "utf-8");
  const records : Row[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
  });

  const SHORT =
    "location (My Location Name/Location Name)" as const;
  const LONG =
    "location (Location Name/Shop Name Name/Restaurant Reporting Complaint Name/My Location Name)" as const;

  const rows = [];

  for (const row of records) {
    const afterSchema = handleSchemaChanges({ ...row } as Row);
    const afterTypes = handleTypes({ ...afterSchema } as Row);
    const afterDefaults = ensureNotNull({ ...afterTypes } as Row);

    const sqlRow = sqlSnapshot.get(row.Id);

    const sqlBefore = sqlRow?.long ?? null;
    const sqlAfter = mergeLikeSql(
      afterDefaults[LONG],
      sqlBefore
    );

    rows.push({
      Id: row.Id,
      short_raw: row[SHORT],
      incoming_long: afterDefaults[LONG],
      sql_before: sqlBefore,
      sql_after_simulated: sqlAfter,
      would_change: sqlAfter !== sqlBefore,
    });
  }

  console.table(rows);
}
*/

import { parse } from "csv-parse/sync";

type SqlRow = {
  Id: string;
  short: string | null;
  long: string | null;
};

async function loadSqlSnapshot(path: string): Promise<Map<string, SqlRow>> {
  const text = await fs.readFile(path, "utf-8");
  const records : Row[] = parse(text, { columns: true, skip_empty_lines: true });

  const map = new Map<string, SqlRow>();

  for (const r of records) {
    console.log({short: r[SHORT], long: r[LONG]})
    map.set(r['Incident ID'], {
      Id: r['Incident ID'],
      short: normalizeSqlVarchar(r[SHORT]),
      long: normalizeSqlVarchar(r[LONG]),
    });
  }

  return map;
}

function mergeVarchar(
  incoming: string | undefined,
  existing: string | null
): string | null {
  // NULLIF(@val, '')
  if (incoming === undefined || incoming === "") {
    return existing;
  }
  return incoming;
}

function mergeLikeSql(
  incoming: string | undefined,
  existing: string | null | undefined
): string | null | undefined {
  // NULLIF(@incoming, '')
  if (incoming === undefined) return existing;
  if (incoming === "") return existing;

  // COALESCE(NULLIF(@incoming,''), target.col)
  return incoming;
}

// ------------------------------------------------------------
// CLI ENTRYPOINT
// ------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , incomingCsv, sqlCsv, outCsv] = process.argv;

  if (!incomingCsv || !sqlCsv || !outCsv) {
    console.error(`
Usage:
  node dist/dryRunLocations.js <incoming_csv> <sql_snapshot_csv> <output_csv>

Example:
  yarn node dist/dryRunLocations.js \\
    test_incidents-2026-01-07.csv \\
    sql_incidents_snapshot.csv \\
    dry_run_locations_output.csv
`);
    process.exit(1);
  }

  dryRunFullLocations(incomingCsv, sqlCsv, outCsv)
    .then(() => {
      console.log(`✔ Dry run written to ${outCsv}`);
    })
    .catch((err) => {
      console.error("✖ Dry run failed");
      console.error(err);
      process.exit(1);
    });
}

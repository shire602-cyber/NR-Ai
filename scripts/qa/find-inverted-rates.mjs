#!/usr/bin/env node
// Read-only dry run for migration 0094 (W2-E, R14-02 / R14-01).
//
// Lists exchange_rates rows that 0094 rewrites or quarantines, without changing anything:
//   - inverted:   (AED, X) rows written by the old Exchange Rates page route, which stored
//                 "1 X = r AED" as (AED, X, r). 0094 rewrites them to (X, AED, r).
//   - ambiguous:  (AED, X) rows from other sources (api / fta). 0094 leaves them alone; an
//                 operator should confirm which way round the rate was meant.
//   - unscoped:   rows with no determinable owner that 0094 flags legacy_unscoped (ignored by
//                 lookups). Before 0094 this is every non-FTA row when there is more than one
//                 company.
//   - rewritten / quarantined: rows 0094 already handled (when run after the migration).
//
// Usage: DATABASE_URL=postgres://... node scripts/qa/find-inverted-rates.mjs [--json] [--fail-on-findings]
// Exit code is 0 unless the database cannot be read. With --fail-on-findings it is 1 when rows still
// need action: inverted, ambiguous, or (before 0094) unscoped. Rows 0094 already handled
// (rewritten, legacy_unscoped quarantined) are informational and never fail the run.

import pg from "pg";
import { findingsExitCode } from "./fail-on-findings.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'exchange_rates'`
  );
  const has = new Set(cols.rows.map((r) => r.column_name));
  const migrated = has.has("legacy_unscoped");
  const companies = Number(
    (await client.query(`SELECT COUNT(*)::int AS n FROM companies`)).rows[0].n
  );

  const select = migrated
    ? `id, company_id, base_currency, target_currency, rate::text AS rate, date, source,
       legacy_unscoped, legacy_inverted`
    : `id, NULL::uuid AS company_id, base_currency, target_currency, rate::text AS rate, date,
       source, false AS legacy_unscoped, false AS legacy_inverted`;
  const { rows } = await client.query(
    `SELECT ${select} FROM exchange_rates ORDER BY date DESC, base_currency, target_currency`
  );

  const fmt = (r) => ({
    id: r.id,
    companyId: r.company_id,
    pair: `${r.base_currency}/${r.target_currency}`,
    rate: r.rate,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    source: r.source,
  });
  const isAedBase = (r) => r.base_currency === "AED" && r.target_currency !== "AED";

  const report = {
    migrated,
    companies,
    inverted: rows
      .filter((r) => isAedBase(r) && r.source === "manual" && !r.legacy_inverted)
      .map((r) => ({
        ...fmt(r),
        proposed: `${r.target_currency}/AED`,
        meaning: `1 ${r.target_currency} = ${r.rate} AED`,
      })),
    ambiguous: rows
      .filter((r) => isAedBase(r) && r.source !== "manual")
      .map((r) => ({
        ...fmt(r),
        readings: [
          `1 AED = ${r.rate} ${r.target_currency}`,
          `1 ${r.target_currency} = ${r.rate} AED`,
        ],
      })),
    unscoped: migrated
      ? rows.filter((r) => r.legacy_unscoped).map(fmt)
      : companies === 1
        ? []
        : rows.filter((r) => r.source !== "fta").map(fmt),
    rewritten: rows.filter((r) => r.legacy_inverted && !r.legacy_unscoped).map(fmt),
  };
  await client.query("ROLLBACK");
  process.exitCode = findingsExitCode(
    process.argv,
    {
      inverted: report.inverted,
      ambiguous: report.ambiguous,
      unscoped: migrated ? [] : report.unscoped,
    },
    "find-inverted-rates"
  );

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `exchange_rates dry run — migration 0094 ${migrated ? "already applied" : "not applied yet"}, ` +
        `${companies} compan${companies === 1 ? "y" : "ies"}`
    );
    for (const key of ["inverted", "ambiguous", "unscoped", "rewritten"]) {
      console.log(`\n${key}: ${report[key].length}`);
      for (const r of report[key]) console.log(`  ${JSON.stringify(r)}`);
    }
  }
} finally {
  await client.end();
}

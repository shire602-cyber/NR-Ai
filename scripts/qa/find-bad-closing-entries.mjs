#!/usr/bin/env node
// Read-only detector for closing entries corrupted by R08-01.
//
// Before W2-B, month-end "generate closing entries" summed every journal line
// ever posted to each income/expense account (the date/status filters sat on
// an outer-join ON clause), so a monthly closing entry could sweep other
// months. This script lists every existing closing entry (legacy month-end
// closes: source 'system' + memo "Closing entries for <from> to <to>"; tagged
// year-end closes: source 'year_end_close') whose lines exceed the posted,
// non-closing activity inside its own period, and prints a DRY-RUN repair
// proposal as a reversing entry. Monthly closes are no longer needed (the
// statements roll retained earnings forward by computation), so the proposal
// reverses the whole bad entry.
//
// It never writes: everything runs in a READ ONLY transaction.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/qa/find-bad-closing-entries.mjs [--company <uuid>] [--json] [--fail-on-findings]
//
// Exit codes: 0 for a completed report (also when it lists findings), 1 when --fail-on-findings is
// given and at least one closing entry exceeds its period, 2 for bad usage.

import pg from "pg";
import { findingsExitCode } from "./fail-on-findings.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const companyIdx = args.indexOf("--company");
const companyId = companyIdx >= 0 ? args[companyIdx + 1] : null;
if (companyId !== null && !/^[0-9a-f-]{36}$/i.test(companyId ?? "")) {
  console.error("--company must be a uuid");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const LOCAL_DATE = `((je.date + interval '4 hours')::date)`;
const CLOSING = `(je.source IN ('year_end_close','closing','period_close') OR (je.source = 'system' AND COALESCE(je.memo, '') LIKE 'Closing entries for %'))`;
const PERIOD_RE = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/;

const fils = (v) => Number(v);
const aed = (f) => {
  const v = f / 100;
  return Object.is(v, -0) ? 0 : v;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const findings = [];
let scanned = 0;
try {
  await client.query("BEGIN READ ONLY");
  const entries = await client.query(
    `SELECT je.id, je.company_id, je.entry_number, ${LOCAL_DATE}::text AS d, je.memo, je.source
       FROM journal_entries je
      WHERE je.status = 'posted' AND ${CLOSING}
        AND ($1::uuid IS NULL OR je.company_id = $1::uuid)
        AND COALESCE(je.memo, '') NOT LIKE 'Reversal of %'
      ORDER BY je.company_id, je.date`,
    [companyId]
  );
  for (const e of entries.rows) {
    scanned++;
    const m = PERIOD_RE.exec(e.memo ?? "");
    const periodStart = m ? m[1] : e.d.slice(0, 8) + "01";
    const periodEnd = m ? m[2] : e.d;
    const lines = await client.query(
      `SELECT jl.account_id, a.code, a.name_en, a.type,
              ROUND(jl.debit * 100)::bigint AS dr, ROUND(jl.credit * 100)::bigint AS cr
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1`,
      [e.id]
    );
    const period = await client.query(
      `SELECT jl.account_id,
              COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS dr,
              COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS cr
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND NOT ${CLOSING}
          AND ${LOCAL_DATE} BETWEEN $2::date AND $3::date
        GROUP BY jl.account_id`,
      [e.company_id, periodStart, periodEnd]
    );
    const inPeriod = new Map(period.rows.map((r) => [r.account_id, fils(r.dr) - fils(r.cr)]));
    const offending = [];
    for (const l of lines.rows) {
      if (l.type !== "income" && l.type !== "expense") continue;
      const actual = fils(l.dr) - fils(l.cr); // closing line, debit positive
      const expected = -(inPeriod.get(l.account_id) ?? 0); // closing reverses the in-period balance
      if (Math.abs(actual) > Math.abs(expected) || Math.sign(actual) !== Math.sign(expected)) {
        if (actual === expected) continue;
        offending.push({
          accountId: l.account_id,
          accountCode: l.code,
          accountName: l.name_en,
          actual: aed(Math.abs(actual)),
          side: actual >= 0 ? "debit" : "credit",
          expectedFromPeriod: aed(Math.abs(expected)),
          excess: aed(Math.abs(actual) - Math.abs(expected)),
        });
      }
    }
    if (!offending.length) continue;
    findings.push({
      companyId: e.company_id,
      entryId: e.id,
      entryNumber: e.entry_number,
      date: e.d,
      memo: e.memo,
      source: e.source,
      periodStart,
      periodEnd,
      offendingLines: offending,
      repairProposal: {
        dryRun: true,
        description: `Reverse ${e.entry_number}: monthly closing entries are not needed; statements roll retained earnings forward by computation.`,
        date: e.d,
        memo: `Reversal of ${e.memo ?? e.entry_number}`,
        source: e.source,
        lines: lines.rows.map((l) => ({
          accountId: l.account_id,
          accountCode: l.code,
          accountName: l.name_en,
          debit: aed(fils(l.cr)),
          credit: aed(fils(l.dr)),
        })),
      },
    });
  }
  await client.query("ROLLBACK");
} finally {
  await client.end();
}

if (json) {
  process.stdout.write(JSON.stringify({ scanned, findings }, null, 2) + "\n");
} else {
  console.log(
    `Scanned ${scanned} closing entr${scanned === 1 ? "y" : "ies"}; ${findings.length} exceed their period.`
  );
  for (const f of findings) {
    console.log(
      `\n${f.entryNumber} (${f.date}) company ${f.companyId} — period ${f.periodStart}..${f.periodEnd}`
    );
    for (const l of f.offendingLines) {
      console.log(
        `  ${l.accountCode} ${l.accountName}: ${l.side} ${l.actual} vs in-period ${l.expectedFromPeriod} (excess ${l.excess})`
      );
    }
    console.log("  DRY-RUN repair (reversing entry, not posted):");
    for (const l of f.repairProposal.lines) {
      console.log(
        `    ${l.accountCode.padEnd(6)} Dr ${String(l.debit).padStart(14)}  Cr ${String(l.credit).padStart(14)}`
      );
    }
  }
}

process.exitCode = findingsExitCode(args, { findings }, "find-bad-closing-entries");

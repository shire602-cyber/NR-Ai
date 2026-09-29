#!/usr/bin/env node
// Read-only diagnostic: lists foreign-currency invoices, credit notes and vendor
// bills whose stored exchange rate to AED looks wrong, so the owner can review them.
//
// Background: before migration 0091 the exchange-rate API stored a rate typed as
// "1 CHF = 4.1 AED" in the opposite direction, and rates were shared across
// companies. Documents booked from such a rate carry a rate that is inverted
// (0.2439 instead of 4.1) or another company's. Posted documents are NOT rewritten
// by the fix; this script only finds them.
//
// Convention: document exchange_rate = AED per 1 unit of the document currency.
// A rate is flagged when it is below 0.5 or above 50 for USD, EUR, GBP, SAR, CHF
// (their real rates are roughly 0.98 to 5). INR is worth about 0.044 AED, so for
// INR the plausible band is 0.02 to 0.1 and anything outside it (for example
// 22.7, the inverted rate) is flagged. A foreign-currency document at exactly 1
// is flagged too: it means no rate was applied.
//
// Only SELECT statements are issued. Usage:
//   DATABASE_URL=postgres://... node scripts/find-suspect-fx-documents.mjs [--json]

import pg from "pg";

const COMMON = ["USD", "EUR", "GBP", "SAR", "CHF", "INR"];
const BAND = { INR: [0.02, 0.1] }; // everything else: [0.5, 50]
const DEFAULT_BAND = [0.5, 50];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

// [label, table, number column, date column, currency column, total column]
const SOURCES = [
  ["invoice", "invoices", "number", "date", "currency", "total"],
  ["credit note", "credit_notes", "number", "date", "currency", "total"],
  ["vendor bill", "vendor_bills", "bill_number", "bill_date", "currency", "total_amount"],
];

export function whyFlagged(currency, rate) {
  const [lo, hi] = BAND[currency] ?? DEFAULT_BAND;
  if (rate === 1) return "rate is exactly 1 on a foreign-currency document (no rate applied)";
  if (rate < lo) return `rate ${rate} is below ${lo} AED per ${currency}`;
  if (rate > hi) return `rate ${rate} is above ${hi} AED per ${currency}`;
  return null;
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const found = [];
  const notes = [];
  try {
    await client.query("BEGIN READ ONLY");
    for (const [label, table, numCol, dateCol, curCol, totalCol] of SOURCES) {
      const cols = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
          [table]
        )
      ).rows.map((r) => r.column_name);
      if (cols.length === 0) {
        notes.push(`${table}: table not found, skipped`);
        continue;
      }
      if (!cols.includes("exchange_rate")) {
        notes.push(`${table}: no exchange_rate column, so no stored rate to check`);
        continue;
      }
      const rows = (
        await client.query(
          `SELECT id, company_id, ${numCol} AS number, ${dateCol} AS date, ${curCol} AS currency,
                  ${totalCol}::float8 AS total, exchange_rate::float8 AS rate
             FROM ${table}
            WHERE ${curCol} = ANY($1::text[]) AND ${curCol} <> 'AED'
            ORDER BY ${dateCol} DESC`,
          [COMMON]
        )
      ).rows;
      for (const r of rows) {
        const reason = whyFlagged(r.currency, r.rate);
        if (reason) found.push({ type: label, ...r, reason });
      }
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  if (asJson) {
    console.log(JSON.stringify({ suspects: found, notes }, null, 2));
    return;
  }
  for (const n of notes) console.log(`note: ${n}`);
  if (found.length === 0) {
    console.log("No suspect foreign-currency documents found.");
    return;
  }
  console.log(`${found.length} suspect document(s) (review; nothing was changed):\n`);
  for (const f of found) {
    const day = new Date(f.date).toISOString().slice(0, 10);
    console.log(
      `${f.type.padEnd(11)} ${String(f.number ?? f.id).padEnd(16)} ${day}  company ${f.company_id}  ` +
        `${f.currency} ${f.total} @ ${f.rate}  ${f.reason}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

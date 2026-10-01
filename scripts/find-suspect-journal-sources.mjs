#!/usr/bin/env node
// Read-only diagnostic: lists journal entries whose `source` is a system value but which have no
// matching system record, so the owner can review them.
//
// Background: until the fix that makes the journal routes always store source "manual", a manual
// journal could name any `source` in its request body. The reports trust that value (a
// "year_end_close" entry is left out of the profit and loss; "vat_filing" and "opening_balance"
// entries are left out of the VAT ledger reading), so a forged value hides money. Entries written
// by the system always have a record that points at them; a system source WITHOUT such a record is
// suspect. Rows are NOT rewritten: whether a suspect entry was forged or is an old system entry
// whose record was later removed is a human judgement.
//
// Records that count as a match:
//   vat_filing / corporate_tax_filing        tax_filings.clearing_entry_id = the entry
//   vat_payment / corporate_tax_payment      tax_filing_payments.journal_entry_id = the entry
//   year_end_close                           year_end_closes.closing_entry_id = the entry, or a corporate tax
//                                            filing's closing line (source_id = a tax_filings.return_id)
//   year_end_close_reversal                  it reverses a year_end_close entry (reversed_entry_id or the
//                                            source_id of the close), or reopens a year_end_closes row
//   opening_balance                          opening_balances.journal_entry_id = the entry
//   opening_balance_reversal                 reversed_entry_id is an opening_balance entry
//   fx_revaluation                           an fx_revaluation_reversal entry reverses it
//   fx_revaluation_reversal                  reversed_entry_id is an fx_revaluation entry
//   invoice / payment / receipt / bill /     source_id names an existing invoice, receipt, bill,
//   bill_payment / expense_claim(_payment)   bill payment or expense claim of the SAME company
//   reversal                                 reversed_entry_id names another entry of the same company
//
// Only SELECT statements are issued, inside a read-only transaction. Usage:
//   DATABASE_URL=postgres://... node scripts/find-suspect-journal-sources.mjs [--json]

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

const LINKED_BY_RECORD = (sub) => `NOT EXISTS (${sub})`;

// source -> SQL condition that is TRUE when the entry has NO matching record (i.e. is suspect)
export const RULES = {
  vat_filing: LINKED_BY_RECORD(`SELECT 1 FROM tax_filings t WHERE t.clearing_entry_id = je.id`),
  corporate_tax_filing: LINKED_BY_RECORD(`SELECT 1 FROM tax_filings t WHERE t.clearing_entry_id = je.id`),
  vat_payment: LINKED_BY_RECORD(`SELECT 1 FROM tax_filing_payments p WHERE p.journal_entry_id = je.id`),
  corporate_tax_payment: LINKED_BY_RECORD(`SELECT 1 FROM tax_filing_payments p WHERE p.journal_entry_id = je.id`),
  year_end_close: LINKED_BY_RECORD(
    `SELECT 1 FROM year_end_closes y WHERE y.closing_entry_id = je.id
     UNION ALL SELECT 1 FROM tax_filings t WHERE t.return_id = je.source_id AND t.company_id = je.company_id`
  ),
  year_end_close_reversal: LINKED_BY_RECORD(
    `SELECT 1 FROM journal_entries o WHERE o.id = je.reversed_entry_id AND o.source = 'year_end_close' AND o.company_id = je.company_id
     UNION ALL SELECT 1 FROM year_end_closes y WHERE y.id = je.source_id AND y.company_id = je.company_id
     UNION ALL SELECT 1 FROM journal_entries o WHERE o.id = je.source_id AND o.source = 'year_end_close' AND o.company_id = je.company_id`
  ),
  opening_balance: LINKED_BY_RECORD(`SELECT 1 FROM opening_balances b WHERE b.journal_entry_id = je.id`),
  opening_balance_reversal: LINKED_BY_RECORD(
    `SELECT 1 FROM journal_entries o WHERE o.id = je.reversed_entry_id AND o.source = 'opening_balance' AND o.company_id = je.company_id`
  ),
  fx_revaluation: LINKED_BY_RECORD(
    `SELECT 1 FROM journal_entries r WHERE r.reversed_entry_id = je.id AND r.source = 'fx_revaluation_reversal'`
  ),
  fx_revaluation_reversal: LINKED_BY_RECORD(
    `SELECT 1 FROM journal_entries o WHERE o.id = je.reversed_entry_id AND o.source = 'fx_revaluation' AND o.company_id = je.company_id`
  ),
  invoice: LINKED_BY_RECORD(`SELECT 1 FROM invoices d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  inventory_cogs: LINKED_BY_RECORD(`SELECT 1 FROM invoices d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  inventory_movement: LINKED_BY_RECORD(`SELECT 1 FROM inventory_movements d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  inventory_opening: LINKED_BY_RECORD(`SELECT 1 FROM companies c WHERE c.id = je.source_id AND c.id = je.company_id`),
  payment: LINKED_BY_RECORD(`SELECT 1 FROM invoices d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  receipt: LINKED_BY_RECORD(`SELECT 1 FROM receipts d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  customer_refund: LINKED_BY_RECORD(`SELECT 1 FROM customer_refunds d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  bill: LINKED_BY_RECORD(`SELECT 1 FROM vendor_bills d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  bill_payment: LINKED_BY_RECORD(
    `SELECT 1 FROM bill_payments d JOIN vendor_bills b ON b.id = d.bill_id WHERE d.id = je.source_id AND b.company_id = je.company_id`
  ),
  vendor_credit_fx: LINKED_BY_RECORD(`SELECT 1 FROM vendor_credit_applications d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  expense_claim: LINKED_BY_RECORD(`SELECT 1 FROM expense_claims d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  expense_claim_payment: LINKED_BY_RECORD(`SELECT 1 FROM expense_claims d WHERE d.id = je.source_id AND d.company_id = je.company_id`),
  reversal: LINKED_BY_RECORD(`SELECT 1 FROM journal_entries o WHERE o.id = je.reversed_entry_id AND o.company_id = je.company_id`),
};

async function tableExists(client, name) {
  const r = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1", [name]);
  return r.rows.length > 0;
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const found = [];
  const notes = [];
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN READ ONLY");
    for (const [source, condition] of Object.entries(RULES)) {
      const tables = [...condition.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]).filter((t) => t !== "journal_entries");
      const missing = [];
      for (const t of new Set(tables)) if (!(await tableExists(client, t))) missing.push(t);
      if (missing.length) {
        notes.push(`${source}: table ${missing.join(", ")} not found, rule skipped`);
        continue;
      }
      const rows = (
        await client.query(
          `SELECT je.id, je.company_id, je.entry_number, je.date, je.status, je.source, je.source_id, je.reversed_entry_id, je.memo, je.created_by,
                  (SELECT COALESCE(SUM(jl.debit), 0)::float8 FROM journal_lines jl WHERE jl.entry_id = je.id) AS total
             FROM journal_entries je
            WHERE je.source = $1 AND ${condition}
            ORDER BY je.date DESC`,
          [source]
        )
      ).rows;
      for (const r of rows) found.push({ ...r, reason: `source "${source}" but no matching ${source} record` });
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
    console.log("No journal entries with a system source and no matching record found.");
    return;
  }
  console.log(`${found.length} suspect journal entr${found.length === 1 ? "y" : "ies"} (review; nothing was changed):\n`);
  for (const f of found) {
    const day = new Date(f.date).toISOString().slice(0, 10);
    console.log(
      `${String(f.entry_number).padEnd(18)} ${day}  ${String(f.status).padEnd(7)} company ${f.company_id}  total ${f.total}  ` +
        `${f.source}${f.memo ? `  "${String(f.memo).slice(0, 60)}"` : ""}  entry ${f.id}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
// Read-only review list for the W3-A sales-ledger fixes (migration 0095 backfills nothing).
//
// Lists, without changing anything:
//   - ambiguousZeroRated:  0% invoice lines stored as standard_rated (or with no supply type).
//                          Before R07-01 every 0% line was saved this way, so zero-rated,
//                          exempt and out-of-scope supplies are indistinguishable. The owner
//                          must decide the real supply type (VAT 201 Box 4 vs Box 5 vs none).
//   - zeroRatedOn4010:     issued invoices with 0% lines whose revenue entry credited no
//                          4060 / 4070 / 4030 account (revenue folded into 4010).
//   - phantomVoidBalance:  voided foreign-currency invoices whose A/R does not net to zero
//                          (pre-W3-A voids reversed document-currency amounts, R03-01).
//   - creditNotesOn4010:   credit notes whose reversal debited 4010 although the original
//                          invoice credited 4060 / 4070 / 4030 (R03-04).
//   - negativeReceivable:  issued invoices with more credits + payments than total
//                          (pre-W3-A credit notes on paid invoices, R03-08).
//
// Usage: DATABASE_URL=postgres://... node scripts/qa/find-sales-ledger-drift.mjs [--json] [--company <uuid>]
// Exit codes: 0 for a completed report, 1 for a database failure, 2 for missing configuration.

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const asJson = process.argv.includes("--json");
const ci = process.argv.indexOf("--company");
const companyId = ci > 0 ? process.argv[ci + 1] : null;

const client = new pg.Client({ connectionString: url });
async function queryRows(check, sql, params) {
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${check} failed: ${detail}`, { cause: error });
  }
}

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const scope = companyId ? "AND i.company_id = $1" : "";
  const params = companyId ? [companyId] : [];

  const ambiguousZeroRated = await queryRows(
    "ambiguousZeroRated",
    `SELECT i.company_id, i.id AS invoice_id, i.number, i.status, i.invoice_type,
              il.id AS line_id, il.description, il.vat_supply_type,
              (il.quantity * il.unit_price)::numeric(15,2)::text AS net
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
        WHERE il.vat_rate = 0 AND (il.vat_supply_type IS NULL OR il.vat_supply_type = 'standard_rated')
          ${scope}
        ORDER BY i.company_id, i.date, i.number`,
    params
  );

  const zeroRatedOn4010 = await queryRows(
    "zeroRatedOn4010",
    `SELECT i.company_id, i.id AS invoice_id, i.number
         FROM invoices i
        WHERE i.status IN ('sent','posted','partial','paid') ${scope}
          AND i.invoice_type <> 'credit_note'
          AND EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = i.id AND il.vat_rate = 0)
          AND NOT EXISTS (
            SELECT 1 FROM journal_lines jl
              JOIN journal_entries je ON je.id = jl.entry_id
              JOIN accounts a ON a.id = jl.account_id
             WHERE je.source = 'invoice' AND je.source_id = i.id AND je.status = 'posted'
               AND a.code IN ('4060','4070','4030') AND jl.credit > 0)
        ORDER BY i.company_id, i.number`,
    params
  );

  const phantomVoidBalance = await queryRows(
    "phantomVoidBalance",
    `SELECT i.company_id, i.id AS invoice_id, i.number, i.currency, i.exchange_rate::text AS rate,
              (SUM(jl.debit) - SUM(jl.credit))::text AS ar_net
         FROM invoices i
         JOIN journal_entries je ON je.source_id = i.id AND je.company_id = i.company_id
                                AND je.source = 'invoice' AND je.status = 'posted'
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN accounts a ON a.id = jl.account_id AND a.code = '1040'
        WHERE i.status IN ('void','cancelled') ${scope}
        GROUP BY i.company_id, i.id, i.number, i.currency, i.exchange_rate
       HAVING SUM(jl.debit) - SUM(jl.credit) <> 0
        ORDER BY i.company_id, i.number`,
    params
  );

  const creditNotesOn4010 = await queryRows(
    "creditNotesOn4010",
    `SELECT cn.company_id, cn.id AS credit_note_id, cn.number, o.number AS invoice_number
         FROM invoices cn JOIN invoices o ON o.id = cn.original_invoice_id
        WHERE cn.invoice_type = 'credit_note' ${scope.replace("i.company_id", "cn.company_id")}
          AND EXISTS (SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                        JOIN accounts a ON a.id = jl.account_id
                       WHERE je.source_id = cn.id AND je.status = 'posted' AND a.code = '4010' AND jl.debit > 0)
          AND EXISTS (SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                        JOIN accounts a ON a.id = jl.account_id
                       WHERE je.source_id = o.id AND je.source = 'invoice' AND je.status = 'posted'
                         AND a.code IN ('4060','4070','4030') AND jl.credit > 0)
          AND NOT EXISTS (SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                        JOIN accounts a ON a.id = jl.account_id
                       WHERE je.source_id = cn.id AND je.status = 'posted'
                         AND a.code IN ('4060','4070','4030') AND jl.debit > 0)
        ORDER BY cn.company_id, cn.number`,
    params
  );

  const negativeReceivable = await queryRows(
    "negativeReceivable",
    `SELECT i.company_id, i.id AS invoice_id, i.number, i.total::text AS total,
              COALESCE((SELECT SUM(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)::text AS paid,
              COALESCE((SELECT SUM(-c.total) FROM invoices c WHERE c.original_invoice_id = i.id
                          AND c.invoice_type = 'credit_note' AND c.status NOT IN ('void','cancelled','draft')), 0)::text AS credited
         FROM invoices i
        WHERE i.invoice_type = 'invoice' ${scope}
          AND i.total < COALESCE((SELECT SUM(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)
                      + COALESCE((SELECT SUM(-c.total) FROM invoices c WHERE c.original_invoice_id = i.id
                          AND c.invoice_type = 'credit_note' AND c.status NOT IN ('void','cancelled','draft')), 0)
          AND NOT EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.invoice_id = i.id)
        ORDER BY i.company_id, i.number`,
    params
  );

  await client.query("ROLLBACK");

  const report = {
    ambiguousZeroRated,
    zeroRatedOn4010,
    phantomVoidBalance,
    creditNotesOn4010,
    negativeReceivable,
  };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const [name, rows] of Object.entries(report)) {
      console.log(`\n== ${name}: ${rows.length}`);
      for (const r of rows.slice(0, 200)) console.log("  " + JSON.stringify(r));
      if (rows.length > 200) console.log(`  ... ${rows.length - 200} more (use --json)`);
    }
    console.log(
      "\nNothing was changed. Correct ambiguous lines with a credit note + reissue; never edit posted rows."
    );
  }
} catch (error) {
  console.error(`Sales ledger drift: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

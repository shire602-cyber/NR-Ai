-- SUPERSEDED by migrations/0127_settlement_open_balance_indexes.sql (owner-approved exception,
-- PR #68). Optional only: an operator may pre-build the same indexes CONCURRENTLY before the deploy,
-- after which 0127's IF NOT EXISTS is a no-op. Lives in docs/, so the migrator never runs it.
--
-- The settlement rule (server/reporting/settlement.ts, receivableSettlementPartsSql "credited")
-- runs, for every invoice it reads, correlated subqueries on
--   invoices.original_invoice_id   (credit notes / debit notes raised against an invoice)
--   credit_notes.invoice_id        (legacy credit notes)
-- Neither column is indexed, so each open-balance read scans the whole table once per invoice.
--
-- Run in the release phase, AFTER `npm run db:migrate`, with psql in autocommit mode:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/release/proposed-migrations/settlement-open-balance-indexes.sql
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and drizzle-kit migrate wraps
-- every pending file in one transaction, so these statements cannot be a Drizzle migration as
-- written. If the owner prefers a migration instead, drop CONCURRENTLY (the build then takes a
-- SHARE lock that blocks writes to the table while it runs: 127 ms for both at 80,000 invoices
-- in the rehearsal) and give it the next migration number per the repo's migration rules.
--
-- Idempotent: IF NOT EXISTS. If a CONCURRENTLY build is interrupted it leaves an INVALID index;
-- check with the query at the end, DROP INDEX CONCURRENTLY the invalid one and run this again.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_original_invoice_id
  ON invoices (original_invoice_id)
  WHERE original_invoice_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_invoice_id
  ON credit_notes (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Verify: both rows must show indisvalid = true.
SELECT indexrelid::regclass AS index, indisvalid
  FROM pg_index
 WHERE indexrelid::regclass::text IN ('idx_invoices_original_invoice_id', 'idx_credit_notes_invoice_id');

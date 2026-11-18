-- 0127_settlement_open_balance_indexes (owner exception, W2-B reporting / settlement rule): indexes the two
-- columns the settlement rule's "credited" subqueries filter on. Idempotent: CREATE INDEX IF NOT EXISTS only.
--
-- Owner decision (PR #68, approved by the owner): an explicit exception to the frozen-migration rule
-- in AGENTS.md ("never add new numbers"), recorded in docs/release/MIGRATION-REHEARSAL.md.
--
-- server/reporting/settlement.ts (receivableSettlementPartsSql "credited") runs, for every invoice it
-- reads, a correlated subquery on invoices.original_invoice_id (credit/debit notes raised against the
-- invoice) and on credit_notes.invoice_id (legacy credit notes). Neither column was indexed, so open
-- balances were quadratic in a company's invoice count: about 35 s for one company with 10,000
-- invoices, 0.45 s with both indexes (docs/release/proposed-migrations/settlement-open-balance-indexes.md).
--
-- Not CONCURRENTLY: drizzle-kit migrate applies pending files inside one transaction, where
-- CREATE INDEX CONCURRENTLY is not allowed. A plain build takes a SHARE lock on each table (writes
-- wait, reads continue) for the build only: 127 ms for both at 80,000 invoices in the rehearsal.
-- Partial indexes: only rows that reference another document are indexed.
CREATE INDEX IF NOT EXISTS "idx_invoices_original_invoice_id"
  ON "invoices" ("original_invoice_id")
  WHERE "original_invoice_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_credit_notes_invoice_id"
  ON "credit_notes" ("invoice_id")
  WHERE "invoice_id" IS NOT NULL;

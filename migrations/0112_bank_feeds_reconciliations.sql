-- 0112_bank_feeds_reconciliations: Lean bank feeds and completed reconciliation sessions. Additive and idempotent.
--
-- bank_provider_customers maps a company to its customer id at the provider (one per company and provider).
-- bank_connections gains the encrypted provider entity id, a sync lease, a failure counter and the environment.
-- bank_reconciliations is one completed (or reopened) statement-vs-ledger session per bank account and date;
-- cleared bank_transactions carry its id and are frozen until the session is reopened.

CREATE TABLE IF NOT EXISTS "bank_provider_customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "external_customer_id" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_bank_provider_customer" UNIQUE ("company_id", "provider")
);

ALTER TABLE "bank_connections"
  ADD COLUMN IF NOT EXISTS "provider_entity_id" text,
  ADD COLUMN IF NOT EXISTS "sync_lease_until" timestamp,
  ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "environment" text;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_connection_external"
    ON "bank_connections"("company_id", "provider", "external_account_id")
    WHERE "status" <> 'disconnected' AND "external_account_id" IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE '0112: duplicate active bank connections exist; uq_bank_connection_external not created';
END $$;

ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "reconcile_from" date;

CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
  "statement_date" date NOT NULL,
  "statement_balance" numeric(15,2) NOT NULL,
  "ledger_balance" numeric(15,2) NOT NULL,
  "status" text NOT NULL DEFAULT 'completed' CHECK ("status" IN ('completed', 'reopened')),
  "snapshot" jsonb,
  "completed_by" uuid,
  "completed_at" timestamp DEFAULT now(),
  "reopened_by" uuid,
  "reopened_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_reconciliation_completed"
  ON "bank_reconciliations"("bank_account_id", "statement_date") WHERE "status" = 'completed';
CREATE INDEX IF NOT EXISTS "idx_bank_reconciliations_company" ON "bank_reconciliations"("company_id", "bank_account_id");

DO $$ BEGIN
  ALTER TABLE "bank_transactions"
    ADD CONSTRAINT "bank_transactions_reconciliation_fk" FOREIGN KEY ("reconciliation_id")
    REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One bank line can settle several ledger entries (a receipt that pays three invoices posts three payment entries).
-- bank_transactions.matched_journal_entry_id holds the first; the others are listed here. Both count as matched.
CREATE TABLE IF NOT EXISTS "bank_transaction_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_transaction_id" uuid NOT NULL REFERENCES "bank_transactions"("id") ON DELETE CASCADE,
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_bank_transaction_entry" UNIQUE ("bank_transaction_id", "journal_entry_id")
);
CREATE INDEX IF NOT EXISTS "idx_bank_txn_entries_entry" ON "bank_transaction_entries"("journal_entry_id");

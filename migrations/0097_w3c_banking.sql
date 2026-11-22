-- 0097_w3c_banking (W3-C): banking integrity. Idempotent.
--  * bank_accounts: opening balance (continuity check), updated_at (R06-01, R06-22)
--  * bank_transactions: GL link backfilled from the managed bank account (R06-01), exclude /
--    soft-delete / import batch / external id columns (R06-19, R06-22), one match-state rule
--    enforced by a trigger plus a data repair (R06-18)
--  * bank_transaction_matches: one row per allocation of a bank line (split matching, R06-21);
--    the single record unmatch reverses (R06-02)
--  * bank_import_batches: import history with undo (R06-22)
--  * bank_reconciliations: statement vs GL snapshot with sign-off (R06-20)
--  * bank_feed_oauth_states: adapter authorization state, verified on callback (R06-14)
--  * reconciliation_rules: GL account, VAT treatment, review flag; match_type fixed (R06-04, R06-15)

-- ── bank_accounts ─────────────────────────────────────────────────────────────
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "opening_balance" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "opening_balance_date" date;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint

-- ── bank_transactions: new columns ────────────────────────────────────────────
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "matched_type" text;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "excluded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "excluded_by" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "exclude_reason" text;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_transactions_external_id"
  ON "bank_transactions" ("company_id", "bank_connection_id", "external_id")
  WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_statement_account"
  ON "bank_transactions" ("bank_statement_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_import_batch"
  ON "bank_transactions" ("import_batch_id") WHERE "import_batch_id" IS NOT NULL;
--> statement-breakpoint

-- ── R06-01: GL link comes from the managed bank account ───────────────────────
UPDATE "bank_transactions" bt
   SET "bank_account_id" = ba."gl_account_id"
  FROM "bank_accounts" ba
 WHERE bt."bank_statement_account_id" = ba."id"
   AND ba."gl_account_id" IS NOT NULL
   AND bt."bank_account_id" IS DISTINCT FROM ba."gl_account_id"
   AND (bt."bank_account_id" IS NULL OR bt."is_reconciled" = false);
--> statement-breakpoint

-- ── R06-18: data check. A row is reconciled exactly when match_status = matched. ─
UPDATE "bank_transactions" SET "match_status" = 'unmatched'
 WHERE "match_status" IS NULL OR "match_status" NOT IN ('unmatched', 'suggested', 'matched');
--> statement-breakpoint
-- R06-04: rows the old rule engine flagged reconciled with no entry, payment or link go back to
-- the worklist (the books never recorded them).
UPDATE "bank_transactions"
   SET "is_reconciled" = false, "match_status" = 'unmatched'
 WHERE "is_reconciled" = true
   AND "matched_journal_entry_id" IS NULL
   AND "matched_invoice_id" IS NULL
   AND "matched_receipt_id" IS NULL;
--> statement-breakpoint
UPDATE "bank_transactions" SET "match_status" = 'matched'
 WHERE "is_reconciled" = true AND "match_status" <> 'matched';
--> statement-breakpoint
UPDATE "bank_transactions" SET "match_status" = 'suggested'
 WHERE "is_reconciled" = false AND "match_status" = 'matched';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bank_transactions_match_state"() RETURNS trigger AS $$
BEGIN
  IF NEW."match_status" IS NULL OR NEW."match_status" NOT IN ('unmatched', 'suggested', 'matched') THEN
    NEW."match_status" := 'unmatched';
  END IF;
  IF NEW."is_reconciled" THEN
    NEW."match_status" := 'matched';
  ELSIF NEW."match_status" = 'matched' THEN
    NEW."match_status" := 'suggested';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_bank_transactions_match_state" ON "bank_transactions";
--> statement-breakpoint
CREATE TRIGGER "trg_bank_transactions_match_state"
  BEFORE INSERT OR UPDATE OF "is_reconciled", "match_status" ON "bank_transactions"
  FOR EACH ROW EXECUTE FUNCTION "bank_transactions_match_state"();
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_transactions_match_state') THEN
    ALTER TABLE "bank_transactions"
      ADD CONSTRAINT "chk_bank_transactions_match_state"
      CHECK ("is_reconciled" = ("match_status" = 'matched'));
  END IF;
END $$;
--> statement-breakpoint

-- ── bank_import_batches (R06-22) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bank_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_account_id" uuid REFERENCES "bank_accounts"("id") ON DELETE SET NULL,
  "source" text NOT NULL DEFAULT 'csv',
  "file_name" text,
  "file_fingerprint" text,
  "format" text,
  "row_count" integer NOT NULL DEFAULT 0,
  "imported_count" integer NOT NULL DEFAULT 0,
  "skipped_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "continuity_warning" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "undone_at" timestamp,
  "undone_by" uuid,
  "removed_count" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_import_batches_company" ON "bank_import_batches" ("company_id", "created_at");
--> statement-breakpoint

-- ── bank_transaction_matches (R06-02, R06-21) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "bank_transaction_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_transaction_id" uuid NOT NULL REFERENCES "bank_transactions"("id") ON DELETE CASCADE,
  "match_group_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "amount" numeric(15,2) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "payment_id" uuid,
  "account_id" uuid,
  "created_journal" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "idempotency_key" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "reversed_at" timestamp,
  "reversed_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_txn_matches_txn" ON "bank_transaction_matches" ("bank_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_txn_matches_group" ON "bank_transaction_matches" ("match_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_txn_matches_target" ON "bank_transaction_matches" ("company_id", "target_type", "target_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_txn_matches_idempotency"
  ON "bank_transaction_matches" ("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
-- Existing reconciled rows get the allocation unmatch needs (created entry vs linked document).
INSERT INTO "bank_transaction_matches"
  ("company_id", "bank_transaction_id", "match_group_id", "target_type", "target_id", "amount",
   "journal_entry_id", "payment_id", "created_journal", "status", "created_at")
SELECT bt."company_id", bt."id", gen_random_uuid(),
       CASE
         WHEN bt."matched_invoice_id" IS NOT NULL THEN 'invoice'
         WHEN bt."matched_receipt_id" IS NOT NULL THEN 'receipt'
         WHEN je."source" = 'bank_reconciliation' AND je."source_id" = bt."id" THEN 'entry'
         ELSE 'journal'
       END,
       COALESCE(bt."matched_invoice_id", bt."matched_receipt_id", bt."matched_journal_entry_id"),
       abs(bt."amount"),
       bt."matched_journal_entry_id",
       ip."id",
       COALESCE(je."source" = 'bank_reconciliation' AND je."source_id" = bt."id", false),
       'active',
       bt."created_at"
  FROM "bank_transactions" bt
  LEFT JOIN "journal_entries" je ON je."id" = bt."matched_journal_entry_id"
  LEFT JOIN LATERAL (
    SELECT p."id" FROM "invoice_payments" p
     WHERE p."journal_entry_id" = bt."matched_journal_entry_id"
       AND bt."matched_invoice_id" IS NOT NULL
     LIMIT 1
  ) ip ON true
 WHERE bt."is_reconciled" = true
   AND NOT EXISTS (
     SELECT 1 FROM "bank_transaction_matches" m WHERE m."bank_transaction_id" = bt."id"
   );
--> statement-breakpoint
UPDATE "bank_transactions" bt
   SET "matched_type" = m."target_type"
  FROM "bank_transaction_matches" m
 WHERE m."bank_transaction_id" = bt."id" AND m."status" = 'active' AND bt."matched_type" IS NULL;
--> statement-breakpoint

-- ── bank_reconciliations (R06-20) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
  "period_start" date,
  "period_end" date NOT NULL,
  "statement_closing_balance" numeric(15,2) NOT NULL,
  "gl_balance" numeric(15,2) NOT NULL,
  "difference" numeric(15,2) NOT NULL,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "signed_off_by" uuid,
  "signed_off_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_reconciliations_account" ON "bank_reconciliations" ("company_id", "bank_account_id", "period_end");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_reconciliations_signed_period"
  ON "bank_reconciliations" ("bank_account_id", "period_end")
  WHERE "status" = 'signed_off';
--> statement-breakpoint

-- ── bank_feed_oauth_states (R06-14) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bank_feed_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "state_hash" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "bank_account_id" uuid,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_feed_oauth_state_hash" ON "bank_feed_oauth_states" ("state_hash");
--> statement-breakpoint

-- ── reconciliation_rules (R06-04, R06-15) ─────────────────────────────────────
ALTER TABLE "reconciliation_rules" ADD COLUMN IF NOT EXISTS "account_id" uuid;
--> statement-breakpoint
ALTER TABLE "reconciliation_rules" ADD COLUMN IF NOT EXISTS "vat_treatment" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "reconciliation_rules" ADD COLUMN IF NOT EXISTS "require_review" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "reconciliation_rules" ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'any';
--> statement-breakpoint
ALTER TABLE "reconciliation_rules" ADD COLUMN IF NOT EXISTS "created_by" uuid;
--> statement-breakpoint
UPDATE "reconciliation_rules" SET "match_type" = 'exact' WHERE "match_type" IN ('equals', 'equal', 'is');
--> statement-breakpoint
UPDATE "reconciliation_rules" SET "match_type" = 'contains', "is_active" = false
 WHERE "match_type" NOT IN ('exact', 'contains', 'starts_with', 'regex');
--> statement-breakpoint
-- A rule with no GL account cannot post: keep it but switch it off until an account is chosen.
UPDATE "reconciliation_rules" SET "is_active" = false WHERE "account_id" IS NULL AND "is_active" = true;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reconciliation_rules_match_type') THEN
    ALTER TABLE "reconciliation_rules"
      ADD CONSTRAINT "chk_reconciliation_rules_match_type"
      CHECK ("match_type" IN ('exact', 'contains', 'starts_with', 'regex'));
  END IF;
END $$;

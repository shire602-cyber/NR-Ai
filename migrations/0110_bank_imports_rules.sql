-- 0110_bank_imports_rules: statement imports, matching fields and split-line bank rules. Additive and idempotent.
--
-- bank_statement_imports keeps one row per uploaded statement (the file itself is a stored_files row, key in
-- stored_file_key). A PDF import is 'staged' with its parsed rows until a person commits it; every other source
-- is 'committed' on arrival. bank_transactions gains the dedupe/external keys, the bill link, the
-- reconciliation stamp and a suggested rule. reconciliation_rules gain split lines, VAT, direction, a bank
-- account and an amount range. receipts and bill_payments gain the links the posting rules need.

CREATE TABLE IF NOT EXISTS "bank_statement_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('csv','ofx','mt940','camt053','pdf','feed')),
  "status" text NOT NULL DEFAULT 'committed' CHECK ("status" IN ('staged','committed','discarded')),
  "stored_file_key" text,
  "filename" text,
  "parser" text,
  "currency" text,
  "statement_from" date,
  "statement_to" date,
  "opening_balance" numeric(15,2),
  "closing_balance" numeric(15,2),
  "row_count" integer,
  "imported_count" integer,
  "duplicate_count" integer,
  "staged_rows" jsonb,
  "warnings" jsonb NOT NULL DEFAULT '[]',
  "created_by" uuid,
  "created_at" timestamp DEFAULT now(),
  "committed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_bsi_company_account_to" ON "bank_statement_imports"("company_id", "bank_account_id", "statement_to");

ALTER TABLE "bank_transactions"
  ADD COLUMN IF NOT EXISTS "import_id" uuid REFERENCES "bank_statement_imports"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "external_id" text,
  ADD COLUMN IF NOT EXISTS "dedupe_key" text,
  ADD COLUMN IF NOT EXISTS "value_date" date,
  ADD COLUMN IF NOT EXISTS "matched_bill_id" uuid REFERENCES "vendor_bills"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "suggested_rule_id" uuid REFERENCES "reconciliation_rules"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reconciled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "reconciled_by" uuid,
  ADD COLUMN IF NOT EXISTS "reconciliation_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_txn_external"
  ON "bank_transactions"("bank_statement_account_id", "external_id") WHERE "external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_bank_txn_dedupe" ON "bank_transactions"("bank_statement_account_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "idx_bank_txn_matched_je" ON "bank_transactions"("matched_journal_entry_id");

-- The old rule auto-match set is_reconciled on a row without posting or linking anything. Those rows are open again.
DO $$
DECLARE reopened integer;
BEGIN
  UPDATE "bank_transactions" SET "is_reconciled" = false, "match_status" = 'unmatched'
   WHERE "is_reconciled" AND "matched_journal_entry_id" IS NULL AND "matched_invoice_id" IS NULL
     AND "matched_receipt_id" IS NULL AND "matched_bill_id" IS NULL;
  GET DIAGNOSTICS reopened = ROW_COUNT;
  RAISE NOTICE '0110: % silently reconciled bank transactions reopened', reopened;
END $$;

-- GL account id from the managed bank account where the row has none.
DO $$
DECLARE linked integer;
BEGIN
  UPDATE "bank_transactions" bt SET "bank_account_id" = ba."gl_account_id"
    FROM "bank_accounts" ba
   WHERE bt."bank_account_id" IS NULL AND bt."bank_statement_account_id" = ba."id" AND ba."gl_account_id" IS NOT NULL;
  GET DIAGNOSTICS linked = ROW_COUNT;
  RAISE NOTICE '0110: % bank transactions got their GL account from the bank account', linked;
END $$;

-- Dedupe key: Dubai calendar day + signed amount (the bank account is the other half of the key).
DO $$
DECLARE keyed integer;
BEGIN
  UPDATE "bank_transactions"
     SET "dedupe_key" = to_char(("transaction_date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD')
                        || '|' || to_char("amount", 'FM999999999990.00')
   WHERE "dedupe_key" IS NULL;
  GET DIAGNOSTICS keyed = ROW_COUNT;
  RAISE NOTICE '0110: % bank transactions got a dedupe key', keyed;
END $$;

UPDATE "bank_transactions" SET "reconciled_at" = "created_at" WHERE "is_reconciled" AND "reconciled_at" IS NULL;

ALTER TABLE "reconciliation_rules"
  ADD COLUMN IF NOT EXISTS "split_lines" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "vat_rate" numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS "bank_account_id" uuid REFERENCES "bank_accounts"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "amount_min" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "amount_max" numeric(15,2);

DO $$ BEGIN
  ALTER TABLE "reconciliation_rules"
    ADD CONSTRAINT "reconciliation_rules_direction_check" CHECK ("direction" IN ('any', 'inflow', 'outflow'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "bank_transaction_id" uuid REFERENCES "bank_transactions"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_receipts_bank_txn" ON "receipts"("bank_transaction_id") WHERE "bank_transaction_id" IS NOT NULL;

ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "payment_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;

-- Scanned PDF statements may be read by the OCR/AI provider (paid per call, capped at 10 pages). Off unless a company turns it on.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "bank_pdf_ai_fallback" boolean NOT NULL DEFAULT false;

-- 0094_tax_filing_evidence_opening_year_end
-- Phase 4: (4.1/4.2) tax filing records with an immutable snapshot, evidence
-- files and payments; (4.4) opening balances and financial-year close.
-- Fully idempotent: safe to re-run.

-- ── 4.1 / 4.2: one filing record per filed VAT or corporate tax return ─────────
CREATE TABLE IF NOT EXISTS "tax_filings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "return_id" uuid NOT NULL,
  "reference_number" text NOT NULL,
  "filed_at" date NOT NULL,
  "notes" text,
  "snapshot" jsonb NOT NULL,
  "snapshot_hash" text NOT NULL,
  "base_filing_id" uuid,
  "settlement_output" numeric(15,2) NOT NULL DEFAULT 0,
  "settlement_input" numeric(15,2) NOT NULL DEFAULT 0,
  "settlement_net" numeric(15,2) NOT NULL DEFAULT 0,
  "clearing_entry_id" uuid,
  "filed_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tax_filings_kind_return" ON "tax_filings" ("kind", "return_id");
CREATE INDEX IF NOT EXISTS "idx_tax_filings_company" ON "tax_filings" ("company_id");

CREATE TABLE IF NOT EXISTS "tax_filing_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "filing_id" uuid NOT NULL REFERENCES "tax_filings"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  -- FTA retention (5 years): a "removed" file stays in storage, hidden.
  "removed_at" timestamp,
  "removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_reason" text
);
CREATE INDEX IF NOT EXISTS "idx_tax_filing_evidence_filing" ON "tax_filing_evidence" ("filing_id");

CREATE TABLE IF NOT EXISTS "tax_filing_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "filing_id" uuid NOT NULL REFERENCES "tax_filings"("id") ON DELETE CASCADE,
  "amount" numeric(15,2) NOT NULL,
  "paid_at" date NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "reference" text,
  "journal_entry_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_tax_filing_payments_filing" ON "tax_filing_payments" ("filing_id");

-- Amendments (voluntary disclosure) are new return rows linked to the original.
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "amends_return_id" uuid;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "is_amendment" boolean NOT NULL DEFAULT false;
ALTER TABLE "corporate_tax_returns" ADD COLUMN IF NOT EXISTS "amends_return_id" uuid;
ALTER TABLE "corporate_tax_returns" ADD COLUMN IF NOT EXISTS "is_amendment" boolean NOT NULL DEFAULT false;

-- The figures frozen at filing time can never be rewritten, even by a bug or a
-- hand-run UPDATE: the snapshot and its hash are immutable once inserted.
CREATE OR REPLACE FUNCTION tax_filings_snapshot_immutable() RETURNS trigger AS $fn$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.return_id IS DISTINCT FROM OLD.return_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'tax_filings snapshot is immutable' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_filings_snapshot_immutable_trg ON "tax_filings";
CREATE TRIGGER tax_filings_snapshot_immutable_trg
  BEFORE UPDATE ON "tax_filings"
  FOR EACH ROW EXECUTE FUNCTION tax_filings_snapshot_immutable();

-- ── 4.4: opening balances ──────────────────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "is_opening_balance" boolean NOT NULL DEFAULT false;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "is_opening_balance" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "opening_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "as_of_date" date NOT NULL,
  "journal_entry_id" uuid,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reversed_at" timestamp,
  "reversal_reason" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_opening_balances_active"
  ON "opening_balances" ("company_id") WHERE "status" = 'active';

-- ── 4.4: financial-year close ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "year_end_closes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "year_start" date NOT NULL,
  "year_end" date NOT NULL,
  "closing_entry_id" uuid,
  "status" text NOT NULL DEFAULT 'closed',
  "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_at" timestamp NOT NULL DEFAULT now(),
  "reopened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reopened_at" timestamp,
  "reopen_reason" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_year_end_closes_active"
  ON "year_end_closes" ("company_id", "year_end") WHERE "status" = 'closed';

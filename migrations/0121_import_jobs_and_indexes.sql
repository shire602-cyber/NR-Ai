-- 0121 (D5): migration-wizard jobs and the indexes the v1 cursors and the ledger balance query read through.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" text NOT NULL,
  "entity" text NOT NULL,
  "status" text NOT NULL DEFAULT 'uploaded',
  "stored_file_id" uuid,
  "filename" text,
  "mapping" jsonb,
  "options" jsonb,
  "row_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "result" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "committed_at" timestamp
);

DO $$
BEGIN
  ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_source_check"
    CHECK ("source" IN ('zoho', 'quickbooks', 'xero', 'generic'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_entity_check"
    CHECK ("entity" IN ('contacts', 'items', 'accounts', 'opening_tb', 'open_invoices', 'open_bills'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_check"
    CHECK ("status" IN ('uploaded', 'mapped', 'validated', 'committing', 'committed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_import_jobs_company_created" ON "import_jobs" ("company_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "import_job_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "raw" jsonb,
  "normalized" jsonb,
  "errors" jsonb,
  "action" text NOT NULL DEFAULT 'create',
  "created_entity_id" uuid
);

DO $$
BEGIN
  ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_action_check"
    CHECK ("action" IN ('create', 'skip_duplicate', 'error'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_import_job_rows_job_row" ON "import_job_rows" ("job_id", "row_number");

-- The ledger balance query groups by account over the entries of a company.
CREATE INDEX IF NOT EXISTS "idx_journal_lines_account_entry" ON "journal_lines" ("account_id", "entry_id");

-- v1 keyset cursors page by (company_id, created_at DESC, id).
UPDATE "vendor_bills" SET "created_at" = COALESCE("bill_date", now()) WHERE "created_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_invoices_company_created_id" ON "invoices" ("company_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_customer_contacts_company_created_id" ON "customer_contacts" ("company_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_products_company_created_id" ON "products" ("company_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_created_id" ON "journal_entries" ("company_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_company_created_id" ON "vendor_bills" ("company_id", "created_at" DESC, "id" DESC);

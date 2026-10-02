-- 0120 (D5): company data export and the 30-day soft deletion lifecycle.
-- Reuses companies.deleted_at. Idempotent.

CREATE TABLE IF NOT EXISTS "company_data_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "stored_file_id" uuid REFERENCES "stored_files"("id") ON DELETE SET NULL,
  "sha256" text,
  "size_bytes" bigint,
  "manifest" jsonb,
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "expires_at" timestamp
);

DO $$
BEGIN
  ALTER TABLE "company_data_exports"
    ADD CONSTRAINT "company_data_exports_status_check"
    CHECK ("status" IN ('queued', 'running', 'ready', 'failed', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One live job per company.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_company_data_exports_live"
  ON "company_data_exports" ("company_id") WHERE "status" IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS "idx_company_data_exports_company"
  ON "company_data_exports" ("company_id", "created_at" DESC);

-- company_id carries no foreign key on purpose: the row must outlive the company it records the
-- erasure of (status "erased"), so it keeps the name for the audit trail.
CREATE TABLE IF NOT EXISTS "company_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "company_name" text,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "firm_confirmed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "purge_after" timestamp,
  "restored_at" timestamp,
  "purged_at" timestamp,
  "retention_expires_at" timestamp
);

DO $$
BEGIN
  ALTER TABLE "company_deletion_requests"
    ADD CONSTRAINT "company_deletion_requests_status_check"
    CHECK ("status" IN ('awaiting_firm', 'pending', 'restored', 'purged', 'erased', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- At most one open request per company.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_company_deletion_requests_open"
  ON "company_deletion_requests" ("company_id") WHERE "status" IN ('awaiting_firm', 'pending');
CREATE INDEX IF NOT EXISTS "idx_company_deletion_requests_due"
  ON "company_deletion_requests" ("status", "purge_after");

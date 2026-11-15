-- 0089_platform_foundation (owner: W1-A, council wave 1)
-- Idempotent: every statement is safe to re-run.

-- (a) AI usage metering --------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid,
  "task" text NOT NULL,
  "provider" text,
  "model" text,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_company_created"
  ON "ai_usage_events" ("company_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_usage_limits" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "monthly_token_cap" bigint,
  "monthly_cost_cap_usd" numeric(12,2),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- (b) receipts: supplier TRN + content fingerprint / file metadata --------
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "supplier_trn" text;
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "content_sha256" text;
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "file_mime" text;
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "file_size" integer;
CREATE INDEX IF NOT EXISTS "idx_receipts_company_content_sha256"
  ON "receipts" ("company_id", "content_sha256");

-- (c) onboarding tour dismissal -------------------------------------------
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "tour_dismissed_at" timestamp;

-- (d) R17-16: neutralise the test credential seeded by 0023/0028 ----------
-- 0051 already revoked it; this repeats the revocation so any environment
-- that replayed 0028 after 0051 (or skipped 0051) ends with an unusable,
-- non-bcrypt password value, no firm role, no admin flag and no memberships.
UPDATE "users"
SET "password_hash" = '$revoked$' || gen_random_uuid()::text,
    "firm_role" = NULL,
    "is_admin" = false
WHERE "email" IN ('test_firm_owner@nra.ae', 'nra.test.owner@testmail.com');

DELETE FROM "company_users"
WHERE "user_id" IN (
  SELECT "id" FROM "users"
  WHERE "email" IN ('test_firm_owner@nra.ae', 'nra.test.owner@testmail.com')
);

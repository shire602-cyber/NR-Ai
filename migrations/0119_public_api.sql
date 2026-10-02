-- 0119 (D5): public API v1 — key controls, idempotency, request log. Idempotent.

-- Pre-v1 keys never authenticated anything (issuance was disabled); revoke them
-- once, on the run that adds the new columns, never on a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'api_keys' AND column_name = 'revoked_at'
  ) THEN
    ALTER TABLE "api_keys" ADD COLUMN "revoked_at" timestamp;
    UPDATE "api_keys" SET "is_active" = false, "revoked_at" = now() WHERE "is_active" = true;
  END IF;
END $$;

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "revoked_by" uuid REFERENCES "users"("id");
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rate_limit_per_minute" integer NOT NULL DEFAULT 60;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rate_limit_per_day" integer NOT NULL DEFAULT 5000;

-- Keys are looked up by prefix, so a prefix must identify exactly one key.
UPDATE "api_keys" SET "key_prefix" = "key_prefix" || '_' || substr("id"::text, 1, 4)
 WHERE "id" IN (
   SELECT "id" FROM (
     SELECT "id", row_number() OVER (PARTITION BY "key_prefix" ORDER BY "created_at", "id") AS rn FROM "api_keys"
   ) t WHERE t.rn > 1
 );
CREATE UNIQUE INDEX IF NOT EXISTS "uq_api_keys_key_prefix" ON "api_keys" ("key_prefix");

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "idem_key" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'in_flight',
  "response_status" integer,
  "response_body" jsonb,
  "response_location" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);

DO $$
BEGIN
  ALTER TABLE "idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_status_check" CHECK ("status" IN ('in_flight', 'completed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_idempotency_keys_scope"
  ON "idempotency_keys" ("api_key_id", "idem_key", "method", "path");
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_expires" ON "idempotency_keys" ("expires_at");

CREATE TABLE IF NOT EXISTS "api_request_log" (
  "id" bigserial PRIMARY KEY,
  "api_key_id" uuid REFERENCES "api_keys"("id") ON DELETE SET NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status" integer NOT NULL,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "ip" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_api_request_log_key_created" ON "api_request_log" ("api_key_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_api_request_log_created" ON "api_request_log" ("created_at");

-- 0118 (D5): TOTP two-factor, recovery codes, real session rows, company "require 2FA".
-- Idempotent.

CREATE TABLE IF NOT EXISTS "user_totp" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "secret_enc" text NOT NULL,
  "enabled_at" timestamp,
  "last_used_step" bigint,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_recovery_codes_user_hash"
  ON "user_recovery_codes" ("user_id", "code_hash");

ALTER TABLE "refresh_sessions" ADD COLUMN IF NOT EXISTS "device_hash" text;
ALTER TABLE "refresh_sessions" ADD COLUMN IF NOT EXISTS "revoked_reason" text;
-- Two clients refreshing at once both present the same token: the one just rotated away stays
-- acceptable for 60 s (previous_token_hash + rotated_at) instead of being treated as theft.
ALTER TABLE "refresh_sessions" ADD COLUMN IF NOT EXISTS "previous_token_hash" text;
ALTER TABLE "refresh_sessions" ADD COLUMN IF NOT EXISTS "alt_token_hashes" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "refresh_sessions" ADD COLUMN IF NOT EXISTS "rotated_at" timestamp;

CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_user_device"
  ON "refresh_sessions" ("user_id", "device_hash");

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "require_two_factor" boolean NOT NULL DEFAULT false;

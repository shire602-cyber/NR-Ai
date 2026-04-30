-- The password_reset_tokens table is created in 0040_auth_session_security.sql.
-- This migration adds the used_at column so a redeemed token cannot be replayed,
-- and an extra index on token_hash for fast lookup by hashed value.

ALTER TABLE "password_reset_tokens"
  ADD COLUMN IF NOT EXISTS "used_at" timestamp;

CREATE INDEX IF NOT EXISTS "idx_password_reset_token_hash"
  ON "password_reset_tokens" ("token_hash");

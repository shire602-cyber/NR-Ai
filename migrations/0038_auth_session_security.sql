-- Auth & session hardening
-- Adds:
--  * token_blacklist            — invalidated JWTs (logout)
--  * password_reset_tokens      — one-time reset links
--  * email_verification_tokens  — sign-up email confirmation
--  * users.email_verified       — flag for unverified accounts

CREATE TABLE IF NOT EXISTS "token_blacklist" (
  "token_hash" text PRIMARY KEY,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_token_blacklist_expires_at"
  ON "token_blacklist" ("expires_at");

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_user_id"
  ON "password_reset_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_expires_at"
  ON "password_reset_tokens" ("expires_at");

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_verification_tokens_user_id"
  ON "email_verification_tokens" ("user_id");

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;

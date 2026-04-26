-- Password reset tokens — issued by /auth/forgot-password and consumed by
-- /auth/reset-password. token_hash stores SHA-256 of the raw token; the raw
-- token only ever exists in the email link. used_at is set on redemption so
-- a captured token cannot be replayed.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_password_reset_token_hash" ON "password_reset_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_password_reset_user_id" ON "password_reset_tokens" ("user_id");

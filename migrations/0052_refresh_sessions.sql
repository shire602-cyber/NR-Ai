-- Rotating refresh-token sessions for cookie-based browser auth.
-- Raw refresh tokens are stored only in httpOnly cookies; the database stores
-- SHA-256 token hashes for rotation, revocation, and reuse detection.

CREATE TABLE IF NOT EXISTS "refresh_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "replaced_by_token_hash" text,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "reuse_detected_at" timestamp,
  "last_used_at" timestamp,
  "user_agent" text,
  "ip_address" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_token_hash"
  ON "refresh_sessions" ("token_hash");

CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_user_id"
  ON "refresh_sessions" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_expires_at"
  ON "refresh_sessions" ("expires_at");

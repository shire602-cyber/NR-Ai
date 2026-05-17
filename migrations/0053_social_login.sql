CREATE TABLE IF NOT EXISTS "auth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "issuer" text NOT NULL,
  "provider_subject" text NOT NULL,
  "provider_email" text NOT NULL,
  "provider_email_verified" boolean NOT NULL DEFAULT false,
  "profile" jsonb,
  "linked_at" timestamp DEFAULT now() NOT NULL,
  "last_login_at" timestamp,
  CONSTRAINT "auth_identities_provider_subject_unique" UNIQUE ("provider", "issuer", "provider_subject")
);

CREATE INDEX IF NOT EXISTS "idx_auth_identities_user_provider"
  ON "auth_identities" ("user_id", "provider");

CREATE INDEX IF NOT EXISTS "idx_auth_identities_provider_email"
  ON "auth_identities" ("provider_email");

CREATE TABLE IF NOT EXISTS "oauth_login_states" (
  "state_hash" text PRIMARY KEY,
  "provider" text NOT NULL,
  "encrypted_code_verifier" text NOT NULL,
  "encrypted_nonce" text NOT NULL,
  "nonce_hash" text NOT NULL,
  "next_path" text NOT NULL DEFAULT '/dashboard',
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_oauth_login_states_provider"
  ON "oauth_login_states" ("provider");

CREATE INDEX IF NOT EXISTS "idx_oauth_login_states_expires_at"
  ON "oauth_login_states" ("expires_at");

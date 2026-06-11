-- Bank connections + source link on imported transactions. Idempotent.
CREATE TABLE IF NOT EXISTS "bank_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'manual',
  "connection_type" text NOT NULL DEFAULT 'statement',
  "bank_name" text,
  "account_name" text,
  "bank_account_id" uuid,
  "external_account_id" text,
  "account_number_last4" text,
  "iban" text,
  "consent_id" text,
  "auto_sync" boolean NOT NULL DEFAULT false,
  "last_error" text,
  "access_token" text,
  "refresh_token" text,
  "token_expires_at" timestamp,
  "status" text NOT NULL DEFAULT 'active',
  "last_synced_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_bank_connections_company_id" ON "bank_connections" ("company_id");

ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "bank_connection_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_connection_id" ON "bank_transactions" ("bank_connection_id");

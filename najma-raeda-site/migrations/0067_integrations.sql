-- API keys, webhooks, push, notification preferences, Stripe event ledger.
-- Idempotent.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "scopes" text NOT NULL DEFAULT 'read',
  "is_active" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_api_keys_company_id" ON "api_keys" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_api_keys_key_hash" ON "api_keys" ("key_hash");

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "failure_count" integer NOT NULL DEFAULT 0,
  "last_triggered_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_webhook_endpoints_company_id" ON "webhook_endpoints" ("company_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "payload" text,
  "response_status" integer,
  "response_body" text,
  "success" boolean NOT NULL DEFAULT false,
  "attempt_number" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_endpoint" ON "webhook_deliveries" ("webhook_endpoint_id");

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh_key" text NOT NULL,
  "auth_key" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_id" ON "push_subscriptions" ("user_id");

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "push_enabled" boolean NOT NULL DEFAULT true,
  "email_enabled" boolean NOT NULL DEFAULT true,
  "invoice_reminders" boolean NOT NULL DEFAULT true,
  "payment_received" boolean NOT NULL DEFAULT true,
  "vat_deadlines" boolean NOT NULL DEFAULT true,
  "weekly_digest" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "processed_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_cycle" text NOT NULL DEFAULT 'monthly';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "max_companies" integer;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "invoices_created_this_month" integer NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "receipts_created_this_month" integer NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ai_credits_used_this_month" integer NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "max_storage_mb" integer;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ai_credits_per_month" integer;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "usage_period_start" timestamp;

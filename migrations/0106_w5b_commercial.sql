-- 0106_w5b_commercial (W5-B): commercial plumbing made real. Idempotent.
--  * api_keys: per-key rate limit, expiry, revocation, indexed prefix + unique hash (R19-01, R19-15)
--  * webhook_deliveries: durable queue with HMAC signature, retry/backoff, dead letter (R19-02)
--  * usage_counters: monthly usage meter per company (R19-04, R19-16)
--  * billing_credits / billing_documents: referral credits ledger, VAT-inclusive subscription
--    invoices and receipts; subscriptions gain trial, seats and dunning state (R19-11, R19-16)
--  * ecommerce_integrations / ecommerce_transactions: verified connection state and idempotent
--    import by external id (R19-03, R19-14)
--  * backups: encrypted snapshots, per-table counts, restore mode; backup_schedules (R19-06,
--    R19-07, R17-08, R17-22, R19-17)
--  * import_jobs: preview -> validate -> commit migration import jobs (R19-13, R02-16b)

-- ── api keys ──────────────────────────────────────────────────────────────────
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rate_limit_per_minute" integer NOT NULL DEFAULT 120;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_key_prefix" ON "api_keys" ("key_prefix");
--> statement-breakpoint

-- ── webhook delivery queue ────────────────────────────────────────────────────
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "event_id" text;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'delivered';
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 6;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "signature" text;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
--> statement-breakpoint
-- Rows written before the queue existed were single attempts: failed ones are terminal.
UPDATE "webhook_deliveries" SET "status" = 'dead' WHERE "success" = false AND "status" = 'delivered' AND "event_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_due" ON "webhook_deliveries" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_webhook_deliveries_endpoint_event" ON "webhook_deliveries" ("webhook_endpoint_id", "event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint

-- ── usage meter ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "usage_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period" text NOT NULL,
  "metric" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_counters_company_period_metric" ON "usage_counters" ("company_id", "period", "metric");
--> statement-breakpoint

-- ── subscriptions: trial, seats, dunning ──────────────────────────────────────
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "seat_count" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "dunning_stage" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_payment_failed_at" timestamp;
--> statement-breakpoint

-- ── billing credits (referral rewards) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "billing_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "referral_id" uuid REFERENCES "referrals"("id") ON DELETE SET NULL,
  "beneficiary" text NOT NULL DEFAULT 'referee',
  "source" text NOT NULL DEFAULT 'referral',
  "kind" text NOT NULL DEFAULT 'credit',
  "amount_fils" bigint NOT NULL DEFAULT 0,
  "percent_off" numeric(5, 2),
  "currency" text NOT NULL DEFAULT 'AED',
  "status" text NOT NULL DEFAULT 'ledgered',
  "stripe_ref" text,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "applied_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_credits_referral_beneficiary" ON "billing_credits" ("referral_id", "beneficiary") WHERE "referral_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_credits_company" ON "billing_credits" ("company_id");
--> statement-breakpoint

-- ── subscription invoices / receipts (VAT inclusive) ──────────────────────────
CREATE TABLE IF NOT EXISTS "billing_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'invoice',
  "number" text NOT NULL,
  "stripe_invoice_id" text,
  "plan_id" text,
  "billing_cycle" text,
  "seat_count" integer NOT NULL DEFAULT 1,
  "period_start" timestamp,
  "period_end" timestamp,
  "subtotal_fils" bigint NOT NULL DEFAULT 0,
  "vat_fils" bigint NOT NULL DEFAULT 0,
  "discount_fils" bigint NOT NULL DEFAULT 0,
  "total_fils" bigint NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'AED',
  "status" text NOT NULL DEFAULT 'issued',
  "issued_at" timestamp NOT NULL DEFAULT now(),
  "paid_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_documents_stripe_kind" ON "billing_documents" ("stripe_invoice_id", "kind") WHERE "stripe_invoice_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_documents_number" ON "billing_documents" ("number");
--> statement-breakpoint

-- ── e-commerce ────────────────────────────────────────────────────────────────
ALTER TABLE "ecommerce_integrations" ADD COLUMN IF NOT EXISTS "connection_status" text NOT NULL DEFAULT 'not_connected';
--> statement-breakpoint
ALTER TABLE "ecommerce_integrations" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ecommerce_integrations" ADD COLUMN IF NOT EXISTS "external_account_name" text;
--> statement-breakpoint
-- Connections created before verification existed were never verified.
UPDATE "ecommerce_integrations" SET "is_active" = false, "sync_status" = 'never' WHERE "verified_at" IS NULL AND "connection_status" = 'not_connected';
--> statement-breakpoint
ALTER TABLE "ecommerce_transactions" ADD COLUMN IF NOT EXISTS "bank_transaction_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ecommerce_transactions_integration_external" ON "ecommerce_transactions" ("integration_id", "external_id");
--> statement-breakpoint

-- ── backups ───────────────────────────────────────────────────────────────────
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "encrypted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "format_version" text NOT NULL DEFAULT '1.0';
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "table_counts" text;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "last_restore_mode" text;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "last_restored_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "frequency" text NOT NULL DEFAULT 'weekly',
  "retention_days" integer NOT NULL DEFAULT 90,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_backup_schedules_company" ON "backup_schedules" ("company_id");
--> statement-breakpoint

-- ── migration import jobs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "source_system" text NOT NULL DEFAULT 'generic',
  "status" text NOT NULL DEFAULT 'previewed',
  "file_name" text,
  "cut_over_date" date,
  "ar_ap_mode" text,
  "rows" text NOT NULL DEFAULT '[]',
  "issues" text NOT NULL DEFAULT '[]',
  "summary" text NOT NULL DEFAULT '{}',
  "result" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "validated_at" timestamp,
  "committed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_import_jobs_company" ON "import_jobs" ("company_id", "kind");

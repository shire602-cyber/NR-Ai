-- 0105_online_payments (Phase 8 D1): online invoice payment through a provider interface (Stripe Connect Standard,
-- one connected account per company, direct charges, no platform fee). Additive and idempotent.
--
-- The money path: a checkout session -> a webhook -> storage.recordInvoicePayment into account 1025 Payment Gateway
-- Clearing (method 'gateway', reference = the provider's payment id) -> a separate gateway_fee journal. Idempotency in
-- three layers: stripe_events (event id), the gateway_payments state machine (provider payment id), and the unique
-- gateway reference on invoice_payments below.

CREATE TABLE IF NOT EXISTS "payment_gateway_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'stripe',
  "external_account_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "livemode" boolean NOT NULL DEFAULT false,
  "state_hash" text,
  "allow_partial" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT true,
  "connected_by" uuid REFERENCES "users"("id"),
  "connected_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "payment_gateway_connections_status_check" CHECK ("status" IN ('pending','active','revoked')),
  CONSTRAINT "payment_gateway_connections_company_provider_unique" UNIQUE ("company_id", "provider")
);
-- A connected account belongs to one company at a time (a webhook for acct_x is routed by it).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_gateway_connections_account"
  ON "payment_gateway_connections"("provider", "external_account_id") WHERE "external_account_id" IS NOT NULL AND "status" = 'active';

CREATE TABLE IF NOT EXISTS "payment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'stripe',
  "provider_session_id" text NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "currency" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "url" text,
  "created_via" text NOT NULL DEFAULT 'public',
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "payment_links_status_check" CHECK ("status" IN ('open','completed','expired')),
  CONSTRAINT "payment_links_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "payment_links_session_unique" UNIQUE ("provider_session_id")
);
CREATE INDEX IF NOT EXISTS "idx_payment_links_invoice" ON "payment_links"("invoice_id", "status");
CREATE INDEX IF NOT EXISTS "idx_payment_links_company" ON "payment_links"("company_id");

CREATE TABLE IF NOT EXISTS "gateway_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "payment_link_id" uuid REFERENCES "payment_links"("id") ON DELETE SET NULL,
  "provider" text NOT NULL DEFAULT 'stripe',
  "provider_payment_id" text NOT NULL,
  "provider_charge_id" text,
  "amount" numeric(15,2) NOT NULL,
  "currency" text NOT NULL,
  "exchange_rate" numeric(15,6) NOT NULL DEFAULT 1,
  "fee_aed" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'received',
  "invoice_payment_id" uuid REFERENCES "invoice_payments"("id") ON DELETE SET NULL,
  "fee_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "refunded_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "gateway_payments_status_check" CHECK ("status" IN ('received','payment_posted','settled','unallocated')),
  CONSTRAINT "gateway_payments_provider_payment_unique" UNIQUE ("provider", "provider_payment_id")
);
CREATE INDEX IF NOT EXISTS "idx_gateway_payments_company" ON "gateway_payments"("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_gateway_payments_invoice" ON "gateway_payments"("invoice_id");

CREATE TABLE IF NOT EXISTS "gateway_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "gateway_payment_id" uuid NOT NULL REFERENCES "gateway_payments"("id") ON DELETE RESTRICT,
  "provider" text NOT NULL DEFAULT 'stripe',
  "provider_refund_id" text NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "credit_note_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "customer_refund_id" uuid REFERENCES "customer_refunds"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'received',
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "gateway_refunds_status_check" CHECK ("status" IN ('received','credit_note_posted','settled','unallocated')),
  CONSTRAINT "gateway_refunds_provider_refund_unique" UNIQUE ("provider", "provider_refund_id")
);
CREATE INDEX IF NOT EXISTS "idx_gateway_refunds_payment" ON "gateway_refunds"("gateway_payment_id");

-- One payment row per provider payment id: a crashed settlement that is retried finds the row instead of paying twice.
-- 'gateway' is a new method value, so no existing row collides.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_payments_gateway_ref"
  ON "invoice_payments"("company_id", "reference") WHERE "method" = 'gateway';

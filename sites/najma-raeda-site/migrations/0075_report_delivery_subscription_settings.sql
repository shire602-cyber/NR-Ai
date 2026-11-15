CREATE TABLE IF NOT EXISTS "company_report_delivery_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "subscription_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "cadence_override" text,
  "channel_override" text,
  "format_override" text,
  "recipients_override" text,
  "delivery_guardrail_override" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_report_delivery_subscriptions_unique"
    UNIQUE ("company_id", "subscription_id")
);

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_subscriptions_company_id"
  ON "company_report_delivery_subscriptions" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_subscriptions_subscription_id"
  ON "company_report_delivery_subscriptions" ("subscription_id");

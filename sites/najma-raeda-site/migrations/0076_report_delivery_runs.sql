CREATE TABLE IF NOT EXISTS "company_report_delivery_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "subscription_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "readiness_status" text NOT NULL,
  "notification_id" uuid,
  "scheduled_for" timestamp NOT NULL,
  "queued_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "format" text NOT NULL,
  "recipients" text NOT NULL,
  "delivery_guardrail" text NOT NULL,
  "report_count" integer NOT NULL DEFAULT 0,
  "ready_report_count" integer NOT NULL DEFAULT 0,
  "trigger_rule_count" integer NOT NULL DEFAULT 0,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_runs_company_id"
  ON "company_report_delivery_runs" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_runs_subscription_id"
  ON "company_report_delivery_runs" ("subscription_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_runs_company_subscription"
  ON "company_report_delivery_runs" ("company_id", "subscription_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_runs_scheduled_for"
  ON "company_report_delivery_runs" ("scheduled_for");

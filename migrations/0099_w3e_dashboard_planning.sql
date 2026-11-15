-- 0099_w3e_dashboard_planning (W3-E): budgets v2, forecast scheduled items,
-- anomaly alert transaction facts, news ingestion keys. Idempotent.

-- ── Budget plans: versions, approval trail, dimensions, alerts ─────────────
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "parent_budget_id" uuid;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "class_tag" text;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "alert_threshold_pct" numeric(6,2) NOT NULL DEFAULT 10;
ALTER TABLE "budget_plans" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "is_contra" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_plans_dates_ck') THEN
    ALTER TABLE "budget_plans"
      ADD CONSTRAINT "budget_plans_dates_ck" CHECK ("end_date" >= "start_date") NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_budget_plans_company_year" ON "budget_plans" ("company_id", "fiscal_year");
CREATE INDEX IF NOT EXISTS "idx_budget_plans_parent" ON "budget_plans" ("parent_budget_id");
CREATE INDEX IF NOT EXISTS "idx_budget_lines_budget" ON "budget_lines" ("budget_id");

-- One alert per budget line and month key, so a scan never re-notifies.
CREATE TABLE IF NOT EXISTS "budget_variance_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "budget_id" uuid NOT NULL REFERENCES "budget_plans"("id") ON DELETE CASCADE,
  "line_id" uuid,
  "period" text NOT NULL,
  "budget_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "actual_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "variance_pct" numeric(10,2),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_budget_variance_alert"
  ON "budget_variance_alerts" ("budget_id", COALESCE("line_id", '00000000-0000-0000-0000-000000000000'::uuid), "period");

-- ── Cash forecast: manual scheduled items (loans, one-offs) ────────────────
CREATE TABLE IF NOT EXISTS "cash_forecast_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "due_date" date NOT NULL,
  "repeat_months" integer NOT NULL DEFAULT 0,
  "occurrences" integer NOT NULL DEFAULT 1,
  "bank_account_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cash_forecast_items_kind_ck"
    CHECK ("kind" IN ('loan_repayment', 'one_off_inflow', 'one_off_outflow')),
  CONSTRAINT "cash_forecast_items_amount_ck" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "idx_cash_forecast_items_company" ON "cash_forecast_items" ("company_id", "due_date");

-- ── Anomaly alerts: real transaction amount/date, rule and dedupe key ──────
ALTER TABLE "anomaly_alerts" ADD COLUMN IF NOT EXISTS "amount" numeric(15,2);
ALTER TABLE "anomaly_alerts" ADD COLUMN IF NOT EXISTS "transaction_date" date;
ALTER TABLE "anomaly_alerts" ADD COLUMN IF NOT EXISTS "rule" text;
ALTER TABLE "anomaly_alerts" ADD COLUMN IF NOT EXISTS "dedupe_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_anomaly_alerts_dedupe"
  ON "anomaly_alerts" ("company_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;

-- ── News: external id for idempotent ingestion; curation fields ────────────
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "external_id" text;
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "curated_by" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_news_items_source_external"
  ON "news_items" ("source", "external_id") WHERE "external_id" IS NOT NULL;

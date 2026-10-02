-- 0111_cashflow_scenarios: saved what-if settings for the cash-flow forecast. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "cashflow_forecast_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "receipt_delay_days" integer NOT NULL DEFAULT 0 CHECK ("receipt_delay_days" BETWEEN -60 AND 180),
  "payment_delay_days" integer NOT NULL DEFAULT 0 CHECK ("payment_delay_days" BETWEEN -60 AND 180),
  "collection_rate_pct" numeric(5,2) NOT NULL DEFAULT 100 CHECK ("collection_rate_pct" BETWEEN 0 AND 100),
  "include_recurring" boolean NOT NULL DEFAULT true,
  "include_payroll" boolean NOT NULL DEFAULT true,
  "payroll_pay_day" integer NOT NULL DEFAULT 28 CHECK ("payroll_pay_day" BETWEEN 1 AND 28),
  "adjustments" jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("adjustments") = 'array' AND jsonb_array_length("adjustments") <= 50),
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_cashflow_scenario_name" UNIQUE ("company_id", "name")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_cashflow_scenario_default" ON "cashflow_forecast_scenarios"("company_id") WHERE "is_default";
CREATE INDEX IF NOT EXISTS "idx_cashflow_scenarios_company" ON "cashflow_forecast_scenarios"("company_id");

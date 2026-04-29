-- Phase 3: VAT Return Autopilot
-- Adds per-company VAT autopilot configuration and a vat_return_periods table
-- that tracks each filing window through draft → ready → submitted → accepted.
-- A jsonb `adjustments` column carries an audit-trailed list of manual overrides
-- applied on top of the auto-calculated VAT 201 box totals.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "vat_auto_calculate" boolean NOT NULL DEFAULT true;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "vat_period_start_month" integer NOT NULL DEFAULT 1;

ALTER TABLE "companies"
  ADD CONSTRAINT "vat_period_start_month_range"
  CHECK ("vat_period_start_month" >= 1 AND "vat_period_start_month" <= 12);

CREATE TABLE IF NOT EXISTS "vat_return_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "due_date" timestamp NOT NULL,
  "frequency" text NOT NULL DEFAULT 'quarterly',
  "status" text NOT NULL DEFAULT 'draft',
  "output_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "input_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "net_vat_payable" numeric(15,2) NOT NULL DEFAULT 0,
  "calculated_at" timestamp,
  "adjustments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "vat_return_id" uuid REFERENCES "vat_returns"("id"),
  "submitted_at" timestamp,
  "submitted_by" uuid REFERENCES "users"("id"),
  "fta_reference_number" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vat_return_periods_company_period_unique"
    UNIQUE ("company_id", "period_start", "period_end"),
  CONSTRAINT "vat_return_periods_status_check"
    CHECK ("status" IN ('draft','ready','submitted','accepted')),
  CONSTRAINT "vat_return_periods_frequency_check"
    CHECK ("frequency" IN ('quarterly','monthly'))
);

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_company_id"
  ON "vat_return_periods" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_due_date"
  ON "vat_return_periods" ("due_date");

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_status"
  ON "vat_return_periods" ("status");

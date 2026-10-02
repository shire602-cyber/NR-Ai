-- 0114_report_schedules
-- Phase 8 D4: per-report scheduled email delivery (report_schedules) and its run log (report_schedule_runs).
-- Fully idempotent. Tenant column: company_id on both tables, every query filters it.
-- A separate run table (not company_report_delivery_runs): that table's subscription_id points at the
-- static persona packs and the existing UI resolves those ids.

CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "report_id" text NOT NULL,
  "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "format" text NOT NULL CHECK ("format" IN ('pdf','csv','xlsx')),
  "lang" text NOT NULL DEFAULT 'en' CHECK ("lang" IN ('en','ar')),
  "cadence" text NOT NULL CHECK ("cadence" IN ('daily','weekly','monthly')),
  "day_of_week" smallint CHECK ("day_of_week" BETWEEN 0 AND 6),
  "day_of_month" smallint CHECK ("day_of_month" BETWEEN 1 AND 28),
  "hour_dubai" smallint NOT NULL DEFAULT 7 CHECK ("hour_dubai" BETWEEN 0 AND 23),
  "recipient_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "next_run_at" timestamp NOT NULL,
  "last_run_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_report_schedules_company" ON "report_schedules"("company_id");
CREATE INDEX IF NOT EXISTS "idx_report_schedules_due" ON "report_schedules"("next_run_at") WHERE "enabled";

CREATE TABLE IF NOT EXISTS "report_schedule_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" uuid NOT NULL REFERENCES "report_schedules"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "slot_key" text NOT NULL,
  "trigger" text NOT NULL DEFAULT 'schedule' CHECK ("trigger" IN ('schedule','manual')),
  "status" text NOT NULL CHECK ("status" IN ('running','sent','skipped','failed')),
  "reason" text,
  "resolved_params" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "row_count" integer,
  "byte_size" integer,
  "sha256" text,
  "recipients_sent" integer NOT NULL DEFAULT 0,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  CONSTRAINT "report_schedule_runs_slot_unique" UNIQUE ("schedule_id", "slot_key")
);
CREATE INDEX IF NOT EXISTS "idx_report_schedule_runs_company" ON "report_schedule_runs"("company_id", "started_at" DESC);

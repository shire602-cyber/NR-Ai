-- 0125_wq7_automations_onboarding_numbering (WQ7 commercial truth, onboarding and approvals):
-- per-company automation switches with their last run, server-side company onboarding progress,
-- and document numbering settings.
-- Idempotent: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- company_automation_settings: one row per (company, automation). A missing row means the
-- automation is on (its default); the scheduler skips a company whose row says enabled = false and
-- records every run it makes for a company (last_run_at, last_status, last_summary, last_error).
CREATE TABLE IF NOT EXISTS company_automation_settings (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status text,
  last_summary jsonb,
  last_error text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, automation_key)
);
--> statement-breakpoint
-- company_onboarding_progress: the setup wizard's step and first task, saved on the server so
-- they survive a device change (1.10), plus the industry chart and the go-live cut-over date.
CREATE TABLE IF NOT EXISTS company_onboarding_progress (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  step text,
  first_task text,
  starting_point text,
  industry text,
  cutover_date date,
  dismissed_getting_started boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- document_numbering_settings: prefix, zero padding and yearly reset per numbered document type.
-- The allocator (server/services/invoice-numbering.service.ts) stays the single writer of
-- invoice_number_sequences; with yearly_reset = false the sequence row uses year 0.
CREATE TABLE IF NOT EXISTS document_numbering_settings (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  prefix text NOT NULL,
  padding integer NOT NULL DEFAULT 5,
  yearly_reset boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, doc_type)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_automation_settings_key
  ON company_automation_settings (automation_key) WHERE enabled = false;

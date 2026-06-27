ALTER TABLE "company_report_delivery_runs"
  ADD COLUMN IF NOT EXISTS "retried_from_run_id" uuid,
  ADD COLUMN IF NOT EXISTS "error_message" text;

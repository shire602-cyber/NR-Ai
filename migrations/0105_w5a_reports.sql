-- 0105_w5a_reports (W5-A): real report delivery (R12-01, R12-10). Idempotent.
--  * company_report_delivery_runs: truthful lifecycle columns. status is now
--    queued | rendering | sent | failed | blocked | cancelled; blocked_reason is
--    no_email_provider | no_recipients | handoff_review; outbox ids link the run to
--    the email_outbox rows that carry its attachments.
--  * company_report_delivery_artifacts: the rendered PDF / XLSX bytes per run, kept
--    for the in-app delivery log (download) and as the audit copy of what was sent.

ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "blocked_reason" text;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "outbox_message_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "recipient_addresses" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "artifact_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "rendered_at" timestamp;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "company_report_delivery_runs" ADD COLUMN IF NOT EXISTS "retry_scheduled_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_report_delivery_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "company_report_delivery_runs"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "sha256" text NOT NULL,
  "content" bytea NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_report_delivery_artifacts_kind_check" CHECK ("kind" IN ('pdf', 'xlsx', 'zip'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_artifacts_run"
  ON "company_report_delivery_artifacts" ("company_id", "run_id");

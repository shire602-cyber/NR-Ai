CREATE TABLE IF NOT EXISTS "company_report_delivery_scheduler_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'success',
  "started_at" timestamp NOT NULL,
  "finished_at" timestamp NOT NULL,
  "scanned_subscriptions" integer NOT NULL DEFAULT 0,
  "queued_runs" integer NOT NULL DEFAULT 0,
  "skipped_paused" integer NOT NULL DEFAULT 0,
  "skipped_setup" integer NOT NULL DEFAULT 0,
  "skipped_not_due" integer NOT NULL DEFAULT 0,
  "skipped_no_actor" integer NOT NULL DEFAULT 0,
  "errors" integer NOT NULL DEFAULT 0,
  "message" text,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_scheduler_scans_company_id"
  ON "company_report_delivery_scheduler_scans" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_delivery_scheduler_scans_finished_at"
  ON "company_report_delivery_scheduler_scans" ("finished_at");

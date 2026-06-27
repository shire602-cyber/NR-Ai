-- Phase 2: Receipt Autopilot
-- Adds:
--   - transaction_classifications.classifier_method: 'rule' | 'keyword' | 'statistical' | 'openai'
--   - receipts.auto_posted: receipts auto-posted by the autopilot pipeline
--   - companies.classifier_config: per-company config { mode, accuracyThreshold, autopilotEnabled }

ALTER TABLE "transaction_classifications"
  ADD COLUMN IF NOT EXISTS "classifier_method" text;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "auto_posted" boolean NOT NULL DEFAULT false;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "classifier_config" jsonb NOT NULL DEFAULT '{"mode":"hybrid","accuracyThreshold":0.8,"autopilotEnabled":false}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_tx_classifications_company_method"
  ON "transaction_classifications" ("company_id", "classifier_method");

CREATE INDEX IF NOT EXISTS "idx_tx_classifications_company_accepted"
  ON "transaction_classifications" ("company_id", "was_accepted");

CREATE INDEX IF NOT EXISTS "idx_receipts_company_auto_posted"
  ON "receipts" ("company_id", "auto_posted");

-- Phase 2: Receipt Autopilot — surface classifier method on the receipt itself.
-- Lets the receipts list render Internal vs. AI badges without joining
-- transaction_classifications on every read.

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "classifier_method" text;

CREATE INDEX IF NOT EXISTS "idx_receipts_company_classifier_method"
  ON "receipts" ("company_id", "classifier_method");

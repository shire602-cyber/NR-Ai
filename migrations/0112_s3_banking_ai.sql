-- 0112_s3_banking_ai (S3): banking, AI and ledger-kernel residuals.
-- Stored cash-flow forecasts get a `basis`. Rows written before the document-driven forecast
-- (the historical-average / LLM model that fabricated inflows and outflows) are flagged
-- `legacy_model`; readers discard and regenerate them from open documents and scheduled items.
-- Idempotent: every statement can run twice.

ALTER TABLE "cash_flow_forecasts" ADD COLUMN IF NOT EXISTS "basis" text;

UPDATE "cash_flow_forecasts"
   SET "basis" = 'documents_and_scheduled_items'
 WHERE "basis" IS NULL
   AND COALESCE("factors", '') LIKE '%"basis":"documents_and_scheduled_items"%';

UPDATE "cash_flow_forecasts" SET "basis" = 'legacy_model' WHERE "basis" IS NULL;

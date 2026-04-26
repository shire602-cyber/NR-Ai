-- Sprint 3.6: 5-year data retention enforcement (UAE FTA)
-- FTA mandates that tax records are kept for at least 5 years from the period
-- end. We add a stored generated column on each financial-record table so
-- application code (and downstream BI tools) can read a single "expires_at"
-- date instead of recomputing from created_at everywhere.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "invoice_payments"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "bill_payments"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

ALTER TABLE "vat_returns"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

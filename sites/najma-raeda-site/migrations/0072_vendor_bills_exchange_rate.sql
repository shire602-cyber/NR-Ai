-- Multi-currency vendor bills: store the rate to AED at transaction date so
-- GL postings and VAT 201 figures (both AED by law) can convert document-
-- currency amounts. Defaults to 1 (AED bills unchanged). Idempotent.
ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(12,6) NOT NULL DEFAULT 1;

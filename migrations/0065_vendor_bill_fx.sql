-- Add first-class FX support to vendor bills.
--
-- Vendor-bill amounts remain stored in the bill currency. The exchange_rate
-- column stores 1 unit of bill currency = X AED, and base_currency_amount
-- stores the AED total used for reporting/search. Journal postings derive
-- AED debit/credit values from exchange_rate and preserve original currency
-- amounts on journal_lines.foreign_*.

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(15,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "base_currency_amount" numeric(15,2) NOT NULL DEFAULT 0;

UPDATE "vendor_bills"
SET
  "exchange_rate" = 1
WHERE "exchange_rate" IS NULL OR "exchange_rate" <= 0;

UPDATE "vendor_bills"
SET "base_currency_amount" = ROUND((COALESCE("total_amount", 0) * COALESCE("exchange_rate", 1))::numeric, 2)
WHERE "base_currency_amount" = 0
   OR "base_currency_amount" IS NULL;

ALTER TABLE "vendor_bills"
  DROP CONSTRAINT IF EXISTS "vendor_bills_exchange_rate_positive";

ALTER TABLE "vendor_bills"
  ADD CONSTRAINT "vendor_bills_exchange_rate_positive"
  CHECK ("exchange_rate" > 0);

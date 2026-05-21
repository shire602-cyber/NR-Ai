-- Idempotent repair for production databases where 0041 was marked as applied
-- before the FTA invoice recipient address column was physically created.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_address" text;

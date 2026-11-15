-- Sprint 3.1: Reverse-charge VAT
-- UAE FTA requires self-assessment of VAT on imports and supplies from non-registered foreign vendors.
-- The buyer accrues OUTPUT VAT (Box 3) and claims INPUT VAT (Box 10) — net zero cash, but reported on the return.

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;

ALTER TABLE "bill_line_items"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_reverse_charge"
  ON "vendor_bills"("company_id", "reverse_charge")
  WHERE "reverse_charge" = true;

CREATE INDEX IF NOT EXISTS "idx_receipts_reverse_charge"
  ON "receipts"("company_id", "reverse_charge")
  WHERE "reverse_charge" = true;

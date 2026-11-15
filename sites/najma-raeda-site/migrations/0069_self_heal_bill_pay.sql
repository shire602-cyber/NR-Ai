-- Self-healing bill-pay schema (vendor_bills / bill_line_items / bill_payments).
--
-- Production databases whose Drizzle ledger was baselined have migration
-- 0010_add_bill_pay marked as applied without it ever running (same failure
-- mode as corporate_tax_returns, fixed in 0068). The bill-pay module then
-- 500s on every request. Recreate the tables with their full current shape
-- (including the 0032 reverse-charge and 0036 retention columns) when absent,
-- then add the later columns for databases where the legacy tables already
-- exist. Every statement is a no-op on re-run.

CREATE TABLE IF NOT EXISTS "vendor_bills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vendor_name" text NOT NULL,
  "vendor_trn" text,
  "bill_number" text,
  "bill_date" timestamp NOT NULL,
  "due_date" timestamp,
  "currency" text DEFAULT 'AED',
  "subtotal" numeric(12,2) DEFAULT 0,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "total_amount" numeric(12,2) DEFAULT 0,
  "amount_paid" numeric(12,2) DEFAULT 0,
  "status" text DEFAULT 'pending',
  "category" text,
  "notes" text,
  "attachment_url" text,
  "approved_by" uuid,
  "approved_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "reverse_charge" boolean NOT NULL DEFAULT false,
  "retention_expires_at" timestamp
    GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED
);

CREATE TABLE IF NOT EXISTS "bill_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" numeric(10,2) DEFAULT 1,
  "unit_price" numeric(12,2) NOT NULL,
  "vat_rate" numeric(5,2) DEFAULT 5,
  "amount" numeric(12,2),
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "reverse_charge" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "bill_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
  "payment_date" timestamp NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "payment_method" text DEFAULT 'bank_transfer',
  "reference" text,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "retention_expires_at" timestamp
    GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED
);

-- Legacy-table path: databases where 0010 DID run but 0032/0036 didn't.
ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
ALTER TABLE "bill_line_items"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;
ALTER TABLE "bill_payments"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_company_id" ON "vendor_bills"("company_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_status" ON "vendor_bills"("status");
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_due_date" ON "vendor_bills"("due_date");
CREATE INDEX IF NOT EXISTS "idx_bill_line_items_bill_id" ON "bill_line_items"("bill_id");
CREATE INDEX IF NOT EXISTS "idx_bill_payments_bill_id" ON "bill_payments"("bill_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_reverse_charge"
  ON "vendor_bills"("company_id", "reverse_charge")
  WHERE "reverse_charge" = true;

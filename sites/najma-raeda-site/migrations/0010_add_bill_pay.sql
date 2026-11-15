-- Bill Pay / Accounts Payable module tables

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
  "created_at" timestamp DEFAULT now()
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
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "bill_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
  "payment_date" timestamp NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "payment_method" text DEFAULT 'bank_transfer',
  "reference" text,
  "notes" text,
  "created_at" timestamp DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_company_id" ON "vendor_bills"("company_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_status" ON "vendor_bills"("status");
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_due_date" ON "vendor_bills"("due_date");
CREATE INDEX IF NOT EXISTS "idx_bill_line_items_bill_id" ON "bill_line_items"("bill_id");
CREATE INDEX IF NOT EXISTS "idx_bill_payments_bill_id" ON "bill_payments"("bill_id");

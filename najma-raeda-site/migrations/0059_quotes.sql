-- Quotes (estimates) — convertible to invoices. Idempotent for databases of
-- any lineage.
CREATE TABLE IF NOT EXISTS "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "date" timestamp NOT NULL,
  "expiry_date" timestamp,
  "currency" text NOT NULL DEFAULT 'AED',
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "converted_invoice_id" uuid,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "quotes_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_quotes_company_id" ON "quotes" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_quotes_company_status" ON "quotes" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "quote_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" real NOT NULL,
  "unit_price" numeric(15,2) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated'
);
CREATE INDEX IF NOT EXISTS "idx_quote_lines_quote_id" ON "quote_lines" ("quote_id");

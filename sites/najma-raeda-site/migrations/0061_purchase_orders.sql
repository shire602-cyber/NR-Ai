-- Purchase orders. Idempotent.
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "vendor_name" text NOT NULL,
  "vendor_trn" text,
  "date" timestamp NOT NULL,
  "expected_delivery_date" timestamp,
  "currency" text NOT NULL DEFAULT 'AED',
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_orders_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_company_id" ON "purchase_orders" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_company_status" ON "purchase_orders" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" real NOT NULL,
  "unit_price" numeric(15,2) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated'
);
CREATE INDEX IF NOT EXISTS "idx_purchase_order_lines_po_id" ON "purchase_order_lines" ("purchase_order_id");

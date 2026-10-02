-- 0104_sales_orders_quote_acceptance (Phase 8 D1): quote send/accept/decline with a signature record, sales orders,
-- their deliveries and links from invoices. Additive and idempotent.
--
-- Invoiced and delivered quantities of a sales order are DERIVED (invoices not void/cancelled, delivery lines), never
-- stored, so a void releases quantity by itself. Nothing here posts to the ledger.

-- ─── Quotes: share link, status timestamps, link to the sales order ─────────
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "share_token" text;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "share_token_expires_at" timestamp;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "declined_at" timestamp;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "converted_sales_order_id" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quotes_share_token" ON "quotes"("share_token") WHERE "share_token" IS NOT NULL;

-- ─── Quote signatures: who accepted or declined, when and from where; kept 5 years (Art. 78) ───
-- quote_id has no foreign key on purpose: a declined quote may be deleted while its signature record is kept, so the
-- record carries a snapshot (number, customer, totals). At most one LIVE signature per quote (a revise supersedes it).
CREATE TABLE IF NOT EXISTS "quote_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "quote_id" uuid NOT NULL,
  "quote_number" text NOT NULL,
  "customer_name" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "action" text NOT NULL,
  "signer_name" text NOT NULL,
  "signer_email" text NOT NULL,
  "ip" text,
  "user_agent" text,
  "reason" text,
  "quote_hash" text NOT NULL,
  "signed_at" timestamp NOT NULL DEFAULT now(),
  "superseded_at" timestamp,
  "retention_expires_at" timestamp NOT NULL DEFAULT (now() + interval '5 years'),
  CONSTRAINT "quote_signatures_action_check" CHECK ("action" IN ('accepted','declined'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_quote_signatures_live" ON "quote_signatures"("quote_id") WHERE "superseded_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_quote_signatures_company" ON "quote_signatures"("company_id");

-- ─── Sales orders ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE RESTRICT,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "quote_id" uuid REFERENCES "quotes"("id") ON DELETE SET NULL,
  "date" timestamp NOT NULL,
  "expected_date" timestamp,
  "currency" text NOT NULL DEFAULT 'AED',
  "exchange_rate" numeric(15,6) NOT NULL DEFAULT 1,
  "discount_type" text,
  "discount_value" numeric(15,6),
  "discount_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "shipping_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'open',
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "sales_orders_status_check" CHECK ("status" IN ('open','closed','cancelled')),
  CONSTRAINT "sales_orders_discount_type_check" CHECK ("discount_type" IS NULL OR "discount_type" IN ('percent','amount')),
  CONSTRAINT "sales_orders_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_sales_orders_company_status" ON "sales_orders"("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_sales_orders_contact" ON "sales_orders"("contact_id");

CREATE TABLE IF NOT EXISTS "sales_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" numeric(15,4) NOT NULL,
  "unit_price" numeric(19,6) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated',
  "revenue_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "line_kind" text NOT NULL DEFAULT 'item',
  "parent_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE CASCADE,
  "discount_type" text,
  "discount_value" numeric(15,6),
  "sort_order" integer NOT NULL DEFAULT 0,
  "price_list_id" uuid REFERENCES "price_lists"("id") ON DELETE SET NULL,
  CONSTRAINT "sales_order_lines_kind_check" CHECK ("line_kind" IN ('item','discount','shipping')),
  CONSTRAINT "sales_order_lines_discount_type_check" CHECK ("discount_type" IS NULL OR "discount_type" = 'percent')
);
CREATE INDEX IF NOT EXISTS "idx_sales_order_lines_order" ON "sales_order_lines"("sales_order_id", "sort_order");

CREATE TABLE IF NOT EXISTS "sales_order_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
  "number" text NOT NULL,
  "date" timestamp NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "sales_order_deliveries_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_sales_order_deliveries_order" ON "sales_order_deliveries"("sales_order_id");

CREATE TABLE IF NOT EXISTS "sales_order_delivery_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "delivery_id" uuid NOT NULL REFERENCES "sales_order_deliveries"("id") ON DELETE CASCADE,
  "sales_order_line_id" uuid NOT NULL REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT,
  "quantity" numeric(15,4) NOT NULL,
  CONSTRAINT "sales_order_delivery_lines_qty_positive" CHECK ("quantity" > 0)
);
CREATE INDEX IF NOT EXISTS "idx_sales_order_delivery_lines_delivery" ON "sales_order_delivery_lines"("delivery_id");
CREATE INDEX IF NOT EXISTS "idx_sales_order_delivery_lines_line" ON "sales_order_delivery_lines"("sales_order_line_id");

-- ─── Links from invoices, quotes and advances ───────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sales_order_id" uuid;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "sales_order_line_id" uuid;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_fk"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_sales_order_line_fk"
    FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_sales_order_fk"
    FOREIGN KEY ("converted_sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_sales_order_fk"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "idx_invoices_sales_order" ON "invoices"("sales_order_id") WHERE "sales_order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_invoice_lines_sales_order_line" ON "invoice_lines"("sales_order_line_id") WHERE "sales_order_line_id" IS NOT NULL;

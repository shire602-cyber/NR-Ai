-- 0102_sales_lines_and_advances (Phase 8 D1): the sales line model and customer advances. Additive and idempotent.
--
-- Discounts, shipping, advance deductions and late fees are stored as SERVER-DERIVED SIGNED LINES, so every VAT
-- engine (which computes quantity x unit_price per line) nets them unchanged. `line_kind` says which is which;
-- `parent_line_id` ties a line-level discount to its item; `sort_order` fixes the line order (reads were unordered).
-- New invoice_type values `advance` and `late_fee` need no constraint: invoice_type is free text and every
-- consumer only tests `= 'credit_note'`.
--
-- Accounts 1025, 2055, 4035 (and 4050, 4040, 5110) are NOT inserted here: they are in the default chart and created
-- on demand per company by ensureSystemAccount.

-- ─── invoice_lines / quote_lines ────────────────────────────────────────────
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "line_kind" text NOT NULL DEFAULT 'item';
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "parent_line_id" uuid;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "customer_advance_id" uuid;

ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "line_kind" text NOT NULL DEFAULT 'item';
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "parent_line_id" uuid;
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_line_kind_check"
    CHECK ("line_kind" IN ('item','discount','shipping','advance','late_fee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_discount_type_check"
    CHECK ("discount_type" IS NULL OR "discount_type" IN ('percent','amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_parent_line_fk"
    FOREIGN KEY ("parent_line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_line_kind_check"
    CHECK ("line_kind" IN ('item','discount','shipping','advance','late_fee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_discount_type_check"
    CHECK ("discount_type" IS NULL OR "discount_type" IN ('percent','amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_parent_line_fk"
    FOREIGN KEY ("parent_line_id") REFERENCES "quote_lines"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_lines_invoice_order" ON "invoice_lines"("invoice_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_quote_lines_quote_order" ON "quote_lines"("quote_id", "sort_order");

-- ─── invoices / quotes: document discount and shipping ──────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "shipping_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "late_fee_for_invoice_id" uuid;

ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "shipping_amount" numeric(15,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_type_check"
    CHECK ("discount_type" IS NULL OR "discount_type" IN ('percent','amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_type_check"
    CHECK ("discount_type" IS NULL OR "discount_type" IN ('percent','amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_late_fee_for_invoice_fk"
    FOREIGN KEY ("late_fee_for_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One late fee per invoice, ever (a voided fee is never recreated).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_late_fee_for_invoice"
  ON "invoices"("late_fee_for_invoice_id") WHERE "late_fee_for_invoice_id" IS NOT NULL;

-- ─── Customer advances ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_advances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE RESTRICT,
  "number" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'advance',
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "sales_order_id" uuid,
  "currency" text NOT NULL DEFAULT 'AED',
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text NOT NULL DEFAULT 'standard_rated',
  "net_amount" numeric(15,2) NOT NULL,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "gross_amount" numeric(15,2) NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'open',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_advances_kind_check" CHECK ("kind" IN ('advance','deposit')),
  CONSTRAINT "customer_advances_status_check" CHECK ("status" IN ('open','applied','refunded','void')),
  CONSTRAINT "customer_advances_currency_check" CHECK ("currency" = 'AED'),
  CONSTRAINT "customer_advances_net_positive" CHECK ("net_amount" > 0),
  CONSTRAINT "customer_advances_invoice_unique" UNIQUE ("invoice_id"),
  CONSTRAINT "customer_advances_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_customer_advances_company_contact_status"
  ON "customer_advances"("company_id", "contact_id", "status");

CREATE TABLE IF NOT EXISTS "customer_advance_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "advance_id" uuid NOT NULL REFERENCES "customer_advances"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL DEFAULT 'application',
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE CASCADE,
  "invoice_line_id" uuid REFERENCES "invoice_lines"("id") ON DELETE SET NULL,
  "net_amount" numeric(15,2) NOT NULL,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_advance_applications_kind_check" CHECK ("kind" IN ('application','refund')),
  CONSTRAINT "customer_advance_applications_status_check" CHECK ("status" IN ('pending','active','reversed')),
  CONSTRAINT "customer_advance_applications_net_positive" CHECK ("net_amount" > 0)
);
CREATE INDEX IF NOT EXISTS "idx_customer_advance_applications_advance" ON "customer_advance_applications"("advance_id", "status");
CREATE INDEX IF NOT EXISTS "idx_customer_advance_applications_invoice" ON "customer_advance_applications"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_customer_advance_applications_company" ON "customer_advance_applications"("company_id");

DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_customer_advance_fk"
    FOREIGN KEY ("customer_advance_id") REFERENCES "customer_advances"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

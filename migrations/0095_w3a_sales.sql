-- 0095_w3a_sales (W3-A): order-to-cash — supply type, place of supply, discounts, customer credits, debit notes, progress billing, recurring options, template branding. Idempotent.
--  * invoices: place_of_supply_emirate, supply_date, notes, document discount, source quote, template, issued_at
--  * invoice_lines: line discount, net_amount, product_id / cost_center_id (nullable), quote_line_id
--  * quotes / quote_lines: contact terms, discounts, billed_quantity (progress billing)
--  * customer_contacts.emirate; recurring_invoices auto-issue / auto-send / last-run outcome
--  * invoice_templates branding (logo_url, terms_text, bank_details)
--  * customer_credits + customer_credit_allocations (credit balance, apply, refund)
--  * cursor-pagination index on invoices (company_id, created_at, id)
-- Nothing is backfilled silently: existing 0% lines stored as standard_rated are listed for owner
-- review by scripts/qa/find-sales-ledger-drift.mjs.

-- ── invoices ──────────────────────────────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "place_of_supply_emirate" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "supply_date" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_type" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_quote_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "template_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_company_created_id" ON "invoices" ("company_id", "created_at", "id");
--> statement-breakpoint

-- ── invoice_lines ─────────────────────────────────────────────────────────────
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "discount_type" text;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "net_amount" numeric(15,2);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "quote_line_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_product_id_products_id_fk') THEN
    ALTER TABLE "invoice_lines"
      ADD CONSTRAINT "invoice_lines_product_id_products_id_fk"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_cost_center_id_cost_centers_id_fk') THEN
    ALTER TABLE "invoice_lines"
      ADD CONSTRAINT "invoice_lines_cost_center_id_cost_centers_id_fk"
      FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

-- ── quotes / quote_lines ──────────────────────────────────────────────────────
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "customer_address" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "payment_terms" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "place_of_supply_emirate" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_type" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "discount_type" text;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "discount_value" numeric(15,6);
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "billed_quantity" real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
--> statement-breakpoint

-- ── customer_contacts / recurring_invoices / invoice_templates ───────────────
ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "emirate" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "contact_id" uuid;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "customer_address" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "payment_terms" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "place_of_supply_emirate" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "auto_issue" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "auto_send" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "send_to_email" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_run_status" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_run_message" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "logo_url" text;
--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "terms_text" text;
--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "bank_details" text;
--> statement-breakpoint

-- ── customer credits ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid,
  "customer_name" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "invoice_id" uuid,
  "currency" text DEFAULT 'AED' NOT NULL,
  "exchange_rate" numeric(15,6) DEFAULT 1 NOT NULL,
  "liability_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "amount" numeric(15,2) NOT NULL,
  "remaining" numeric(15,2) NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "customer_credits_source_unique" UNIQUE ("company_id", "source_type", "source_id"),
  CONSTRAINT "customer_credits_remaining_check" CHECK ("remaining" >= 0 AND "remaining" <= "amount")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_credits_company" ON "customer_credits" ("company_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_credit_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "credit_id" uuid NOT NULL REFERENCES "customer_credits"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "payment_account_id" uuid REFERENCES "accounts"("id"),
  "amount" numeric(15,2) NOT NULL,
  "date" timestamp NOT NULL,
  "exchange_rate" numeric(15,6),
  "reference" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_credit_allocations_credit" ON "customer_credit_allocations" ("credit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_credit_allocations_invoice" ON "customer_credit_allocations" ("invoice_id");

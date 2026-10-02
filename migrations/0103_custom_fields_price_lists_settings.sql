-- 0103_custom_fields_price_lists_settings (Phase 8 D1): custom fields, price lists, recurring auto-send and
-- late-fee settings. Additive and idempotent. Every new table carries company_id; custom_field_values is
-- polymorphic (record_id), so every read joins company_id.

-- ─── Custom fields ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "entity" text NOT NULL,
  "key" text NOT NULL,
  "label_en" text NOT NULL,
  "label_ar" text NOT NULL,
  "field_type" text NOT NULL DEFAULT 'text',
  "options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "show_on_pdf" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "custom_field_definitions_entity_check" CHECK ("entity" IN ('contact','invoice','quote','bill','sales_order')),
  CONSTRAINT "custom_field_definitions_type_check" CHECK ("field_type" IN ('text','number','date','select')),
  CONSTRAINT "custom_field_definitions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT "custom_field_definitions_unique" UNIQUE ("company_id", "entity", "key")
);
CREATE INDEX IF NOT EXISTS "idx_custom_field_definitions_company_entity" ON "custom_field_definitions"("company_id", "entity");

CREATE TABLE IF NOT EXISTS "custom_field_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "entity" text NOT NULL,
  "record_id" uuid NOT NULL,
  "definition_id" uuid NOT NULL REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE,
  "value" text NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "custom_field_values_unique" UNIQUE ("definition_id", "record_id")
);
CREATE INDEX IF NOT EXISTS "idx_custom_field_values_record" ON "custom_field_values"("company_id", "entity", "record_id");

-- ─── Price lists ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "price_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "price_lists_company_name_unique" UNIQUE ("company_id", "name")
);
CREATE INDEX IF NOT EXISTS "idx_price_lists_company" ON "price_lists"("company_id");

CREATE TABLE IF NOT EXISTS "price_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "price_list_id" uuid NOT NULL REFERENCES "price_lists"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "unit_price" numeric(19,6) NOT NULL,
  CONSTRAINT "price_list_items_price_positive" CHECK ("unit_price" > 0),
  CONSTRAINT "price_list_items_unique" UNIQUE ("price_list_id", "product_id")
);
CREATE INDEX IF NOT EXISTS "idx_price_list_items_company" ON "price_list_items"("company_id");

ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "price_list_id" uuid;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "price_list_id" uuid;
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "price_list_id" uuid;
DO $$ BEGIN
  ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_price_list_fk"
    FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_list_fk"
    FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_price_list_fk"
    FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Recurring invoices: contact, payment terms, auto-send ──────────────────
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "contact_id" uuid;
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "auto_send" boolean NOT NULL DEFAULT false;
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer;
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_send_status" text;
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_send_error" text;
DO $$ BEGIN
  ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contact_fk"
    FOREIGN KEY ("contact_id") REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Late fees (off by default) ─────────────────────────────────────────────
ALTER TABLE "chase_configs" ADD COLUMN IF NOT EXISTS "late_fee_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "chase_configs" ADD COLUMN IF NOT EXISTS "late_fee_type" text NOT NULL DEFAULT 'percent';
ALTER TABLE "chase_configs" ADD COLUMN IF NOT EXISTS "late_fee_value" numeric(15,6) NOT NULL DEFAULT 0;
ALTER TABLE "chase_configs" ADD COLUMN IF NOT EXISTS "late_fee_after_days" integer NOT NULL DEFAULT 15;
ALTER TABLE "chase_configs" ADD COLUMN IF NOT EXISTS "late_fee_vat_treatment" text NOT NULL DEFAULT 'out_of_scope';
DO $$ BEGIN
  ALTER TABLE "chase_configs" ADD CONSTRAINT "chase_configs_late_fee_type_check" CHECK ("late_fee_type" IN ('percent','fixed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chase_configs" ADD CONSTRAINT "chase_configs_late_fee_vat_check" CHECK ("late_fee_vat_treatment" IN ('out_of_scope','standard_rated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sprint 3.7: QuickBooks-style company preferences
-- Adds settings columns used by the new Company Settings page so users can
-- manage legal name, structured address, fiscal year, default VAT rate, and
-- date format from one screen. All ALTERs are idempotent.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "legal_name" text;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "date_format" text NOT NULL DEFAULT 'DD/MM/YYYY';

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "fiscal_year_start_month" integer NOT NULL DEFAULT 1;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "default_vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "address_street" text;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "address_city" text;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "address_country" text DEFAULT 'AE';

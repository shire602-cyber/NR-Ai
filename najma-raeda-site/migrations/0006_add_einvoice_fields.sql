ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_uuid" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_xml" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_hash" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_status" text;

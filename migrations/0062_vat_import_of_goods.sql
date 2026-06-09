-- VAT-201 Import of Goods (Box 6 / Box 7)
-- Flagged purchases declare import VAT as DUE (Box 6 imports, Box 7 adjustments)
-- and recover the recoverable portion via Box 10. Excluded from Box 9 standard
-- expenses. Customs import value can exceed the supplier subtotal (customs value
-- + insurance + freight + duty + excise), so explicit AED override fields are
-- provided; they default to subtotal/vat_amount when null.

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "vat_import_role" text,
  ADD COLUMN IF NOT EXISTS "import_taxable_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "import_vat_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "customs_declaration_number" text,
  ADD COLUMN IF NOT EXISTS "import_date" timestamp,
  ADD COLUMN IF NOT EXISTS "import_evidence_url" text,
  ADD COLUMN IF NOT EXISTS "import_adjustment_reason" text;

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "vat_import_role" text,
  ADD COLUMN IF NOT EXISTS "import_taxable_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "import_vat_amount_aed" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "customs_declaration_number" text,
  ADD COLUMN IF NOT EXISTS "import_date" timestamp,
  ADD COLUMN IF NOT EXISTS "import_evidence_url" text,
  ADD COLUMN IF NOT EXISTS "import_adjustment_reason" text;

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_vat_import_role"
  ON "vendor_bills"("company_id", "vat_import_role")
  WHERE "vat_import_role" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_receipts_vat_import_role"
  ON "receipts"("company_id", "vat_import_role")
  WHERE "vat_import_role" IS NOT NULL;

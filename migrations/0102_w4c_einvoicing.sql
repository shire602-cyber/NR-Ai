-- 0102_w4c_einvoicing (W4-C): UAE PINT AE e-invoicing to the ASP boundary and ZATCA (KSA)
-- Phase 2 to the Fatoora boundary. Idempotent: every statement is re-runnable.
--  * companies: Peppol participant id/scheme, trade licence + authority, payee IBAN,
--    payment means, e-invoicing scope / turnover band / go-live override (R07-04, R07-13)
--  * einvoice_documents: per-invoice validation, ASP lifecycle, retry/backoff (R07-13, R03-18)
--  * einvoice_archive: five-year archive of submitted/cleared/received XML; immutable (R07-13)
--  * einvoice_inbound_documents: supplier e-invoices received via the ASP (R04-23)
--  * einvoice_buyer_endpoints: buyer Peppol ids per customer contact (R07-04)
--  * zatca_egs_units / zatca_documents: ZATCA EGS keys, CSIDs, ICV/PIH chain (R07-14)

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "peppol_participant_id" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "peppol_scheme" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "trade_licence_no" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "trade_licence_authority" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "einvoice_payee_iban" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "einvoice_payment_means_code" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "einvoice_scope" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "einvoice_turnover_band" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "einvoice_go_live_date" date;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_einvoice_scope_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT companies_einvoice_scope_check
      CHECK (einvoice_scope IS NULL OR einvoice_scope IN ('b2b', 'b2g', 'b2b_b2g', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_einvoice_turnover_band_check') THEN
    ALTER TABLE "companies" ADD CONSTRAINT companies_einvoice_turnover_band_check
      CHECK (einvoice_turnover_band IS NULL OR einvoice_turnover_band IN ('large', 'standard', 'government'));
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "einvoice_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL,
  "status" text DEFAULT 'generated' NOT NULL,
  "document_type" text,
  "uuid" text,
  "xml_hash" text,
  "validation" jsonb,
  "validated_at" timestamp,
  "provider" text,
  "provider_message_id" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamp,
  "last_error" text,
  "rejection_reasons" jsonb,
  "cleared_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "einvoice_documents_invoice_unique" UNIQUE ("invoice_id"),
  CONSTRAINT "einvoice_documents_status_check" CHECK (status IN
    ('generated', 'submitted', 'accepted', 'cleared', 'rejected', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_einvoice_documents_company_status"
  ON "einvoice_documents" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_einvoice_documents_retry" ON "einvoice_documents" ("next_retry_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "einvoice_archive" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "invoice_id" uuid,
  "direction" text NOT NULL,
  "kind" text NOT NULL,
  "document_number" text NOT NULL,
  "document_type" text,
  "uuid" text,
  "xml" text NOT NULL,
  "sha256" text NOT NULL,
  "provider" text,
  "provider_message_id" text,
  "retain_until" date NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "einvoice_archive_content_unique" UNIQUE ("company_id", "direction", "kind", "sha256"),
  CONSTRAINT "einvoice_archive_direction_check" CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT "einvoice_archive_kind_check" CHECK (kind IN ('submitted', 'cleared', 'received')),
  CONSTRAINT "einvoice_archive_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_einvoice_archive_company_created"
  ON "einvoice_archive" ("company_id", "created_at");
--> statement-breakpoint
-- Archive rows are write-once evidence (FTA retention): no UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION einvoice_archive_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'einvoice_archive rows are immutable (% blocked)', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS einvoice_archive_no_update ON "einvoice_archive";
--> statement-breakpoint
CREATE TRIGGER einvoice_archive_no_update BEFORE UPDATE OR DELETE ON "einvoice_archive"
  FOR EACH ROW EXECUTE FUNCTION einvoice_archive_immutable();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "einvoice_inbound_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "supplier_key" text DEFAULT '' NOT NULL,
  "supplier_name" text,
  "supplier_trn" text,
  "document_number" text NOT NULL,
  "document_type" text,
  "uuid" text,
  "sha256" text NOT NULL,
  "validation" jsonb,
  "status" text DEFAULT 'received' NOT NULL,
  "bill_id" uuid,
  "archive_id" uuid,
  "error" text,
  "received_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "einvoice_inbound_duplicate_unique" UNIQUE ("company_id", "supplier_key", "document_number"),
  CONSTRAINT "einvoice_inbound_status_check" CHECK (status IN ('received', 'bill_created', 'invalid', 'failed'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "einvoice_buyer_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL,
  "participant_id" text,
  "scheme" text,
  "legal_id" text,
  "legal_id_type" text,
  "legal_authority" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "einvoice_buyer_endpoints_contact_unique" UNIQUE ("company_id", "contact_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "zatca_egs_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "environment" text NOT NULL,
  "vat_number" text NOT NULL,
  "organization_name" text NOT NULL,
  "organization_unit" text NOT NULL,
  "common_name" text NOT NULL,
  "serial_number" text NOT NULL,
  "invoice_types" text DEFAULT '1100' NOT NULL,
  "location_address" text NOT NULL,
  "industry" text NOT NULL,
  "seller_profile" jsonb NOT NULL,
  "private_key_enc" text NOT NULL,
  "csr_pem" text NOT NULL,
  "compliance_request_id" text,
  "compliance_csid" text,
  "compliance_secret_enc" text,
  "production_csid" text,
  "production_secret_enc" text,
  "status" text DEFAULT 'created' NOT NULL,
  "status_detail" text,
  "icv" integer DEFAULT 0 NOT NULL,
  "last_invoice_hash" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "zatca_egs_units_status_check" CHECK (status IN ('created', 'compliance', 'production', 'failed')),
  CONSTRAINT "zatca_egs_units_environment_check" CHECK (environment IN ('sandbox', 'simulation', 'production'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_zatca_egs_units_company" ON "zatca_egs_units" ("company_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "zatca_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "egs_unit_id" uuid NOT NULL REFERENCES "zatca_egs_units"("id") ON DELETE RESTRICT,
  "invoice_id" uuid,
  "icv" integer NOT NULL,
  "uuid" text NOT NULL,
  "profile" text NOT NULL,
  "invoice_hash" text NOT NULL,
  "previous_hash" text NOT NULL,
  "signed_xml" text NOT NULL,
  "qr" text NOT NULL,
  "status" text DEFAULT 'signed' NOT NULL,
  "response" jsonb,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "zatca_documents_chain_unique" UNIQUE ("egs_unit_id", "icv"),
  CONSTRAINT "zatca_documents_profile_check" CHECK (profile IN ('standard', 'simplified')),
  CONSTRAINT "zatca_documents_status_check" CHECK (status IN ('signed', 'cleared', 'reported', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_zatca_documents_invoice" ON "zatca_documents" ("invoice_id");

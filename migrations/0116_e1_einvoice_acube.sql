-- 0116_e1_einvoice_acube (E1; W4-C e-invoicing residual): UAE e-invoicing through the A-Cube ASP.
-- Idempotent: ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- 1. einvoice_documents gets the two-track status model: delivery to the buyer over Peppol
--    (draft | validated | queued | sending | delivered | delivery_failed | rejected) and FTA
--    tax reporting (not_required | pending | reported | report_failed), each with its own
--    timestamp, plus the report-by date, the raw provider status, a stable error code and the
--    submission claim that stops two requests sending the same invoice twice.
-- 2. einvoice_document_events is the per-invoice history shown in the status drawer.
-- 3. einvoice_provider_events is the durable inbox for provider webhooks and poll results:
--    a delivery is stored first (unique per provider event id, so A-Cube's 15 retries are
--    absorbed) and processed by the "einvoice.providerEvents" job with backoff.
-- 4. einvoice_legal_entities holds each company's A-Cube legal entity (reserved TIN,
--    EmaraTax link status, capabilities, Peppol address, last sync).
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "delivery_status" text;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "delivery_status_at" timestamp;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "reporting_status" text;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "reporting_status_at" timestamp;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "report_by" date;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "provider_status" text;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "last_error_code" text;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "reported_at" timestamp;
ALTER TABLE "einvoice_documents" ADD COLUMN IF NOT EXISTS "submit_claimed_at" timestamp;
CREATE INDEX IF NOT EXISTS "idx_einvoice_documents_provider_message"
  ON "einvoice_documents" ("provider", "provider_message_id");

CREATE TABLE IF NOT EXISTS "einvoice_document_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL,
  "track" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "provider" text,
  "provider_status" text,
  "code" text,
  "message" text,
  "source" text NOT NULL DEFAULT 'system',
  "provider_event_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_einvoice_document_events_invoice"
  ON "einvoice_document_events" ("company_id", "invoice_id", "created_at");

CREATE TABLE IF NOT EXISTS "einvoice_provider_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "environment" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "company_id" uuid,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "locked_until" timestamp,
  "last_error" text,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_einvoice_provider_events_event"
  ON "einvoice_provider_events" ("provider", "environment", "event_id");
CREATE INDEX IF NOT EXISTS "idx_einvoice_provider_events_due"
  ON "einvoice_provider_events" ("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "einvoice_legal_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "environment" text NOT NULL,
  "legal_entity_id" text,
  "tin" text NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "name_en" text,
  "name_ar" text,
  "vat_trn" text,
  "capabilities" jsonb,
  "peppol_address" text,
  "approver" text,
  "approver_email" text,
  "last_action" text,
  "last_error" text,
  "reservation_expires_at" timestamp,
  "smp_sync_at" timestamp,
  "registry_sync_at" timestamp,
  "last_sync_at" timestamp,
  "activated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_einvoice_legal_entities_company"
  ON "einvoice_legal_entities" ("company_id", "provider", "environment");
CREATE INDEX IF NOT EXISTS "idx_einvoice_legal_entities_entity"
  ON "einvoice_legal_entities" ("provider", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "idx_einvoice_legal_entities_tin"
  ON "einvoice_legal_entities" ("provider", "tin");

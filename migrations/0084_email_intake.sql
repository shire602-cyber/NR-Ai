-- P1: Email document intake (firm-internal pilot). Additive; safe.
-- See docs/EMAIL_INTAKE_PILOT.md. Feature is gated by EMAIL_INTAKE_ENABLED and
-- ships disabled, so these tables sit empty until the flag + a mailbox are on.

CREATE TABLE IF NOT EXISTS "client_email_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "firm_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sender_email" text NOT NULL,
  "label" text,
  "status" text NOT NULL DEFAULT 'active',
  "require_dkim_pass" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_client_email_sources_company" ON "client_email_sources" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_client_email_sources_firm" ON "client_email_sources" ("firm_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_email_sources_firm_sender" ON "client_email_sources" ("firm_id", "sender_email");

CREATE TABLE IF NOT EXISTS "email_intake_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL REFERENCES "client_email_sources"("id") ON DELETE CASCADE,
  "provider_message_id" text NOT NULL,
  "from_email" text NOT NULL,
  "subject" text,
  "received_at" timestamp NOT NULL,
  "attachment_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'received',
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_email_intake_messages_company" ON "email_intake_messages" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_intake_messages_provider_msg" ON "email_intake_messages" ("provider_message_id");

CREATE TABLE IF NOT EXISTS "email_intake_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "email_intake_messages"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "filename" text,
  "mime_type" text,
  "byte_size" integer,
  "storage_path" text,
  "sha256" text NOT NULL,
  "doc_kind" text NOT NULL DEFAULT 'unknown',
  "ocr_status" text NOT NULL DEFAULT 'pending',
  "receipt_id" uuid REFERENCES "receipts"("id") ON DELETE SET NULL,
  "is_duplicate" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_email_intake_documents_message" ON "email_intake_documents" ("message_id");
CREATE INDEX IF NOT EXISTS "idx_email_intake_documents_company" ON "email_intake_documents" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_intake_documents_company_hash" ON "email_intake_documents" ("company_id", "sha256");

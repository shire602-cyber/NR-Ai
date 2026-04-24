-- Migration: 0020_add_communications
-- Adds client_communications and communication_templates tables for Phase 3: Communications Hub

CREATE TABLE IF NOT EXISTS "client_communications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "direction" text NOT NULL DEFAULT 'outbound',
  "recipient_phone" text,
  "recipient_email" text,
  "subject" text,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'sent',
  "template_type" text,
  "metadata" text,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "communication_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "channel" text NOT NULL,
  "template_type" text NOT NULL,
  "subject_template" text,
  "body_template" text NOT NULL,
  "language" text NOT NULL DEFAULT 'en',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "client_communications_company_idx" ON "client_communications" ("company_id");
CREATE INDEX IF NOT EXISTS "client_communications_sent_at_idx" ON "client_communications" ("sent_at" DESC);

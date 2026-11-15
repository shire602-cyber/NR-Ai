-- Phase 5: Document Chasing Autopilot
-- Tracks UAE compliance document requirements per company, the escalating
-- chase pipeline used to collect them, and the calendar of upcoming
-- deadlines (trade-licence renewals, visa expiries, FTA filings, ESR, etc.)
-- that drive auto-scheduled reminders.

CREATE TABLE IF NOT EXISTS "document_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "description" text,
  "due_date" timestamp NOT NULL,
  "is_recurring" boolean NOT NULL DEFAULT false,
  "recurring_interval_days" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "received_at" timestamp,
  "uploaded_document_id" uuid,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_document_requirements_company_id"
  ON "document_requirements" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_document_requirements_due_date"
  ON "document_requirements" ("due_date");
CREATE INDEX IF NOT EXISTS "idx_document_requirements_status"
  ON "document_requirements" ("status");

CREATE TABLE IF NOT EXISTS "document_chases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "requirement_id" uuid NOT NULL REFERENCES "document_requirements"("id") ON DELETE CASCADE,
  "chase_level" text NOT NULL,
  "sent_via" text NOT NULL,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "message_content" text NOT NULL,
  "recipient_phone" text,
  "recipient_email" text,
  "response_received" boolean NOT NULL DEFAULT false,
  "response_received_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_document_chases_company_id"
  ON "document_chases" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_document_chases_requirement_id"
  ON "document_chases" ("requirement_id");
CREATE INDEX IF NOT EXISTS "idx_document_chases_sent_at"
  ON "document_chases" ("sent_at");

CREATE TABLE IF NOT EXISTS "compliance_calendar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "description" text NOT NULL,
  "event_date" timestamp NOT NULL,
  "reminder_days" text NOT NULL DEFAULT '30,14,7,0',
  "status" text NOT NULL DEFAULT 'upcoming',
  "completed_at" timestamp,
  "linked_requirement_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_compliance_calendar_company_id"
  ON "compliance_calendar" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_compliance_calendar_event_date"
  ON "compliance_calendar" ("event_date");

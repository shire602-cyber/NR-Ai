-- WhatsApp Web extension bridge: audited human-in-the-loop message drafting.

CREATE TABLE IF NOT EXISTS "whatsapp_bridge_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "extension_id" text NOT NULL,
  "extension_version" text,
  "status" text DEFAULT 'active' NOT NULL,
  "user_agent" text,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_company_id" ON "whatsapp_bridge_sessions" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_user_id" ON "whatsapp_bridge_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_status" ON "whatsapp_bridge_sessions" ("status");

CREATE TABLE IF NOT EXISTS "whatsapp_bridge_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "session_id" uuid REFERENCES "whatsapp_bridge_sessions"("id") ON DELETE set null,
  "whatsapp_message_id" uuid REFERENCES "whatsapp_messages"("id") ON DELETE set null,
  "provider" text DEFAULT 'whatsapp_web_extension' NOT NULL,
  "kind" text DEFAULT 'direct_message' NOT NULL,
  "recipient_phone" text NOT NULL,
  "normalized_recipient_phone" text NOT NULL,
  "recipient_name" text,
  "message_body" text NOT NULL,
  "attachment_url" text,
  "attachment_label" text,
  "source_type" text,
  "source_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "delivery_status" text DEFAULT 'logged' NOT NULL,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "drafted_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_company_id" ON "whatsapp_bridge_jobs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_created_by" ON "whatsapp_bridge_jobs" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_status" ON "whatsapp_bridge_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_recipient" ON "whatsapp_bridge_jobs" ("normalized_recipient_phone");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_source" ON "whatsapp_bridge_jobs" ("source_type", "source_id");

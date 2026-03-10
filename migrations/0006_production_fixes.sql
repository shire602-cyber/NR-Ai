-- Migration 0006: Production hardening fixes
-- Adds status_changed_at for accurate stale recovery,
-- whatsapp_auth_keys for durable auth state,
-- and missing constraints/indexes.

-- 1. Add status_changed_at to message_queue for accurate stale message recovery
--    Previously used created_at which could misidentify legitimately sending messages
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp DEFAULT now();
--> statement-breakpoint
-- Backfill existing rows: use created_at as initial value
UPDATE "message_queue" SET "status_changed_at" = "created_at" WHERE "status_changed_at" IS NULL;
--> statement-breakpoint
-- 2. Create whatsapp_auth_keys table for durable Baileys signal protocol key storage
--    Replaces ephemeral filesystem storage (.whatsapp-auth/) that breaks on deploy
CREATE TABLE IF NOT EXISTS "whatsapp_auth_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "whatsapp_web_sessions"("id") ON DELETE CASCADE,
  "key_type" text NOT NULL,
  "key_id" text NOT NULL,
  "key_data" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Unique constraint on (session_id, key_type, key_id) for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS "idx_whatsapp_auth_keys_session_type_id"
  ON "whatsapp_auth_keys" ("session_id", "key_type", "key_id");
--> statement-breakpoint
-- Index for efficient key lookups by session and type
CREATE INDEX IF NOT EXISTS "idx_whatsapp_auth_keys_lookup"
  ON "whatsapp_auth_keys" ("session_id", "key_type");
--> statement-breakpoint
-- 3. Unique constraint on whatsapp_web_sessions.session_name (prevents duplicate sessions)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_whatsapp_web_sessions_name_unique"
  ON "whatsapp_web_sessions" ("session_name");
--> statement-breakpoint
-- 4. Index for stale message recovery (status_changed_at on 'sending' messages)
CREATE INDEX IF NOT EXISTS "idx_message_queue_stale_recovery"
  ON "message_queue" ("status", "status_changed_at") WHERE status = 'sending';
--> statement-breakpoint
-- 5. Index for overdue invoice lookups (both 'sent' and 'overdue' statuses)
CREATE INDEX IF NOT EXISTS "idx_service_invoices_overdue"
  ON "service_invoices" ("status", "due_date") WHERE status IN ('sent', 'overdue');
--> statement-breakpoint
-- 6. Move unique constraints from migration 0005 into this migration
--    if they don't already exist (idempotent via IF NOT EXISTS)
--    This ensures ON CONFLICT clauses in seed data work correctly
CREATE UNIQUE INDEX IF NOT EXISTS "idx_scheduled_jobs_name_unique"
  ON "scheduled_jobs" ("job_name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_message_templates_name_language_unique"
  ON "message_templates" ("name", "language");

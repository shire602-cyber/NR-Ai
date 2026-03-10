-- ═══════════════════════════════════════════════════════════════
-- Migration 0005: Add indexes, unique constraints, and ON DELETE rules
-- Fixes performance and data integrity issues identified in code review.
-- ═══════════════════════════════════════════════════════════════

-- ── Scheduled Jobs ────────────────────────────────────────────
-- Unique constraint on job_name (prevents duplicate job records)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_scheduled_jobs_job_name"
  ON "scheduled_jobs" ("job_name");
--> statement-breakpoint

-- ── Message Templates ─────────────────────────────────────────
-- Unique constraint on (name, language) for template lookup
CREATE UNIQUE INDEX IF NOT EXISTS "idx_message_templates_name_language"
  ON "message_templates" ("name", "language");
--> statement-breakpoint

-- ── Message Queue ─────────────────────────────────────────────
-- Index on status for queue processing query (WHERE status = 'queued')
CREATE INDEX IF NOT EXISTS "idx_message_queue_status"
  ON "message_queue" ("status");
--> statement-breakpoint
-- Composite index for queue ordering (priority ASC, created_at ASC)
CREATE INDEX IF NOT EXISTS "idx_message_queue_priority_created"
  ON "message_queue" ("priority", "created_at")
  WHERE "status" = 'queued';
--> statement-breakpoint
-- Index on company_id for FK lookups
CREATE INDEX IF NOT EXISTS "idx_message_queue_company_id"
  ON "message_queue" ("company_id");
--> statement-breakpoint

-- ── News Translations ─────────────────────────────────────────
-- Index on news_id for translation lookups
CREATE INDEX IF NOT EXISTS "idx_news_translations_news_id"
  ON "news_translations" ("news_id");
--> statement-breakpoint
-- Index on is_approved for pending translations query
CREATE INDEX IF NOT EXISTS "idx_news_translations_is_approved"
  ON "news_translations" ("is_approved")
  WHERE "is_approved" = false;
--> statement-breakpoint

-- ── Cross-Sell Targets ────────────────────────────────────────
-- Index on campaign_id (FK + query target)
CREATE INDEX IF NOT EXISTS "idx_cross_sell_targets_campaign_id"
  ON "cross_sell_targets" ("campaign_id");
--> statement-breakpoint
-- Index on company_id
CREATE INDEX IF NOT EXISTS "idx_cross_sell_targets_company_id"
  ON "cross_sell_targets" ("company_id");
--> statement-breakpoint
-- Unique constraint on (campaign_id, company_id) to prevent duplicate targets
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cross_sell_targets_campaign_company"
  ON "cross_sell_targets" ("campaign_id", "company_id");
--> statement-breakpoint

-- ── Cross-Sell Campaigns ──────────────────────────────────────
-- Index on status for filtering
CREATE INDEX IF NOT EXISTS "idx_cross_sell_campaigns_status"
  ON "cross_sell_campaigns" ("status");
--> statement-breakpoint

-- ── Reminder Logs ─────────────────────────────────────────────
-- Index on related_entity for efficient dedup queries
CREATE INDEX IF NOT EXISTS "idx_reminder_logs_entity"
  ON "reminder_logs" ("related_entity_id", "related_entity_type");
--> statement-breakpoint

-- ── Regulatory News ───────────────────────────────────────────
-- Index on title for duplicate detection
CREATE INDEX IF NOT EXISTS "idx_regulatory_news_title"
  ON "regulatory_news" (lower("title"));

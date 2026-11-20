-- 0115_f8_event_outbox (F8; W1-A platform residual): durable transactional domain-event outbox.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS only, so re-running the file changes nothing.
--
-- Domain events that must not be lost (bill.approved, bill.paid, payroll.approved, payroll.paid,
-- task.due) are written to domain_event_outbox inside the document's own transaction
-- (server/platform/event-outbox.ts): a rolled-back document leaves no event, a committed one
-- always has its event. The "events.outboxDispatch" job delivers pending rows to the in-process
-- handlers with exponential backoff and dead-letters a row after max_attempts.
-- domain_event_deliveries records each (event, handler) that succeeded, so a retried or
-- duplicate dispatch never runs a handler twice for the same event id.
CREATE TABLE IF NOT EXISTS "domain_event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "company_id" uuid,
  "entity_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "locked_until" timestamp,
  "last_error" text,
  "dispatched_at" timestamp,
  "dead_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_domain_event_outbox_due"
  ON "domain_event_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "idx_domain_event_outbox_company"
  ON "domain_event_outbox" ("company_id", "created_at");

CREATE TABLE IF NOT EXISTS "domain_event_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "domain_event_outbox"("id") ON DELETE CASCADE,
  "handler" text NOT NULL,
  "delivered_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_domain_event_deliveries_event_handler"
  ON "domain_event_deliveries" ("event_id", "handler");

-- 0103_w4d_portals_comms (W4-D): customer portal, dunning, email outbox, notifications,
-- document vault, online invoice payment. Idempotent.
--  * email_outbox (+ attachments, delivery events): durable queue with retry/backoff, dead
--    letter, provider message id and bounce/complaint state (R16-08, R16-17, R13-33)
--  * portal_access_tokens: hashed, revocable, expiring portal links and OTP sessions; existing
--    plaintext customer_contacts.portal_access_token values are hashed across and cleared (R16-07)
--  * portal_login_codes, portal_access_log, customer_portal_accounts, portal_quote_responses
--    (R16-05, R16-07, R16-16)
--  * invoices/quotes.contact_id backfilled by exact (trimmed, case-insensitive) name match when
--    exactly one contact matches; ambiguous rows are listed in portal_contact_backfill_findings
--    (R16-06)
--  * messages: contact-bound, customer-visible threads (R16-05)
--  * documents: storage key, checksum, soft delete, file versions (R16-09)
--  * document_versions: renumber duplicates, unique version per document (R16-10)
--  * push_subscriptions: one row per (user, endpoint) (R16-11)
--  * notification preferences per type, digest; notification idempotency key (R13-32, R16-18)
--  * reminder settings: language/attachment/pay-link; reminder_logs: level + outbox id with a
--    unique dunning key (R16-02, R16-03)
--  * payment_links + payment_gateway_events (R16-14)

-- ── email outbox ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,
  "to_address" text NOT NULL,
  "cc" text,
  "reply_to" text,
  "from_name" text,
  "subject" text NOT NULL,
  "html" text,
  "text_body" text,
  "category" text NOT NULL DEFAULT 'generic',
  "related_entity_type" text,
  "related_entity_id" uuid,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 6,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(),
  "locked_until" timestamp,
  "last_error" text,
  "provider" text,
  "provider_message_id" text,
  "sensitive" boolean NOT NULL DEFAULT false,
  "idempotency_key" text,
  "sent_at" timestamp,
  "delivered_at" timestamp,
  "bounced_at" timestamp,
  "complained_at" timestamp,
  "dead_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "email_outbox_status_check" CHECK ("status" IN (
    'queued', 'sending', 'retrying', 'sent', 'delivered', 'bounced', 'complained', 'dead',
    'blocked_no_provider', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_outbox_idempotency"
  ON "email_outbox" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_outbox_due" ON "email_outbox" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_outbox_provider_msg"
  ON "email_outbox" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_outbox_company" ON "email_outbox" ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_outbox_related"
  ON "email_outbox" ("related_entity_type", "related_entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_outbox_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "outbox_id" uuid NOT NULL REFERENCES "email_outbox"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "content_type" text NOT NULL DEFAULT 'application/octet-stream',
  "content" bytea NOT NULL,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_outbox_attachments_outbox"
  ON "email_outbox_attachments" ("outbox_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_delivery_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "outbox_id" uuid REFERENCES "email_outbox"("id") ON DELETE CASCADE,
  "provider" text,
  "provider_message_id" text,
  "event_type" text NOT NULL,
  "detail" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_delivery_events_outbox" ON "email_delivery_events" ("outbox_id");
--> statement-breakpoint

-- ── portal tokens (hashed) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "portal_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'link',
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "last_used_at" timestamp,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "portal_access_tokens_kind_check" CHECK ("kind" IN ('link', 'session'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_portal_access_tokens_hash" ON "portal_access_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_access_tokens_contact" ON "portal_access_tokens" ("contact_id");
--> statement-breakpoint
-- Existing plaintext tokens: hash them across (keeping the earlier of their expiry and the new
-- 90-day default), then clear the plaintext column.
INSERT INTO "portal_access_tokens" ("company_id", "contact_id", "token_hash", "kind", "expires_at")
SELECT c."company_id", c."id", encode(sha256(convert_to(c."portal_access_token", 'UTF8')), 'hex'),
       'link',
       LEAST(COALESCE(c."portal_access_expires_at", now() + interval '90 days'), now() + interval '90 days')
  FROM "customer_contacts" c
 WHERE c."portal_access_token" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "customer_contacts" SET "portal_access_token" = NULL WHERE "portal_access_token" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "do_not_chase" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "preferred_language" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_login_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_login_codes_email" ON "portal_login_codes" ("email", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_access_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "token_id" uuid REFERENCES "portal_access_tokens"("id") ON DELETE SET NULL,
  "ip" text,
  "method" text,
  "path" text,
  "outcome" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_access_log_company" ON "portal_access_log" ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_access_log_ip" ON "portal_access_log" ("ip", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_portal_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_portal_accounts_user"
  ON "customer_portal_accounts" ("company_id", "user_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_quote_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "decision" text NOT NULL,
  "signer_name" text,
  "comment" text,
  "ip" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "portal_quote_responses_decision_check" CHECK ("decision" IN ('accepted', 'declined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_portal_quote_responses_quote" ON "portal_quote_responses" ("quote_id");
--> statement-breakpoint

-- ── R16-06: bind documents to contacts by id ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "portal_contact_backfill_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,
  "customer_name" text,
  "candidate_count" integer NOT NULL,
  "candidate_contact_ids" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_portal_contact_backfill_findings_doc"
  ON "portal_contact_backfill_findings" ("document_type", "document_id");
--> statement-breakpoint
WITH m AS (
  SELECT i."id" AS doc_id, i."company_id", i."customer_name",
         array_agg(c."id"::text ORDER BY c."created_at", c."id") AS ids, count(*) AS n
    FROM "invoices" i
    JOIN "customer_contacts" c
      ON c."company_id" = i."company_id"
     AND lower(trim(c."name")) = lower(trim(i."customer_name"))
   WHERE i."contact_id" IS NULL
   GROUP BY i."id", i."company_id", i."customer_name"
)
INSERT INTO "portal_contact_backfill_findings"
  ("company_id", "document_type", "document_id", "customer_name", "candidate_count", "candidate_contact_ids")
SELECT m."company_id", 'invoice', m.doc_id, m."customer_name", m.n, array_to_string(m.ids, ',')
  FROM m WHERE m.n > 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "invoices" i SET "contact_id" = m.cid
  FROM (
    SELECT i2."id" AS doc_id, (array_agg(c."id"))[1] AS cid, count(*) AS n
      FROM "invoices" i2
      JOIN "customer_contacts" c
        ON c."company_id" = i2."company_id"
       AND lower(trim(c."name")) = lower(trim(i2."customer_name"))
     WHERE i2."contact_id" IS NULL
     GROUP BY i2."id"
  ) m
 WHERE i."id" = m.doc_id AND m.n = 1 AND i."contact_id" IS NULL;
--> statement-breakpoint
WITH m AS (
  SELECT q."id" AS doc_id, q."company_id", q."customer_name",
         array_agg(c."id"::text ORDER BY c."created_at", c."id") AS ids, count(*) AS n
    FROM "quotes" q
    JOIN "customer_contacts" c
      ON c."company_id" = q."company_id"
     AND lower(trim(c."name")) = lower(trim(q."customer_name"))
   WHERE q."contact_id" IS NULL
   GROUP BY q."id", q."company_id", q."customer_name"
)
INSERT INTO "portal_contact_backfill_findings"
  ("company_id", "document_type", "document_id", "customer_name", "candidate_count", "candidate_contact_ids")
SELECT m."company_id", 'quote', m.doc_id, m."customer_name", m.n, array_to_string(m.ids, ',')
  FROM m WHERE m.n > 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "quotes" q SET "contact_id" = m.cid
  FROM (
    SELECT q2."id" AS doc_id, (array_agg(c."id"))[1] AS cid, count(*) AS n
      FROM "quotes" q2
      JOIN "customer_contacts" c
        ON c."company_id" = q2."company_id"
       AND lower(trim(c."name")) = lower(trim(q2."customer_name"))
     WHERE q2."contact_id" IS NULL
     GROUP BY q2."id"
  ) m
 WHERE q."id" = m.doc_id AND m.n = 1 AND q."contact_id" IS NULL;
--> statement-breakpoint

-- ── messages: customer-visible threads are bound to a contact ─────────────────
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "contact_id" uuid
  REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'internal';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_contact" ON "messages" ("company_id", "contact_id")
  WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint

-- ── documents: real storage, soft delete, file versions ───────────────────────
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storage_key" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "current_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "contact_id" uuid
  REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'staff';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_file_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "note" text,
  "uploaded_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_document_file_versions" UNIQUE ("document_id", "version")
);
--> statement-breakpoint

-- ── R16-10: document_versions numbering is unique ─────────────────────────────
UPDATE "document_versions" dv SET "version" = r.rn
  FROM (
    SELECT "id", row_number() OVER (
             PARTITION BY "company_id", "document_type", "document_id"
             ORDER BY "version", "created_at", "id") AS rn
      FROM "document_versions"
  ) r
 WHERE dv."id" = r."id" AND dv."version" <> r.rn;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_versions_number"
  ON "document_versions" ("company_id", "document_type", "document_id", "version");
--> statement-breakpoint

-- ── R16-11: one push subscription per (user, endpoint) ───────────────────────
DELETE FROM "push_subscriptions" p
 USING "push_subscriptions" q
 WHERE p."user_id" = q."user_id" AND p."endpoint" = q."endpoint"
   AND (p."created_at", p."id") < (q."created_at", q."id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_push_subscriptions_user_endpoint"
  ON "push_subscriptions" ("user_id", "endpoint");
--> statement-breakpoint

-- ── notifications: per-type preferences, digest, idempotency ──────────────────
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "in_app_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "type_preferences" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "digest_frequency" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "last_digest_at" timestamp;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "event_key" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "digested_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_event_key"
  ON "notifications" ("user_id", "event_key") WHERE "event_key" IS NOT NULL;
--> statement-breakpoint

-- ── dunning: reminder settings + idempotent reminder log ──────────────────────
ALTER TABLE "reminder_settings" ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'bilingual';
--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN IF NOT EXISTS "attach_pdf" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN IF NOT EXISTS "include_pay_link" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD COLUMN IF NOT EXISTS "level" integer;
--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD COLUMN IF NOT EXISTS "outbox_id" uuid
  REFERENCES "email_outbox"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD COLUMN IF NOT EXISTS "contact_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_reminder_logs_dunning_level"
  ON "reminder_logs" ("reminder_setting_id", "related_entity_id", "channel", "level")
  WHERE "reminder_setting_id" IS NOT NULL AND "level" IS NOT NULL;
--> statement-breakpoint

-- ── R16-14: online invoice payment ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "token_hash" text NOT NULL,
  "amount_fils" bigint NOT NULL,
  "currency" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "expires_at" timestamp NOT NULL,
  "provider_session_id" text,
  "provider_url" text,
  "deposit_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "invoice_payment_id" uuid,
  "paid_amount_fils" bigint,
  "fee_fils" bigint,
  "fee_journal_entry_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "paid_at" timestamp,
  CONSTRAINT "payment_links_status_check" CHECK ("status" IN
    ('active', 'processing', 'paid', 'expired', 'cancelled')),
  CONSTRAINT "payment_links_amount_check" CHECK ("amount_fils" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_links_token" ON "payment_links" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_links_invoice" ON "payment_links" ("invoice_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_links_provider_session"
  ON "payment_links" ("provider", "provider_session_id") WHERE "provider_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_gateway_events" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "type" text NOT NULL,
  "payment_link_id" uuid REFERENCES "payment_links"("id") ON DELETE SET NULL,
  "outcome" text NOT NULL DEFAULT 'received',
  "detail" text,
  "received_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("provider", "event_id")
);

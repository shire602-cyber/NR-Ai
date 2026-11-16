-- 0108_w5d_firm (W5-D): multi-firm tenancy (firms, firm_members, firm_client_links,
-- firm_company_grants), firm-scoped leads / engagements / service invoices, practice workflow
-- (task templates, firm tasks, document request lists, engagement letters and proposals, time
-- entries) and manual FTA filing records. NR is seeded as the first firm (is_nr = true) and all
-- existing firm data is backfilled to it.
-- Idempotent: every statement can run twice.

-- ── firms ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "firms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "is_nr" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'pending',
  "trn" text,
  "contact_email" text,
  "contact_phone" text,
  "country" text NOT NULL DEFAULT 'AE',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp,
  "rejection_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firms_status_check" CHECK ("status" IN ('pending', 'active', 'rejected', 'suspended'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firms_slug" ON "firms" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firms_single_nr" ON "firms" ("is_nr") WHERE "is_nr" = true;

INSERT INTO "firms" ("id", "name", "slug", "is_nr", "status", "approved_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'NR Accounting', 'nr-accounting', true, 'active', now())
ON CONFLICT DO NOTHING;

-- ── firm_members: one firm per user ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "firm_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_members_role_check"
    CHECK ("role" IN ('firm_owner', 'firm_admin', 'preparer', 'reviewer', 'viewer'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_members_user" ON "firm_members" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_firm_members_firm" ON "firm_members" ("firm_id");

INSERT INTO "firm_members" ("firm_id", "user_id", "role")
SELECT '00000000-0000-4000-8000-000000000001', u."id", u."firm_role"
  FROM "users" u
 WHERE u."firm_role" IN ('firm_owner', 'firm_admin', 'preparer', 'reviewer', 'viewer')
ON CONFLICT DO NOTHING;

-- ── firm_client_links: which firm manages which company (invitation lifecycle) ──────────
CREATE TABLE IF NOT EXISTS "firm_client_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "invitee_email" text,
  "status" text NOT NULL DEFAULT 'invited',
  "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "message" text,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "invited_at" timestamp NOT NULL DEFAULT now(),
  "accepted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_at" timestamp,
  "revoked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamp,
  "revoke_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_client_links_status_check"
    CHECK ("status" IN ('invited', 'active', 'revoked', 'declined')),
  CONSTRAINT "firm_client_links_target_check"
    CHECK ("company_id" IS NOT NULL OR "invitee_email" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "idx_firm_client_links_firm" ON "firm_client_links" ("firm_id", "status");
CREATE INDEX IF NOT EXISTS "idx_firm_client_links_company" ON "firm_client_links" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_firm_client_links_email" ON "firm_client_links" (lower("invitee_email"));
-- A company is managed by at most one firm at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_client_links_active_company"
  ON "firm_client_links" ("company_id") WHERE "status" = 'active';

INSERT INTO "firm_client_links" ("firm_id", "company_id", "status", "accepted_at")
SELECT '00000000-0000-4000-8000-000000000001', c."id", 'active', now()
  FROM "companies" c
 WHERE c."company_type" = 'client'
   AND c."deleted_at" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "firm_client_links" l WHERE l."company_id" = c."id")
ON CONFLICT DO NOTHING;

-- ── firm_company_grants: company_users rows the firm created (removed on revoke) ────────
CREATE TABLE IF NOT EXISTS "firm_company_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "created_membership" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_company_grants"
  ON "firm_company_grants" ("firm_id", "user_id", "company_id");

INSERT INTO "firm_company_grants" ("firm_id", "user_id", "company_id", "created_membership")
SELECT '00000000-0000-4000-8000-000000000001', cu."user_id", cu."company_id", true
  FROM "company_users" cu
  JOIN "users" u ON u."id" = cu."user_id"
  JOIN "companies" c ON c."id" = cu."company_id"
 WHERE u."firm_role" IN ('firm_owner', 'firm_admin')
   AND c."company_type" = 'client'
ON CONFLICT DO NOTHING;

-- ── firm-scoped existing tables ─────────────────────────────────────────────────────────
ALTER TABLE "firm_leads" ADD COLUMN IF NOT EXISTS "firm_id" uuid;
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "firm_id" uuid;
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(15,2);
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "next_billing_date" date;
ALTER TABLE "service_invoices" ADD COLUMN IF NOT EXISTS "firm_id" uuid;
ALTER TABLE "service_invoices" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "service_invoices" ADD COLUMN IF NOT EXISTS "source_key" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firm_leads_firm_id_fk') THEN
    ALTER TABLE "firm_leads" ADD CONSTRAINT "firm_leads_firm_id_fk"
      FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagements_firm_id_fk') THEN
    ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_id_fk"
      FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_invoices_firm_id_fk') THEN
    ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_firm_id_fk"
      FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE SET NULL;
  END IF;
END $$;
UPDATE "firm_leads" SET "firm_id" = '00000000-0000-4000-8000-000000000001' WHERE "firm_id" IS NULL;
UPDATE "engagements" SET "firm_id" = '00000000-0000-4000-8000-000000000001' WHERE "firm_id" IS NULL;
UPDATE "service_invoices" SET "firm_id" = '00000000-0000-4000-8000-000000000001' WHERE "firm_id" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_firm_leads_firm" ON "firm_leads" ("firm_id");
CREATE INDEX IF NOT EXISTS "idx_engagements_firm" ON "engagements" ("firm_id");
CREATE INDEX IF NOT EXISTS "idx_service_invoices_firm" ON "service_invoices" ("firm_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_invoices_source_key"
  ON "service_invoices" ("firm_id", "source_key") WHERE "source_key" IS NOT NULL;

-- ── practice workflow: recurring task templates and generated tasks ─────────────────────
CREATE TABLE IF NOT EXISTS "firm_task_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "cadence" text NOT NULL,
  "due_days_after_period" integer NOT NULL DEFAULT 28,
  "applies_to" text NOT NULL DEFAULT 'all',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_task_templates_cadence_check"
    CHECK ("cadence" IN ('monthly', 'quarterly', 'annual', 'vat_period')),
  CONSTRAINT "firm_task_templates_applies_check"
    CHECK ("applies_to" IN ('all', 'vat_registered', 'ct_registered', 'payroll'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_task_templates_code"
  ON "firm_task_templates" ("firm_id", "code");

CREATE TABLE IF NOT EXISTS "firm_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "template_id" uuid REFERENCES "firm_task_templates"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "period_start" date,
  "period_end" date,
  "due_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" text NOT NULL DEFAULT 'manual',
  "source_key" text,
  "completed_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_tasks_status_check"
    CHECK ("status" IN ('open', 'in_progress', 'review', 'done', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "idx_firm_tasks_firm_due" ON "firm_tasks" ("firm_id", "due_date");
CREATE INDEX IF NOT EXISTS "idx_firm_tasks_company" ON "firm_tasks" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_tasks_source_key"
  ON "firm_tasks" ("firm_id", "source_key") WHERE "source_key" IS NOT NULL;

-- ── request lists: documents requested from a client ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "firm_document_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "list_name" text NOT NULL DEFAULT 'General',
  "title" text NOT NULL,
  "description" text,
  "due_date" date,
  "status" text NOT NULL DEFAULT 'requested',
  "document_id" uuid,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamp,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_document_requests_status_check"
    CHECK ("status" IN ('requested', 'uploaded', 'accepted', 'rejected', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "idx_firm_document_requests_company"
  ON "firm_document_requests" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_firm_document_requests_firm" ON "firm_document_requests" ("firm_id");

-- ── engagement letters and proposals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "firm_engagement_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'engagement',
  "body" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_engagement_templates_kind_check" CHECK ("kind" IN ('engagement', 'proposal'))
);
CREATE INDEX IF NOT EXISTS "idx_firm_engagement_templates_firm" ON "firm_engagement_templates" ("firm_id");

CREATE TABLE IF NOT EXISTS "firm_engagement_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "template_id" uuid REFERENCES "firm_engagement_templates"("id") ON DELETE SET NULL,
  "engagement_id" uuid REFERENCES "engagements"("id") ON DELETE SET NULL,
  "kind" text NOT NULL DEFAULT 'engagement',
  "title" text NOT NULL,
  "body" text NOT NULL,
  "fee_amount" numeric(15,2),
  "billing_cycle" text,
  "status" text NOT NULL DEFAULT 'draft',
  "sent_at" timestamp,
  "responded_at" timestamp,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_name" text,
  "accepted_ip" text,
  "accepted_user_agent" text,
  "esign_provider" text,
  "esign_status" text NOT NULL DEFAULT 'requires_external',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_engagement_letters_kind_check" CHECK ("kind" IN ('engagement', 'proposal')),
  CONSTRAINT "firm_engagement_letters_status_check"
    CHECK ("status" IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn'))
);
CREATE INDEX IF NOT EXISTS "idx_firm_engagement_letters_company"
  ON "firm_engagement_letters" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_firm_engagement_letters_firm" ON "firm_engagement_letters" ("firm_id");

-- ── time tracking ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "firm_time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "task_id" uuid REFERENCES "firm_tasks"("id") ON DELETE SET NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entry_date" date NOT NULL,
  "minutes" integer NOT NULL DEFAULT 0,
  "description" text,
  "billable" boolean NOT NULL DEFAULT true,
  "hourly_rate" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'logged',
  "started_at" timestamp,
  "stopped_at" timestamp,
  "service_invoice_id" uuid REFERENCES "service_invoices"("id") ON DELETE SET NULL,
  "billed_amount" numeric(15,2),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_time_entries_status_check"
    CHECK ("status" IN ('running', 'logged', 'billed', 'written_off')),
  CONSTRAINT "firm_time_entries_minutes_check" CHECK ("minutes" >= 0 AND "minutes" <= 1440)
);
CREATE INDEX IF NOT EXISTS "idx_firm_time_entries_company" ON "firm_time_entries" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_firm_time_entries_firm" ON "firm_time_entries" ("firm_id", "entry_date");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_time_entries_running"
  ON "firm_time_entries" ("user_id") WHERE "status" = 'running';

-- ── manual FTA filing records (no EmaraTax API exists) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "firm_filing_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "filing_type" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "filed_on" date NOT NULL,
  "reference_number" text NOT NULL,
  "checklist" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "firm_filing_records_type_check" CHECK ("filing_type" IN ('vat201', 'ct', 'faf'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_firm_filing_records_period"
  ON "firm_filing_records" ("company_id", "filing_type", "period_start", "period_end");

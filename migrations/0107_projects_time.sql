-- 0107_projects_time: projects, tasks, time entries and billable costs. Additive and idempotent.
--
-- A project belongs to a customer contact, bills time by the hour (or is non-billable) and carries a budget.
-- Time is entered by hand or with a timer (one running timer per user and company). Costs reach a project from
-- bill lines and expense-claim items tagged with project_id; project_expenses rows are created when the bill or
-- claim is finally approved, so only costs that are on the ledger can be billed on. journal_lines.project_id is what
-- project profitability reads. Billing links to the invoice, not the line, because invoice edits re-insert lines:
-- an entry is unbilled while billed_invoice_id is NULL or that invoice is void or cancelled.

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'active',
  "billing_method" text NOT NULL DEFAULT 'hourly',
  "hourly_rate" numeric(15,2),
  "currency" text NOT NULL DEFAULT 'AED',
  "budget_amount" numeric(15,2),
  "budget_hours" numeric(10,2),
  "start_date" date,
  "end_date" date,
  "description" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "projects_company_code_unique" UNIQUE ("company_id", "code"),
  CONSTRAINT "projects_status_check" CHECK ("status" IN ('active', 'on_hold', 'completed', 'cancelled')),
  CONSTRAINT "projects_billing_method_check" CHECK ("billing_method" IN ('hourly', 'non_billable')),
  CONSTRAINT "projects_rate_check" CHECK ("hourly_rate" IS NULL OR "hourly_rate" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_projects_company_status" ON "projects"("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_projects_contact" ON "projects"("contact_id");

CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "hourly_rate" numeric(15,2),
  "is_billable" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "project_tasks_status_check" CHECK ("status" IN ('open', 'done'))
);
CREATE INDEX IF NOT EXISTS "idx_project_tasks_project" ON "project_tasks"("project_id");

CREATE TABLE IF NOT EXISTS "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "task_id" uuid REFERENCES "project_tasks"("id") ON DELETE SET NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "entry_date" date NOT NULL,
  "minutes" integer NOT NULL DEFAULT 0,
  "started_at" timestamp,
  "ended_at" timestamp,
  "is_billable" boolean NOT NULL DEFAULT true,
  "rate" numeric(15,2),
  "notes" text,
  "billed_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "time_entries_minutes_check" CHECK ("minutes" BETWEEN 0 AND 1440)
);
CREATE INDEX IF NOT EXISTS "idx_time_entries_company_project_date" ON "time_entries"("company_id", "project_id", "entry_date");
CREATE INDEX IF NOT EXISTS "idx_time_entries_billed_invoice" ON "time_entries"("billed_invoice_id");
-- one running timer per user and company
CREATE UNIQUE INDEX IF NOT EXISTS "uq_time_entries_running_timer"
  ON "time_entries"("company_id", "user_id") WHERE "ended_at" IS NULL AND "started_at" IS NOT NULL;

ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "is_billable" boolean NOT NULL DEFAULT false;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "is_billable" boolean NOT NULL DEFAULT false;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
-- a project with postings cannot be deleted (RESTRICT)
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id");
CREATE INDEX IF NOT EXISTS "idx_journal_lines_project" ON "journal_lines"("project_id") WHERE "project_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "project_expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "source_type" text NOT NULL,
  "bill_line_item_id" uuid REFERENCES "bill_line_items"("id") ON DELETE CASCADE,
  "expense_claim_item_id" uuid REFERENCES "expense_claim_items"("id") ON DELETE CASCADE,
  "expense_date" date NOT NULL,
  "description" text NOT NULL,
  "amount_aed" numeric(15,2) NOT NULL,
  "is_billable" boolean NOT NULL DEFAULT false,
  "billed_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "project_expenses_source_check" CHECK ("source_type" IN ('bill_line', 'expense_claim_item')),
  CONSTRAINT "project_expenses_one_source_check" CHECK (
    ("source_type" = 'bill_line' AND "bill_line_item_id" IS NOT NULL AND "expense_claim_item_id" IS NULL)
    OR ("source_type" = 'expense_claim_item' AND "expense_claim_item_id" IS NOT NULL AND "bill_line_item_id" IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_expenses_bill_line" ON "project_expenses"("bill_line_item_id") WHERE "bill_line_item_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_expenses_claim_item" ON "project_expenses"("expense_claim_item_id") WHERE "expense_claim_item_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_project_expenses_project" ON "project_expenses"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "idx_project_expenses_billed_invoice" ON "project_expenses"("billed_invoice_id");

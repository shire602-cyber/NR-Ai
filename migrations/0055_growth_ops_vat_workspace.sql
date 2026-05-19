-- Internal NRA revenue-ops opportunities and VAT workpaper workspace.

CREATE TABLE IF NOT EXISTS "firm_growth_opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE cascade,
  "prospect_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "source_key" text NOT NULL UNIQUE,
  "opportunity_type" text NOT NULL,
  "source_signal" text NOT NULL,
  "title" text NOT NULL,
  "reason" text NOT NULL,
  "estimated_value" numeric(15,2) DEFAULT 0 NOT NULL,
  "confidence" real DEFAULT 0.5 NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "due_date" timestamp,
  "snoozed_until" timestamp,
  "resolved_at" timestamp,
  "resolution_note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_firm_growth_opportunities_company_id" ON "firm_growth_opportunities" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_firm_growth_opportunities_status" ON "firm_growth_opportunities" ("status");
CREATE INDEX IF NOT EXISTS "idx_firm_growth_opportunities_priority" ON "firm_growth_opportunities" ("priority");
CREATE INDEX IF NOT EXISTS "idx_firm_growth_opportunities_owner" ON "firm_growth_opportunities" ("owner_user_id");

CREATE TABLE IF NOT EXISTS "firm_growth_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL REFERENCES "firm_growth_opportunities"("id") ON DELETE cascade,
  "action_type" text NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "channel" text DEFAULT 'internal' NOT NULL,
  "delivery_state" text DEFAULT 'logged' NOT NULL,
  "note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_firm_growth_actions_opportunity_id" ON "firm_growth_actions" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "idx_firm_growth_actions_actor" ON "firm_growth_actions" ("actor_user_id");

CREATE TABLE IF NOT EXISTS "vat_workpapers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "due_date" timestamp NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "reviewer_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "generated_vat_return_id" uuid REFERENCES "vat_returns"("id") ON DELETE set null,
  "totals_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vat_workpapers_company_period_unique" UNIQUE ("company_id", "period_start", "period_end")
);
CREATE INDEX IF NOT EXISTS "idx_vat_workpapers_company_id" ON "vat_workpapers" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_vat_workpapers_status" ON "vat_workpapers" ("status");
CREATE INDEX IF NOT EXISTS "idx_vat_workpapers_due_date" ON "vat_workpapers" ("due_date");

CREATE TABLE IF NOT EXISTS "vat_workpaper_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workpaper_id" uuid NOT NULL REFERENCES "vat_workpapers"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "row_category" text NOT NULL,
  "vat201_box" text NOT NULL,
  "invoice_number" text,
  "document_date" timestamp,
  "counterparty_name" text,
  "counterparty_trn" text,
  "emirate" text,
  "taxable_amount" numeric(15,2) DEFAULT 0 NOT NULL,
  "vat_amount" numeric(15,2) DEFAULT 0 NOT NULL,
  "adjustment_amount" numeric(15,2) DEFAULT 0 NOT NULL,
  "gross_amount" numeric(15,2) DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "source_method" text DEFAULT 'manual' NOT NULL,
  "source_document_type" text,
  "source_document_id" uuid,
  "notes" text,
  "audit_reason" text,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "reviewed_at" timestamp,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_rows_workpaper_id" ON "vat_workpaper_rows" ("workpaper_id");
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_rows_company_id" ON "vat_workpaper_rows" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_rows_status" ON "vat_workpaper_rows" ("status");
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_rows_category" ON "vat_workpaper_rows" ("row_category");

CREATE TABLE IF NOT EXISTS "vat_workpaper_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workpaper_id" uuid NOT NULL REFERENCES "vat_workpapers"("id") ON DELETE cascade,
  "row_id" uuid REFERENCES "vat_workpaper_rows"("id") ON DELETE cascade,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_path" text,
  "extracted_text" text,
  "extraction_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_attachments_workpaper_id" ON "vat_workpaper_attachments" ("workpaper_id");
CREATE INDEX IF NOT EXISTS "idx_vat_workpaper_attachments_row_id" ON "vat_workpaper_attachments" ("row_id");

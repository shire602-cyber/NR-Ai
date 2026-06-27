-- Cost centers + optional allocation column on journal lines. Idempotent.
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "parent_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cost_centers_company_code_unique" UNIQUE ("company_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_cost_centers_company_id" ON "cost_centers" ("company_id");

ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_journal_lines_cost_center_id" ON "journal_lines" ("cost_center_id");

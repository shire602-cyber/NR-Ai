-- Repair migration: ensure firm_role and firm_staff_assignments exist.
-- All guards are idempotent — safe to run even if 0019 already applied.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firm_role" text;

CREATE TABLE IF NOT EXISTS "firm_staff_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "assigned_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "firm_staff_assignments_user_company_unique" UNIQUE("user_id", "company_id")
);

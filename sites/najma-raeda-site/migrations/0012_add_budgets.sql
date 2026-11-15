CREATE TABLE IF NOT EXISTS "budget_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "fiscal_year" integer NOT NULL,
  "start_date" timestamp NOT NULL,
  "end_date" timestamp NOT NULL,
  "status" text DEFAULT 'draft',
  "notes" text,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "budget_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "budget_id" uuid NOT NULL REFERENCES "budget_plans"("id") ON DELETE CASCADE,
  "account_id" uuid,
  "category" text NOT NULL,
  "description" text,
  "jan" numeric(12,2) DEFAULT 0,
  "feb" numeric(12,2) DEFAULT 0,
  "mar" numeric(12,2) DEFAULT 0,
  "apr" numeric(12,2) DEFAULT 0,
  "may" numeric(12,2) DEFAULT 0,
  "jun" numeric(12,2) DEFAULT 0,
  "jul" numeric(12,2) DEFAULT 0,
  "aug" numeric(12,2) DEFAULT 0,
  "sep" numeric(12,2) DEFAULT 0,
  "oct" numeric(12,2) DEFAULT 0,
  "nov" numeric(12,2) DEFAULT 0,
  "dec" numeric(12,2) DEFAULT 0,
  "annual_total" numeric(12,2) DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);

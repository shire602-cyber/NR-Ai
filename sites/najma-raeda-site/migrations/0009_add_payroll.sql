-- Payroll / WPS Compliance tables

CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_number" text,
  "full_name" text NOT NULL,
  "full_name_ar" text,
  "nationality" text,
  "passport_number" text,
  "visa_number" text,
  "labor_card_number" text,
  "bank_name" text,
  "bank_account_number" text,
  "iban" text,
  "routing_code" text,
  "department" text,
  "designation" text,
  "join_date" timestamp,
  "basic_salary" numeric(12,2) NOT NULL DEFAULT 0,
  "housing_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "transport_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "other_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "total_salary" numeric(12,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "run_date" timestamp DEFAULT now(),
  "total_basic" numeric(12,2) NOT NULL DEFAULT 0,
  "total_allowances" numeric(12,2) NOT NULL DEFAULT 0,
  "total_deductions" numeric(12,2) NOT NULL DEFAULT 0,
  "total_net" numeric(12,2) NOT NULL DEFAULT 0,
  "employee_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "sif_file_content" text,
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "basic_salary" numeric(12,2) NOT NULL DEFAULT 0,
  "housing_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "transport_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "other_allowance" numeric(12,2) NOT NULL DEFAULT 0,
  "overtime" numeric(12,2) NOT NULL DEFAULT 0,
  "deductions" numeric(12,2) NOT NULL DEFAULT 0,
  "deduction_notes" text,
  "net_salary" numeric(12,2) NOT NULL DEFAULT 0,
  "payment_mode" text NOT NULL DEFAULT 'bank_transfer',
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp DEFAULT now() NOT NULL
);

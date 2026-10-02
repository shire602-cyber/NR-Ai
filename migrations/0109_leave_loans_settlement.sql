-- 0109_leave_loans_settlement: leave (UAE Federal Decree-Law 33/2021), employee loans and advances, final
-- settlement, and the payroll columns that carry their deductions. Additive and idempotent.
--
-- Leave balances are derived (accrual + opening + adjustments - approved leave); leave_balances holds only the
-- overrides (an opening balance and manual adjustments). Loan instalments are reserved to a payroll run when it is
-- calculated and become deducted when it is approved. A final settlement posts the gratuity true-up against the
-- 2036 provision, unused leave, the loan still owed and other deductions in one journal entry.

CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text NOT NULL,
  "pay_policy" text NOT NULL DEFAULT 'full',
  "annual_days" numeric(6,2) NOT NULL DEFAULT 0,
  "accrual" text NOT NULL DEFAULT 'annual',
  "carry_forward_max_days" numeric(6,2) NOT NULL DEFAULT 0,
  "allow_negative" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "leave_types_company_code_unique" UNIQUE ("company_id", "code"),
  CONSTRAINT "leave_types_pay_policy_check" CHECK ("pay_policy" IN ('full', 'sick_tiered', 'half', 'unpaid', 'manual')),
  CONSTRAINT "leave_types_accrual_check" CHECK ("accrual" IN ('monthly_service', 'annual', 'none'))
);

CREATE TABLE IF NOT EXISTS "leave_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE CASCADE,
  "leave_year" integer NOT NULL,
  "opening_days" numeric(6,2),
  "adjustment_days" numeric(6,2) NOT NULL DEFAULT 0,
  "note" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "leave_balances_unique" UNIQUE ("employee_id", "leave_type_id", "leave_year")
);

CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days" numeric(6,2) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "decided_by" uuid REFERENCES "users"("id"),
  "decided_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "leave_requests_dates_check" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "leave_requests_days_check" CHECK ("days" > 0),
  CONSTRAINT "leave_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "idx_leave_requests_employee" ON "leave_requests"("company_id", "employee_id", "start_date");

CREATE TABLE IF NOT EXISTS "employee_loans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "loan_number" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'loan',
  "principal" numeric(15,2) NOT NULL,
  "instalment_count" integer NOT NULL,
  "instalment_amount" numeric(15,2) NOT NULL,
  "first_period_year" integer NOT NULL,
  "first_period_month" integer NOT NULL,
  "disbursement_date" date NOT NULL,
  "payment_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "cancel_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "repayment_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "employee_loans_company_number_unique" UNIQUE ("company_id", "loan_number"),
  CONSTRAINT "employee_loans_kind_check" CHECK ("kind" IN ('loan', 'advance')),
  CONSTRAINT "employee_loans_status_check" CHECK ("status" IN ('active', 'settled', 'cancelled')),
  CONSTRAINT "employee_loans_principal_check" CHECK ("principal" > 0),
  CONSTRAINT "employee_loans_count_check" CHECK ("instalment_count" BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS "idx_employee_loans_employee" ON "employee_loans"("company_id", "employee_id", "status");

CREATE TABLE IF NOT EXISTS "employee_loan_installments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "loan_id" uuid NOT NULL REFERENCES "employee_loans"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "deducted_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'scheduled',
  "payroll_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "payroll_item_id" uuid REFERENCES "payroll_items"("id") ON DELETE SET NULL,
  CONSTRAINT "employee_loan_installments_unique" UNIQUE ("loan_id", "sequence"),
  CONSTRAINT "employee_loan_installments_status_check" CHECK ("status" IN ('scheduled', 'reserved', 'deducted', 'settled', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "idx_employee_loan_installments_due" ON "employee_loan_installments"("company_id", "status", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "idx_employee_loan_installments_run" ON "employee_loan_installments"("payroll_run_id");

CREATE TABLE IF NOT EXISTS "employee_final_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "termination_date" date NOT NULL,
  "reason" text NOT NULL DEFAULT 'resignation',
  "basic_salary" numeric(15,2) NOT NULL DEFAULT 0,
  "total_wage" numeric(15,2) NOT NULL DEFAULT 0,
  "is_gcc_national" boolean NOT NULL DEFAULT false,
  "years_of_service" numeric(8,4) NOT NULL DEFAULT 0,
  "gratuity_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "provision_used" numeric(15,2) NOT NULL DEFAULT 0,
  "gratuity_true_up" numeric(15,2) NOT NULL DEFAULT 0,
  "leave_days" numeric(6,2) NOT NULL DEFAULT 0,
  "leave_encashment" numeric(15,2) NOT NULL DEFAULT 0,
  "loan_recovered" numeric(15,2) NOT NULL DEFAULT 0,
  "other_deductions" numeric(15,2) NOT NULL DEFAULT 0,
  "net_payable" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "payment_account_id" uuid REFERENCES "accounts"("id"),
  "paid_date" date,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "payment_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "void_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "employee_final_settlements_status_check" CHECK ("status" IN ('draft', 'posted', 'paid', 'void')),
  CONSTRAINT "employee_final_settlements_reason_check" CHECK ("reason" IN ('resignation', 'termination', 'end_of_contract'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_employee_final_settlements_active"
  ON "employee_final_settlements"("employee_id") WHERE "status" IN ('draft', 'posted', 'paid');

-- the settlement that settled an instalment (so voiding an unpaid settlement can reopen the loan)
ALTER TABLE "employee_loan_installments" ADD COLUMN IF NOT EXISTS "settled_by_settlement_id" uuid
  REFERENCES "employee_final_settlements"("id") ON DELETE SET NULL;

ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "leave_deduction" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "loan_deduction" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "unpaid_leave_days" numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "half_pay_leave_days" numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_leave_deductions" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_loan_deductions" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "termination_date" date;

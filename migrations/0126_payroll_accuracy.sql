-- 0126_payroll_accuracy: payroll fixes from the accountant teardown. Additive and idempotent.
--
--  * payroll_runs.created_by: who prepared the run, so the approval gate can refuse self-approval.
--  * payroll_items.days_worked: days paid on a 30-day basis for a joiner or leaver in the month (NULL = full month);
--    drives the pro-rated pay, the gratuity accrual and the WPS file.
--  * employees.mol_person_id: the 14-digit MOHRE person code the SIF file needs.
--  * employees.opening_gratuity_provision: end-of-service provision already held for the employee when they came
--    on to the system (the opening 2036 balance); the final settlement uses it as part of the provision used.
--  * companies.leave_provision_enabled: monthly leave-pay provision (Dr 5029 / Cr 2037), on by default.
--  * employee_leave_provisions: the provision held per employee (accruals positive, uses negative).

ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "days_worked" numeric(5,2);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "mol_person_id" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "opening_gratuity_provision" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "leave_provision_enabled" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "employee_leave_provisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "payroll_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  "settlement_id" uuid REFERENCES "employee_final_settlements"("id") ON DELETE SET NULL,
  "amount" numeric(15,2) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_employee_leave_provisions_employee" ON "employee_leave_provisions"("company_id", "employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_employee_leave_provisions_run" ON "employee_leave_provisions"("payroll_run_id", "employee_id") WHERE "payroll_run_id" IS NOT NULL;

-- A document whose only possible approver is its own creator may be approved by them with an explicit
-- acknowledgement; both the signature and its request are marked so the queue, the history and the audit trail show it.
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "self_approved" boolean NOT NULL DEFAULT false;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "self_approved" boolean NOT NULL DEFAULT false;

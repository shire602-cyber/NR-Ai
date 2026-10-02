-- 0128_prior_service_provisions: prior service is captured per employee, not caught up silently in the first run.
-- Additive and idempotent.
--
-- employees: what the company already held for each employee when it started payroll here (opening leave days and
--   leave-pay provision, as of a date; opening_gratuity_provision exists since 0126), and when a prior-service
--   catch-up journal was booked for them (the explicit "Book prior-service catch-up journal" action).
-- employee_final_settlements: when a draft settlement was last recalculated (a draft is current on every read).

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "opening_leave_days" numeric(7,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "opening_leave_provision" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "opening_provisions_as_of" date;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "prior_service_catchup_at" timestamp;
ALTER TABLE "employee_final_settlements" ADD COLUMN IF NOT EXISTS "calculated_at" timestamp;

-- A final settlement is a document type approval rules can cover (a second person before posting).
ALTER TABLE "approval_rules" DROP CONSTRAINT IF EXISTS "approval_rules_document_type_check";
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_document_type_check"
  CHECK ("document_type" IN ('bill', 'expense_claim', 'purchase_order', 'payroll_run', 'manual_journal', 'final_settlement'));

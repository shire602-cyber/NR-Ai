-- Phase 9 follow-up B4: which login an employee record belongs to, so an employee-role user can be shown only their
-- own leave, loans, settlement and payslips. Set by an accountant or above; a user is linked to at most one employee
-- per company. Idempotent.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_user_unique ON employees (company_id, user_id) WHERE user_id IS NOT NULL;

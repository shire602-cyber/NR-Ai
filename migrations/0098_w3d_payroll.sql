-- 0098_w3d_payroll (W3-D): payroll run state machine, CBUAE WPS SIF, employee records, leave,
-- payslips, end-of-service settlement, GPSSA. Idempotent: every statement is re-runnable.
--  * payroll_items.employee_id ON DELETE RESTRICT (R09-05) — history can no longer cascade away
--  * payroll_runs: preparer/payer/reverser stamps, payment JE, WPS status tracking (R09-02/12/13/18/22/23)
--  * payroll_runs.status adds 'reversed' to the allowed values
--  * payroll_items: unpaid/paid leave days, unpaid-leave deduction, overtime hours/multiplier,
--    salary currency + exchange rate, payment JE (R09-15/19)
--  * employees: Emirates ID, MOL person id, contract/visa/labour-card fields, cost centre,
--    salary currency, termination/archive (R09-09/21)
--  * new tables: employee_salary_history, payroll_settings, leave_types, leave_requests,
--    payslip_tokens, payroll_settlements, payroll_wps_events, payroll_expiry_alerts
--  * companies.wps_agent_id (WPS agent / salary-transfer provider id)

-- ── payroll_items.employee_id: CASCADE -> RESTRICT ─────────────────────────────
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'payroll_items'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'employees'::regclass
       AND a.attname = 'employee_id'
       AND c.confdeltype <> 'r'
  LOOP
    EXECUTE format('ALTER TABLE payroll_items DROP CONSTRAINT %I', fk.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'payroll_items'::regclass AND conname = 'payroll_items_employee_id_restrict_fk'
  ) THEN
    ALTER TABLE payroll_items
      ADD CONSTRAINT payroll_items_employee_id_restrict_fk
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint

-- ── payroll_runs.status: add 'reversed' ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'payroll_runs'::regclass AND conname = 'payroll_runs_status_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%reversed%'
  ) THEN
    ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_status_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'payroll_runs'::regclass AND conname = 'payroll_runs_status_check'
  ) THEN
    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_status_check
      CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'reversed', 'cancelled'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS calculated_by uuid,
  ADD COLUMN IF NOT EXISTS calculated_at timestamp,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamp,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_account_id uuid,
  ADD COLUMN IF NOT EXISTS payment_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversed_at timestamp,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS sif_file_name text,
  ADD COLUMN IF NOT EXISTS sif_generated_at timestamp,
  ADD COLUMN IF NOT EXISTS wps_status text NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS wps_status_notes text,
  ADD COLUMN IF NOT EXISTS wps_status_updated_at timestamp,
  ADD COLUMN IF NOT EXISTS wps_status_updated_by uuid,
  ADD COLUMN IF NOT EXISTS total_unpaid_leave_deduction numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'payroll_runs'::regclass AND conname = 'payroll_runs_wps_status_check'
  ) THEN
    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_wps_status_check
      CHECK (wps_status IN ('not_submitted', 'submitted', 'accepted', 'rejected'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_days numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_deduction numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours numeric(7,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric(5,2),
  ADD COLUMN IF NOT EXISTS salary_currency text NOT NULL DEFAULT 'AED',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS net_salary_foreign numeric(15,2),
  ADD COLUMN IF NOT EXISTS cost_center_id uuid,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS payment_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamp,
  ADD COLUMN IF NOT EXISTS payslip_emailed_at timestamp;
--> statement-breakpoint

-- ── employees: identity, contract, immigration, costing ───────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS emirates_id text,
  ADD COLUMN IF NOT EXISTS emirates_id_expiry date,
  ADD COLUMN IF NOT EXISTS mol_person_id text,
  ADD COLUMN IF NOT EXISTS labor_card_expiry date,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS visa_expiry date,
  ADD COLUMN IF NOT EXISTS contract_type text,
  ADD COLUMN IF NOT EXISTS contract_start date,
  ADD COLUMN IF NOT EXISTS contract_end date,
  ADD COLUMN IF NOT EXISTS notice_period_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS cost_center_id uuid,
  ADD COLUMN IF NOT EXISTS salary_currency text NOT NULL DEFAULT 'AED',
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS termination_date date,
  ADD COLUMN IF NOT EXISTS termination_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamp,
  ADD COLUMN IF NOT EXISTS created_by uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees (company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON payroll_items (employee_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  basic_salary numeric(12,2) NOT NULL,
  housing_allowance numeric(12,2) NOT NULL,
  transport_allowance numeric(12,2) NOT NULL,
  other_allowance numeric(12,2) NOT NULL,
  salary_currency text NOT NULL DEFAULT 'AED',
  reason text,
  changed_by uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_employee_salary_history_employee
  ON employee_salary_history (employee_id, effective_date);
--> statement-breakpoint

-- ── payroll_settings: legal parameters (counsel review) + approval policy ─────
CREATE TABLE IF NOT EXISTS payroll_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  legal_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_single_owner_approval boolean NOT NULL DEFAULT true,
  adviser_confirmed boolean NOT NULL DEFAULT false,
  adviser_confirmed_by uuid,
  adviser_confirmed_at timestamp,
  adviser_note text,
  updated_by uuid,
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ── leave ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  is_paid boolean NOT NULL DEFAULT true,
  annual_entitlement_days numeric(6,2) NOT NULL DEFAULT 0,
  accrual_method text NOT NULL DEFAULT 'monthly',
  carry_forward_max_days numeric(6,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT leave_types_accrual_check CHECK (accrual_method IN ('monthly', 'annual', 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_company_code ON leave_types (company_id, code);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(6,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  requested_by uuid,
  decided_by uuid,
  decided_at timestamp,
  decision_notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id, start_date);
--> statement-breakpoint

-- ── payslips (employee self-service token links) ──────────────────────────────
CREATE TABLE IF NOT EXISTS payslip_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_item_id uuid NOT NULL REFERENCES payroll_items(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  created_by uuid,
  last_viewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payslip_tokens_hash ON payslip_tokens (token_hash);
--> statement-breakpoint

-- ── end-of-service settlement ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  termination_date date NOT NULL,
  reason text,
  service_days integer NOT NULL DEFAULT 0,
  unpaid_leave_days numeric(8,2) NOT NULL DEFAULT 0,
  gratuity_amount numeric(15,2) NOT NULL DEFAULT 0,
  gratuity_provision_used numeric(15,2) NOT NULL DEFAULT 0,
  notice_pay numeric(15,2) NOT NULL DEFAULT 0,
  leave_encashment numeric(15,2) NOT NULL DEFAULT 0,
  other_additions numeric(15,2) NOT NULL DEFAULT 0,
  deductions numeric(15,2) NOT NULL DEFAULT 0,
  net_amount numeric(15,2) NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'posted',
  payment_account_id uuid,
  journal_entry_id uuid,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT payroll_settlements_status_check CHECK (status IN ('posted', 'paid', 'reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_settlements_active_employee
  ON payroll_settlements (employee_id) WHERE status <> 'reversed';
--> statement-breakpoint

-- ── WPS status history (submission itself is external) ────────────────────────
CREATE TABLE IF NOT EXISTS payroll_wps_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  status text NOT NULL,
  notes text,
  actor_id uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ── expiry alerts already emitted (one per document + expiry date) ────────────
CREATE TABLE IF NOT EXISTS payroll_expiry_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_kind text NOT NULL,
  expiry_date date NOT NULL,
  emitted_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_expiry_alerts
  ON payroll_expiry_alerts (employee_id, document_kind, expiry_date);
--> statement-breakpoint

-- ── companies: WPS agent id ───────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS wps_agent_id text;

-- 0123_a4_payroll_ct (A4 accounting audit; W3-D payroll / W4-A corporate tax / W3-A sales residual).
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and guarded data fixes only, so
-- re-running the file changes nothing.
--
-- 1. Pension scheme per employee (M11): NULL = by nationality (GPSSA for UAE nationals, the GCC
--    home scheme for other GCC nationals); 'adpf' = Abu Dhabi Pension Fund (Abu Dhabi nationals).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_scheme text;
--> statement-breakpoint
-- 2. Opening gratuity provision (M10): NULL means "not entered yet" (the first payroll run asks for
--    it), 0 means "confirmed nil". 0118 created the column NOT NULL DEFAULT 0, so an untouched 0 on
--    an employee who was never on a payroll run is the default, not a decision: it becomes NULL.
ALTER TABLE employees ALTER COLUMN opening_gratuity_provision DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE employees ALTER COLUMN opening_gratuity_provision DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE employees ADD COLUMN IF NOT EXISTS opening_gratuity_as_of date;
--> statement-breakpoint
UPDATE employees e SET opening_gratuity_provision = NULL
 WHERE e.opening_gratuity_provision = 0 AND e.opening_gratuity_as_of IS NULL
   AND NOT EXISTS (SELECT 1 FROM payroll_items pi WHERE pi.employee_id = e.id);
--> statement-breakpoint
-- 3. Pension contribution payments (M14): clears 2032 (Dr pension payable / Cr bank) per fund.
CREATE TABLE IF NOT EXISTS payroll_pension_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fund text NOT NULL,
  period_year integer,
  period_month integer,
  payment_date date NOT NULL,
  amount numeric(15,2) NOT NULL,
  payment_account_id uuid NOT NULL,
  reference text,
  journal_entry_id uuid,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  reversed_at timestamp,
  CONSTRAINT payroll_pension_payments_fund_check CHECK (fund IN ('gpssa', 'adpf')),
  CONSTRAINT payroll_pension_payments_status_check CHECK (status IN ('posted', 'reversed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payroll_pension_payments_company
  ON payroll_pension_payments (company_id, payment_date);
--> statement-breakpoint
-- 4. Year-end current-tax accrual (M2): the accrual entry and amount on the return; filing posts
--    only the true-up against it.
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS accrual_entry_id uuid;
--> statement-breakpoint
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS accrued_tax numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
-- 5. Deferred tax adjustments (M2, IAS 12): manual closing DTA / DTL with an optional
--    temporary-difference schedule; the movement posts Dr/Cr DTA, DTL and deferred tax expense.
CREATE TABLE IF NOT EXISTS deferred_tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  as_of date NOT NULL,
  tax_rate numeric(6,4) NOT NULL DEFAULT 0.09,
  closing_asset numeric(15,2) NOT NULL DEFAULT 0,
  closing_liability numeric(15,2) NOT NULL DEFAULT 0,
  movement_asset numeric(15,2) NOT NULL DEFAULT 0,
  movement_liability numeric(15,2) NOT NULL DEFAULT 0,
  schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  journal_entry_id uuid,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT deferred_tax_adjustments_status_check CHECK (status IN ('posted', 'reversed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_deferred_tax_adjustments_company
  ON deferred_tax_adjustments (company_id, as_of);
--> statement-breakpoint
-- 6. Tax losses brought forward from returns filed outside Muhasib (M13, FDL 47/2022 Art. 37).
CREATE TABLE IF NOT EXISTS ct_external_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_period_start date NOT NULL,
  tax_period_end date NOT NULL,
  total_revenue numeric(15,2) NOT NULL DEFAULT 0,
  loss_carried_forward numeric(15,2) NOT NULL DEFAULT 0,
  interest_carried_forward numeric(15,2) NOT NULL DEFAULT 0,
  filing_reference text,
  note text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_ct_external_returns_period
  ON ct_external_returns (company_id, tax_period_end);
--> statement-breakpoint
-- 7. Customer deposits / advances (M1, FDL 8/2017 Art. 25-26): VAT is due on receipt; applying
--    the deposit to the final invoice reverses the advance VAT (the invoice charges it in full).
CREATE TABLE IF NOT EXISTS customer_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid,
  customer_name text NOT NULL,
  customer_trn text,
  number text,
  date date NOT NULL,
  amount numeric(15,2) NOT NULL,
  net_amount numeric(15,2) NOT NULL,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  vat_treatment text NOT NULL DEFAULT 'standard',
  vat_rate numeric(15,6) NOT NULL DEFAULT 0.05,
  emirate text,
  currency text NOT NULL DEFAULT 'AED',
  payment_account_id uuid NOT NULL,
  liability_account_id uuid NOT NULL,
  journal_entry_id uuid,
  credit_id uuid,
  reference text,
  description text,
  status text NOT NULL DEFAULT 'open',
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT customer_deposits_treatment_check
    CHECK (vat_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_deposits_company ON customer_deposits (company_id, date);
--> statement-breakpoint
-- The VAT share of a deposit application or refund (reverses the advance VAT on 2020).
ALTER TABLE customer_credit_allocations ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2);
--> statement-breakpoint
-- Fund each payroll line's pension contributions are paid to (gpssa | adpf), for the
-- per-fund payment workflow and the 2032 tie check.
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS pension_fund text;

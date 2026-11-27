-- ============================================================================
-- 0038: Payroll state machine, idempotency, WPS employer bank fields
-- ----------------------------------------------------------------------------
-- 1. UNIQUE (company_id, period_month, period_year) on payroll_runs so duplicate
--    runs for the same period collide at the DB level (we surface as HTTP 409).
-- 2. CHECK constraint locking payroll_runs.status to the allowed enum values
--    (draft | calculated | approved | paid | cancelled). The transition logic
--    itself is enforced application-side in the PATCH handler.
-- 3. Add a `notes` column to payroll_runs (free-form, no business logic).
-- 4. Add MOHRE establishment ID and WPS employer bank columns to companies so
--    the SIF generator can populate the SCR record correctly. Each must be set
--    by the customer; the SIF endpoint refuses to generate a file otherwise.
-- All statements are idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payroll_runs: UNIQUE (company_id, period_month, period_year)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payroll_runs_company_period_unique'
      AND table_name = 'payroll_runs'
  ) THEN
    -- Fail closed on pre-existing duplicates. Never delete payroll runs (a
    -- delete would cascade to payslips and could remove a paid run); the
    -- duplicates must be reconciled by hand, then the migration re-run.
    IF EXISTS (
      SELECT 1 FROM payroll_runs
      GROUP BY company_id, period_month, period_year
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'payroll_runs has duplicate (company_id, period_month, period_year) rows; reconcile or merge the duplicate payroll runs manually (no rows were deleted), then re-run this migration'
        USING ERRCODE = 'unique_violation';
    END IF;

    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_company_period_unique
      UNIQUE (company_id, period_month, period_year);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. payroll_runs.status: enum CHECK constraint
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  -- Coerce any legacy values to 'draft' so the constraint can be added.
  UPDATE payroll_runs
     SET status = 'draft'
   WHERE status IS NULL
      OR status NOT IN ('draft', 'calculated', 'approved', 'paid', 'cancelled');

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payroll_runs_status_check'
      AND table_name = 'payroll_runs'
  ) THEN
    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_status_check
      CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'cancelled'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. payroll_runs.notes: free-form column for the PATCH endpoint
-- ----------------------------------------------------------------------------

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS notes text;

-- ----------------------------------------------------------------------------
-- 4. companies: MOHRE establishment ID + WPS employer bank fields
--     The SCR (Salary Control Record) line of the SIF must carry the
--     employer's MOHRE establishment ID (not the trade-license registration
--     number) plus the employer bank routing code and IBAN. These were
--     previously hard-coded to NULL and rejected by Central Bank validation.
-- ----------------------------------------------------------------------------

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS mohre_establishment_id    text,
  ADD COLUMN IF NOT EXISTS wps_employer_bank_name    text,
  ADD COLUMN IF NOT EXISTS wps_employer_iban         text,
  ADD COLUMN IF NOT EXISTS wps_employer_routing_code text;

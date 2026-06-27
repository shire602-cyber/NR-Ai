-- Self-healing migration: recreate the raw-SQL module tables missing from
-- baselined production databases (fixed assets, payroll/employees, budgets,
-- expense claims, autonomous-GL queue, depreciation schedules). Same failure
-- mode as 0069/0070 — these migrations were marked applied without running.
-- All replayed files are idempotent (IF NOT EXISTS / guarded inserts).

-- ─── from 0009_add_payroll.sql ───
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

-- ─── from 0011_add_fixed_assets.sql ───
CREATE TABLE IF NOT EXISTS "fixed_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "asset_name" text NOT NULL,
  "asset_name_ar" text,
  "asset_number" text,
  "category" text NOT NULL,
  "purchase_date" timestamp NOT NULL,
  "purchase_cost" numeric(12,2) NOT NULL,
  "salvage_value" numeric(12,2) DEFAULT 0,
  "useful_life_years" integer NOT NULL,
  "depreciation_method" text DEFAULT 'straight_line',
  "accumulated_depreciation" numeric(12,2) DEFAULT 0,
  "net_book_value" numeric(12,2),
  "location" text,
  "serial_number" text,
  "status" text DEFAULT 'active',
  "disposal_date" timestamp,
  "disposal_amount" numeric(12,2),
  "notes" text,
  "created_at" timestamp DEFAULT now()
);

-- ─── from 0012_add_budgets.sql ───
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

-- ─── from 0013_add_expense_claims.sql ───
CREATE TABLE IF NOT EXISTS "expense_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "claim_number" text,
  "title" text NOT NULL,
  "description" text,
  "total_amount" numeric(12,2) DEFAULT 0,
  "currency" text DEFAULT 'AED',
  "status" text DEFAULT 'draft',
  "submitted_at" timestamp,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "review_notes" text,
  "paid_at" timestamp,
  "payment_reference" text,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_claim_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "claim_id" uuid NOT NULL REFERENCES "expense_claims"("id") ON DELETE CASCADE,
  "expense_date" timestamp NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "receipt_url" text,
  "merchant_name" text,
  "created_at" timestamp DEFAULT now()
);

-- ─── from 0014_add_autonomous_gl.sql ───
-- Autonomous GL Engine tables
-- AI auto-categorizes and auto-posts bank transactions to the GL

CREATE TABLE IF NOT EXISTS "ai_gl_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_transaction_id" uuid,
  "description" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "transaction_date" timestamp NOT NULL,
  "suggested_account_id" uuid,
  "suggested_category" text,
  "ai_confidence" numeric(3,2) DEFAULT 0,
  "ai_reason" text,
  "few_shot_examples_used" integer DEFAULT 0,
  "status" text DEFAULT 'pending_review',
  "journal_entry_id" uuid,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "user_selected_account_id" uuid,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ai_company_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "merchant_pattern" text,
  "description_pattern" text,
  "account_id" uuid NOT NULL,
  "times_applied" integer DEFAULT 0,
  "times_accepted" integer DEFAULT 0,
  "times_rejected" integer DEFAULT 0,
  "confidence" numeric(3,2) DEFAULT 0.5,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "month_end_close" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "status" text DEFAULT 'open',
  "checklist" text,
  "closing_journal_entry_id" uuid,
  "closed_by" uuid,
  "closed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_ai_gl_queue_company_status" ON "ai_gl_queue" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_ai_gl_queue_bank_txn" ON "ai_gl_queue" ("bank_transaction_id");
CREATE INDEX IF NOT EXISTS "idx_ai_company_rules_company" ON "ai_company_rules" ("company_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_month_end_close_company" ON "month_end_close" ("company_id", "status");

-- ─── from 0030_payroll_pension_gratuity.sql ───
-- ============================================================================
-- 0030: Payroll pension/gratuity tracking + journal-entry linkage
-- ----------------------------------------------------------------------------
-- 1. Adds employer-cost tracking columns (GPSSA pension, end-of-service
--    gratuity accrual) to payroll_items and payroll_runs, plus a
--    manually_edited flag and a journal_entry_id back-reference.
-- 2. Seeds new system accounts on every company so payroll approval can
--    post a balanced JE without first failing for a missing account.
--      5025 Pension Expense (Employer)
--      5028 End-of-Service Gratuity Expense
--      2032 Pension Payable - GPSSA
--      2034 Payroll Deductions Payable
--      2036 End-of-Service Gratuity Provision
-- All statements are idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payroll_items: pension/gratuity/manual-edit/JE-link columns
-- ----------------------------------------------------------------------------

ALTER TABLE "payroll_items"
  ADD COLUMN IF NOT EXISTS "pension_employee" numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pension_employer" numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gratuity_accrual" numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "manually_edited" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_items' AND column_name = 'journal_entry_id'
  ) THEN
    ALTER TABLE "payroll_items"
      ADD COLUMN "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. payroll_runs: aggregate employer-cost columns + JE link
-- ----------------------------------------------------------------------------

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "total_pension_employee" numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_pension_employer" numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_gratuity_accrual" numeric(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_runs' AND column_name = 'journal_entry_id'
  ) THEN
    ALTER TABLE "payroll_runs"
      ADD COLUMN "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Backfill payroll-specific system accounts for every company
--     Uses ON CONFLICT (company_id, code) so re-running is a no-op.
-- ----------------------------------------------------------------------------

INSERT INTO "accounts" (
  "company_id", "code", "name_en", "name_ar", "description",
  "type", "sub_type", "is_vat_account", "vat_type",
  "is_system_account", "is_active", "is_archived"
)
SELECT
  c.id, v.code, v.name_en, v.name_ar, v.description,
  v.type, v.sub_type, false, NULL,
  true, true, false
FROM "companies" c
CROSS JOIN (VALUES
  ('5025', 'Pension Expense (Employer)', 'مصروف المعاش (صاحب العمل)',
   'Employer share of GPSSA / GCC pension contributions',
   'expense', NULL),
  ('5028', 'End-of-Service Gratuity Expense', 'مصروف مكافأة نهاية الخدمة',
   'Periodic accrual of UAE end-of-service gratuity liability',
   'expense', NULL),
  ('2032', 'Pension Payable - GPSSA', 'المعاش المستحق - الهيئة العامة للمعاشات',
   'Employee + employer pension contributions due to GPSSA',
   'liability', 'current_liability'),
  ('2034', 'Payroll Deductions Payable', 'استقطاعات الرواتب المستحقة',
   'Sundry payroll deductions (loans, advances, fines) pending settlement',
   'liability', 'current_liability'),
  ('2036', 'End-of-Service Gratuity Provision', 'مخصص مكافأة نهاية الخدمة',
   'Accrued end-of-service gratuity liability',
   'liability', 'current_liability')
) AS v(code, name_en, name_ar, description, type, sub_type)
ON CONFLICT (company_id, code) DO NOTHING;

-- ─── from 0031_fixed_assets_depreciation_schedules.sql ───
-- ============================================================================
-- 0030: Fixed-asset depreciation idempotency + disposal accounts
-- ----------------------------------------------------------------------------
-- 1. depreciation_schedules — one row per (asset, year, month). Re-running the
--    same period is now blocked by the unique constraint, so the same month
--    can never be double-booked. Each row links back to the journal_entry
--    that posted it for full audit traceability.
-- 2. Backfill three new system accounts for asset disposal:
--      1290  Fixed Assets at Cost            (asset / fixed_asset)
--      4080  Gain on Asset Disposal          (revenue)
--      5130  Loss on Asset Disposal          (expense)
--    These are used by /fixed-assets/:id/dispose to post the disposal JE.
-- All statements are idempotent so the migration is safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. depreciation_schedules
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "depreciation_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "posted_at" timestamp DEFAULT now(),
  "posted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT depreciation_schedules_period_check
    CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT depreciation_schedules_amount_nonneg
    CHECK (amount >= 0)
);

-- (asset_id, period_year, period_month) is the idempotency key — the route
-- checks for existence before posting and the unique constraint is the final
-- safety net against concurrent double-posts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'depreciation_schedules_asset_period_unique'
      AND table_name = 'depreciation_schedules'
  ) THEN
    ALTER TABLE depreciation_schedules
      ADD CONSTRAINT depreciation_schedules_asset_period_unique
      UNIQUE (asset_id, period_year, period_month);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_company
  ON depreciation_schedules (company_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_asset
  ON depreciation_schedules (asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_journal_entry
  ON depreciation_schedules (journal_entry_id);

-- ----------------------------------------------------------------------------
-- 2. New system accounts for disposal — backfill for existing companies
-- ----------------------------------------------------------------------------

INSERT INTO accounts (
  company_id, code, name_en, name_ar, description, type, sub_type,
  is_vat_account, vat_type, is_system_account, is_active, is_archived
)
SELECT c.id, '1290', 'Fixed Assets at Cost', 'الأصول الثابتة بالتكلفة',
       'Aggregate fixed asset cost account used for disposal entries',
       'asset', 'fixed_asset',
       false, NULL, true, true, false
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.company_id = c.id AND a.code = '1290'
);

INSERT INTO accounts (
  company_id, code, name_en, name_ar, description, type, sub_type,
  is_vat_account, vat_type, is_system_account, is_active, is_archived
)
SELECT c.id, '4080', 'Gain on Asset Disposal', 'ربح من بيع الأصول',
       'Gain recognized on disposal of fixed assets above net book value',
       'income', NULL,
       false, NULL, true, true, false
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.company_id = c.id AND a.code = '4080'
);

INSERT INTO accounts (
  company_id, code, name_en, name_ar, description, type, sub_type,
  is_vat_account, vat_type, is_system_account, is_active, is_archived
)
SELECT c.id, '5130', 'Loss on Asset Disposal', 'خسارة من بيع الأصول',
       'Loss recognized on disposal of fixed assets below net book value',
       'expense', NULL,
       false, NULL, true, true, false
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.company_id = c.id AND a.code = '5130'
);

-- ─── from 0038_fixed_assets_capitalization_flag.sql ───
-- ============================================================================
-- 0038: Fixed-asset capitalization flag
-- ----------------------------------------------------------------------------
-- Adds `needs_capitalization_je` to fixed_assets so the create endpoint can
-- mark assets that were registered without a paymentAccountId — those still
-- need a manual capitalization JE to balance the GL. Defaults to false so
-- existing assets are unaffected.
-- ============================================================================

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "needs_capitalization_je" boolean NOT NULL DEFAULT false;

-- ─── from 0039_payroll_state_machine.sql ───
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
    -- Collapse pre-existing duplicates: keep the oldest row, drop later ones.
    -- Items cascade via FK; in practice we do not expect duplicates because the
    -- pre-existing handler guarded with a SELECT, but be safe.
    DELETE FROM payroll_runs a
    USING payroll_runs b
    WHERE a.id > b.id
      AND a.company_id   = b.company_id
      AND a.period_month = b.period_month
      AND a.period_year  = b.period_year;

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


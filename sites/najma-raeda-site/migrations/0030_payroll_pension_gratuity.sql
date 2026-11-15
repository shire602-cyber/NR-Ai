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

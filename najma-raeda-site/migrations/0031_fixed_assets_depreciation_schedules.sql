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

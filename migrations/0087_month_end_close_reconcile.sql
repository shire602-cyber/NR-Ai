-- 0087_month_end_close_reconcile: make month_end_close match what the
-- month-end service actually reads and writes, so period locking works.
--
-- Root cause of the 500 on lock-period: migrations 0014/0073 created the table
-- with column "closing_journal_entry_id" and no unique(company_id, period_end),
-- while server/services/month-end.service.ts reads/writes "closing_entry_id",
-- "notes", "updated_at" and upserts with ON CONFLICT (company_id, period_end).
-- The service's own CREATE TABLE IF NOT EXISTS was a no-op because the table
-- already existed, so the columns/constraint were never reconciled.
--
-- This migration is idempotent and guarded for every prior state.

-- 1. Rename the column if the old name is present and the new one is not.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'month_end_close' AND column_name = 'closing_journal_entry_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'month_end_close' AND column_name = 'closing_entry_id'
  ) THEN
    ALTER TABLE month_end_close RENAME COLUMN closing_journal_entry_id TO closing_entry_id;
  END IF;
END $$;

-- 2. Add every column the service uses, if missing.
ALTER TABLE month_end_close
  ADD COLUMN IF NOT EXISTS closing_entry_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

-- 3. The service inserts without period_start; drop its NOT NULL if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'month_end_close' AND column_name = 'period_start'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE month_end_close ALTER COLUMN period_start DROP NOT NULL;
  END IF;
END $$;

-- 4. The upsert needs a unique constraint on (company_id, period_end).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'month_end_close_company_period_unique'
  ) THEN
    ALTER TABLE month_end_close
      ADD CONSTRAINT month_end_close_company_period_unique UNIQUE (company_id, period_end);
  END IF;
END $$;

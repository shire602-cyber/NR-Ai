-- 0091_w2b_reporting_close: period lock policy + year-end close records (W2-B).
-- Idempotent; owned by workstream W2-B. Do not edit meta/_journal.json.

-- 1. Period lock policy on month_end_close (R08-05, R02-11, R02-19).
--    lock_type  : 'soft' (owner/accountant may still post with a reason) | 'hard'
--    lock_scope : 'month' (legacy rows: only that calendar month)
--                 | 'through' (lock-through date: everything on or before period_end)
ALTER TABLE month_end_close
  ADD COLUMN IF NOT EXISTS lock_type text NOT NULL DEFAULT 'hard',
  ADD COLUMN IF NOT EXISTS lock_scope text NOT NULL DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS checklist_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checklist_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS unlocked_by uuid,
  ADD COLUMN IF NOT EXISTS unlocked_at timestamp,
  ADD COLUMN IF NOT EXISTS unlock_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'month_end_close_lock_type_check') THEN
    ALTER TABLE month_end_close
      ADD CONSTRAINT month_end_close_lock_type_check CHECK (lock_type IN ('soft', 'hard'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'month_end_close_lock_scope_check') THEN
    ALTER TABLE month_end_close
      ADD CONSTRAINT month_end_close_lock_scope_check CHECK (lock_scope IN ('month', 'through'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_month_end_close_company_locked
  ON month_end_close (company_id, period_end) WHERE status = 'locked';

-- 2. Year-end close records (R11-14). One row per company fiscal year.
--    hard_closed = true means only firm staff / platform admins can reopen.
CREATE TABLE IF NOT EXISTS fiscal_year_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_start date NOT NULL,
  fiscal_year_end date NOT NULL,
  status text NOT NULL DEFAULT 'closed',
  hard_closed boolean NOT NULL DEFAULT false,
  closing_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  net_income numeric(15,2) NOT NULL DEFAULT 0,
  reason text,
  closed_by uuid,
  closed_at timestamp NOT NULL DEFAULT now(),
  reopened_by uuid,
  reopened_at timestamp,
  reopen_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_year_closes_status_check CHECK (status IN ('closed', 'reopened')),
  CONSTRAINT fiscal_year_closes_company_year_unique UNIQUE (company_id, fiscal_year_end)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_year_closes_company ON fiscal_year_closes (company_id, status);

-- 3. Close settings. Posting a year-end closing entry is opt-in; by default the
--    close is computed (statements roll retained earnings forward themselves).
CREATE TABLE IF NOT EXISTS company_close_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  post_year_end_closing_entry boolean NOT NULL DEFAULT false,
  require_checklist_to_lock boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamp NOT NULL DEFAULT now()
);

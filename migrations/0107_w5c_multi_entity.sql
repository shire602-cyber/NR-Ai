-- 0107_w5c_multi_entity (W5-C): company groups, management consolidation (eliminations, translation audit trail) and the FX rate feed log.
-- Idempotent: every CREATE uses IF NOT EXISTS; safe to run twice.
-- Elimination journals are group-level and never touch an entity's journal_entries.

CREATE TABLE IF NOT EXISTS company_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reporting_currency text NOT NULL DEFAULT 'AED',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_company_groups_parent ON company_groups (parent_company_id);

CREATE TABLE IF NOT EXISTS company_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ownership_percent numeric(5,4) NOT NULL DEFAULT 1,
  method text NOT NULL DEFAULT 'full',
  effective_from date,
  effective_to date,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_company_group_members_method CHECK (method IN ('full', 'none')),
  CONSTRAINT chk_company_group_members_ownership CHECK (ownership_percent > 0 AND ownership_percent <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_group_members_group_company
  ON company_group_members (group_id, company_id);
CREATE INDEX IF NOT EXISTS idx_company_group_members_company ON company_group_members (company_id);

CREATE TABLE IF NOT EXISTS intercompany_account_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text,
  company_a_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_a_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_b_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_b_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_intercompany_account_maps_kind CHECK (kind IN ('receivable_payable', 'revenue_expense'))
);
CREATE INDEX IF NOT EXISTS idx_intercompany_account_maps_group ON intercompany_account_maps (group_id);

CREATE TABLE IF NOT EXISTS elimination_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'manual',
  run_id uuid,
  date date NOT NULL,
  memo text,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  voided_at timestamp,
  CONSTRAINT chk_elimination_journals_kind CHECK (kind IN ('manual', 'rule')),
  CONSTRAINT chk_elimination_journals_status CHECK (status IN ('posted', 'void'))
);
CREATE INDEX IF NOT EXISTS idx_elimination_journals_group_date ON elimination_journals (group_id, date);

CREATE TABLE IF NOT EXISTS elimination_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES elimination_journals(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  description text,
  CONSTRAINT chk_elimination_lines_one_side CHECK (
    debit_minor >= 0 AND credit_minor >= 0 AND (debit_minor = 0) <> (credit_minor = 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_elimination_lines_journal ON elimination_lines (journal_id);

CREATE TABLE IF NOT EXISTS consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  reporting_currency text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consolidation_runs_group ON consolidation_runs (group_id, created_at);

CREATE TABLE IF NOT EXISTS fx_rate_feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  status text NOT NULL,
  rate_date date,
  inserted integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fx_rate_feed_runs_provider ON fx_rate_feed_runs (provider, created_at);

-- Rate feed sources (R14-14): system rows written by the CBUAE / ECB adapters.
ALTER TABLE exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_source_chk;
ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_source_chk
  CHECK (source IN ('manual', 'api', 'fta', 'cbuae', 'ecb'));

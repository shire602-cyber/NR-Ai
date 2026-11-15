-- Corporate tax taxable-profit bridge (FDL 47/2022):
-- loss carryforward pool, small business relief election, TP notes.
--
-- Self-healing: production databases whose Drizzle ledger was baselined may
-- not have corporate_tax_returns at all (migration 0005 was marked applied
-- without running — see the to_regclass guard in server/db.ts). A bare
-- ALTER TABLE fails on a missing relation even with IF NOT EXISTS on the
-- column, which is exactly how deploy fe88c1c0 died. So: create the table
-- with the full current shape when absent, then add the bridge columns for
-- databases where the legacy table already exists. Both paths are no-ops on
-- re-run.
CREATE TABLE IF NOT EXISTS corporate_tax_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_period_start timestamp NOT NULL,
  tax_period_end timestamp NOT NULL,
  total_revenue numeric(15,2) NOT NULL DEFAULT 0,
  total_expenses numeric(15,2) NOT NULL DEFAULT 0,
  total_deductions numeric(15,2) NOT NULL DEFAULT 0,
  taxable_income numeric(15,2) NOT NULL DEFAULT 0,
  exemption_threshold numeric(15,2) NOT NULL DEFAULT 375000,
  tax_rate real NOT NULL DEFAULT 0.09,
  tax_payable numeric(15,2) NOT NULL DEFAULT 0,
  loss_brought_forward numeric(15,2) NOT NULL DEFAULT 0,
  loss_carried_forward numeric(15,2) NOT NULL DEFAULT 0,
  small_business_relief boolean NOT NULL DEFAULT false,
  related_party_notes text,
  status text NOT NULL DEFAULT 'draft',
  filed_at timestamp,
  workpaper jsonb,
  notes text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corporate_tax_returns_company_id ON corporate_tax_returns(company_id);

ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS loss_brought_forward numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS loss_carried_forward numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS small_business_relief boolean NOT NULL DEFAULT false;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS related_party_notes text;

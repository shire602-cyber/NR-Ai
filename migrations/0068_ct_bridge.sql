-- Corporate tax taxable-profit bridge (FDL 47/2022):
-- loss carryforward pool, small business relief election, TP notes.
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS loss_brought_forward numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS loss_carried_forward numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS small_business_relief boolean NOT NULL DEFAULT false;
ALTER TABLE corporate_tax_returns ADD COLUMN IF NOT EXISTS related_party_notes text;

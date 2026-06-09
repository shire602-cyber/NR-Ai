-- M9: one corporate-tax return per company per tax period.
-- De-dupe any existing duplicates (keep the most recently updated/created row,
-- mirroring the VAT de-dupe approach in 0061) before adding the unique index.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, tax_period_start, tax_period_end
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM corporate_tax_returns
)
DELETE FROM corporate_tax_returns
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS corporate_tax_returns_company_period_unique
  ON corporate_tax_returns (company_id, tax_period_start, tax_period_end);

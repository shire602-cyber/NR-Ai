-- Store the pre-submission corporate tax workpaper schedule used to support
-- total revenue, expenses, profit/loss, and taxable income.
ALTER TABLE corporate_tax_returns
  ADD COLUMN IF NOT EXISTS workpaper jsonb;

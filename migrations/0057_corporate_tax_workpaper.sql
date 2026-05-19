-- Store the pre-submission corporate tax workpaper schedule used to support
-- total revenue, expenses, profit/loss, and taxable income.
DO $$
BEGIN
  IF to_regclass('public.corporate_tax_returns') IS NOT NULL THEN
    ALTER TABLE corporate_tax_returns
      ADD COLUMN IF NOT EXISTS workpaper jsonb;
  END IF;
END $$;

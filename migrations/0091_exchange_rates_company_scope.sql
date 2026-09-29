-- 0091_exchange_rates_company_scope: make exchange rates tenant-safe.
--
-- Defect: exchange_rates had no company column, so a rate typed in by one
-- company was picked up by every other company's invoices; and the manual-entry
-- API stored "1 CHF = 4.1 AED" reversed (base AED, target CHF).
--
-- CONVENTION (unchanged from the rate column comment): a row means
-- "1 unit of base_currency = rate units of target_currency".
--
--   company_id NULL     = SYSTEM rate (automated FTA / central-bank feed only)
--   company_id = <uuid> = that company's own rate; never visible to another company
--
-- Existing rows: source is NOT a reliable signal of who wrote a row (the old
-- POST /api/exchange-rates let any user write source = 'fta'), and direction is
-- unknown for rows written through the company endpoint. So every pre-existing
-- row is marked is_trusted = false; lookups ignore untrusted rows. No rows are
-- deleted. Idempotent: the backfill only runs when the column is first added,
-- so a re-run never distrusts rows created after the migration.

ALTER TABLE exchange_rates
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'exchange_rates'
      AND column_name = 'is_trusted'
  ) THEN
    -- Added with DEFAULT false so every existing row becomes untrusted, then the
    -- default flips to true for rows written from now on.
    ALTER TABLE exchange_rates ADD COLUMN is_trusted boolean NOT NULL DEFAULT false;
    ALTER TABLE exchange_rates ALTER COLUMN is_trusted SET DEFAULT true;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_company_pair_date
  ON exchange_rates (company_id, base_currency, target_currency, date);

-- One rate per scope (company or system) + pair + calendar day + source. The old
-- index ignored the company, so two companies could not hold the same pair/day.
DROP INDEX IF EXISTS uniq_exchange_rates_per_day_source;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_exchange_rates_scope_pair_day_source
  ON exchange_rates (
    (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    base_currency,
    target_currency,
    ((date)::date),
    source
  );

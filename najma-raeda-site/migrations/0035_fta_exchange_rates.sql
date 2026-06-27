-- Sprint 3.4: FTA-published exchange rates
-- The exchange_rates table already exists (0015). We harden it for FTA use:
--   * source column gets a CHECK constraint to prevent typos (must be 'manual',
--     'api', or 'fta')
--   * unique index on (base, target, date::date, source) prevents duplicate
--     daily rates from the same source — FTA publishes one rate per pair per day
--   * helper index on (target_currency, source, date DESC) for the prefer-FTA lookup

-- Drop old check constraint if it existed (idempotent)
ALTER TABLE "exchange_rates" DROP CONSTRAINT IF EXISTS "exchange_rates_source_chk";

ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_source_chk"
  CHECK ("source" IN ('manual', 'api', 'fta'));

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_exchange_rates_per_day_source"
  ON "exchange_rates" ("base_currency", "target_currency", (("date")::date), "source");

CREATE INDEX IF NOT EXISTS "idx_exchange_rates_target_source_date"
  ON "exchange_rates" ("target_currency", "source", "date" DESC);

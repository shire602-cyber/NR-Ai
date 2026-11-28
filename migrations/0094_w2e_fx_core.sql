-- 0094_w2e_fx_core: FX core, owned by workstream W2-E (R14-01, R14-02, R14-03, R14-15, R14-17).
--
-- 1. exchange_rates becomes tenant-scoped: company_id (NULL = system row), rate_type
--    (spot | closing | average), created_by, legacy_unscoped, legacy_inverted.
-- 2. One-time backfill (runs only on the run that adds the columns):
--    - source 'fta' rows stay system rows;
--    - any other row is assigned to the only company when the database has exactly one
--      company (owner determinable), otherwise flagged legacy_unscoped and ignored by lookups
--      (pre-0094 rows have no creator, so they cannot be trusted as system rows);
--    - rows the old UI route wrote inverted (base = AED, target <> AED, source 'manual') are
--      rewritten to the canonical (foreign, AED) form with legacy_inverted = true. If the
--      canonical row already exists for that day the inverted duplicate is flagged
--      legacy_unscoped instead. scripts/qa/find-inverted-rates.mjs is the read-only dry run.
-- 3. The per-day unique index now includes the tenant scope and rate type.
-- 4. fx_revaluations: one unrealised revaluation run per (company, as_of) while not undone.
-- Idempotent: every DDL uses IF [NOT] EXISTS and the backfill is guarded.

DO $$
DECLARE
  first_run boolean;
  company_count integer;
  only_company uuid;
BEGIN
  first_run := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'exchange_rates'
       AND column_name = 'legacy_unscoped'
  );

  ALTER TABLE "exchange_rates"
    ADD COLUMN IF NOT EXISTS "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE;
  ALTER TABLE "exchange_rates"
    ADD COLUMN IF NOT EXISTS "rate_type" text NOT NULL DEFAULT 'spot';
  ALTER TABLE "exchange_rates"
    ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
  ALTER TABLE "exchange_rates"
    ADD COLUMN IF NOT EXISTS "legacy_unscoped" boolean NOT NULL DEFAULT false;
  ALTER TABLE "exchange_rates"
    ADD COLUMN IF NOT EXISTS "legacy_inverted" boolean NOT NULL DEFAULT false;

  -- The old index has no tenant scope; drop it before rewriting pairs.
  DROP INDEX IF EXISTS "uniq_exchange_rates_per_day_source";

  IF first_run THEN
    SELECT COUNT(*)::int INTO company_count FROM "companies";
    IF company_count = 1 THEN
      SELECT "id" INTO only_company FROM "companies" LIMIT 1;
    END IF;

    -- Ownership.
    IF only_company IS NOT NULL THEN
      UPDATE "exchange_rates" SET "company_id" = only_company
       WHERE "source" <> 'fta' AND "company_id" IS NULL;
    ELSE
      UPDATE "exchange_rates" SET "legacy_unscoped" = true
       WHERE "source" <> 'fta' AND "company_id" IS NULL;
    END IF;

    -- Inverted UI-route rows whose canonical twin already exists: keep the canonical row.
    UPDATE "exchange_rates" inv SET "legacy_unscoped" = true, "legacy_inverted" = true
     WHERE inv."base_currency" = 'AED' AND inv."target_currency" <> 'AED'
       AND inv."source" = 'manual'
       AND EXISTS (
         SELECT 1 FROM "exchange_rates" c
          WHERE c."id" <> inv."id"
            AND c."base_currency" = inv."target_currency"
            AND c."target_currency" = 'AED'
            AND c."source" = inv."source"
            AND c."rate_type" = inv."rate_type"
            AND c."date"::date = inv."date"::date
            AND c."company_id" IS NOT DISTINCT FROM inv."company_id"
       );

    -- Canonicalise: (AED, EUR, 4) meant "1 EUR = 4 AED" -> (EUR, AED, 4).
    UPDATE "exchange_rates"
       SET "base_currency" = "target_currency",
           "target_currency" = 'AED',
           "legacy_inverted" = true
     WHERE "base_currency" = 'AED' AND "target_currency" <> 'AED'
       AND "source" = 'manual'
       AND "legacy_inverted" = false;
  END IF;

  ALTER TABLE "exchange_rates" DROP CONSTRAINT IF EXISTS "exchange_rates_rate_type_chk";
  ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_rate_type_chk"
    CHECK ("rate_type" IN ('spot', 'closing', 'average'));

  -- New rows only (NOT VALID): pre-existing junk stays readable for the dry-run report.
  ALTER TABLE "exchange_rates" DROP CONSTRAINT IF EXISTS "exchange_rates_rate_positive_chk";
  ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_rate_positive_chk" CHECK ("rate" > 0) NOT VALID;
  ALTER TABLE "exchange_rates" DROP CONSTRAINT IF EXISTS "exchange_rates_pair_distinct_chk";
  ALTER TABLE "exchange_rates"
    ADD CONSTRAINT "exchange_rates_pair_distinct_chk"
    CHECK ("base_currency" <> "target_currency") NOT VALID;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_exchange_rates_scope_pair_day"
  ON "exchange_rates" (
    COALESCE("company_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "base_currency", "target_currency", (("date")::date), "source", "rate_type"
  )
  WHERE "legacy_unscoped" = false;

CREATE INDEX IF NOT EXISTS "idx_exchange_rates_company_pair_date"
  ON "exchange_rates" ("company_id", "base_currency", "target_currency", "rate_type", "date");

CREATE TABLE IF NOT EXISTS "fx_revaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "as_of" date NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "net_gain_loss" numeric(15,2) NOT NULL DEFAULT 0,
  "summary" jsonb,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "undone_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "undone_at" timestamp,
  CONSTRAINT "fx_revaluations_status_chk" CHECK ("status" IN ('pending', 'posted', 'undone'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_fx_revaluations_company_as_of_active"
  ON "fx_revaluations" ("company_id", "as_of")
  WHERE "status" <> 'undone';

CREATE INDEX IF NOT EXISTS "idx_fx_revaluations_company"
  ON "fx_revaluations" ("company_id", "as_of");

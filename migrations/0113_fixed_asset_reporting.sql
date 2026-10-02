-- 0113_fixed_asset_reporting: link a disposal to its journal entry and proceeds account. Additive and idempotent.

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "disposal_journal_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "disposal_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;

DO $$
DECLARE linked integer;
BEGIN
  UPDATE "fixed_assets" fa SET "disposal_journal_id" = je."id"
    FROM "journal_entries" je
   WHERE fa."disposal_journal_id" IS NULL AND fa."status" = 'disposed'
     AND je."company_id" = fa."company_id" AND je."source" = 'system' AND je."source_id" = fa."id"
     AND je."status" = 'posted' AND je."memo" LIKE 'Disposal:%';
  GET DIAGNOSTICS linked = ROW_COUNT;
  RAISE NOTICE '0113: % disposed assets linked to their disposal journal', linked;
END $$;

CREATE INDEX IF NOT EXISTS "idx_fixed_assets_company_status" ON "fixed_assets"("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_depreciation_schedules_company_period" ON "depreciation_schedules"("company_id", "period_year", "period_month");

-- A depreciation month booked inside a period that was already closed or locked is not posted into that period: it is
-- gathered into one catch-up journal dated the first open day. The schedule row keeps the month and points at that journal.
ALTER TABLE "depreciation_schedules" ADD COLUMN IF NOT EXISTS "catch_up" boolean NOT NULL DEFAULT false;

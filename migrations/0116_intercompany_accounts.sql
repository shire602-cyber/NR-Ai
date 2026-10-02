-- 0116_intercompany_accounts
-- Phase 8 D4: an account may name the group company on the other side of an intercompany balance, so the
-- consolidated statements can eliminate it. Optional; no backfill.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "intercompany_company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL;

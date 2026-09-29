-- 0095_filing_review_fixes
-- Phase 4 review fixes. Fully idempotent: safe to re-run.
--
--  * vat_returns.manual_edits: the boxes a user changed by hand on a draft
--    ({ boxes: { box12TotalDueTax: { from, to } }, at, by }). Filing recomputes
--    the return from the books and refuses to silently discard these.
--  * A filing record can never be deleted, except when its company is deleted
--    (the cascade). The 0094 trigger already makes the snapshot immutable.
--
-- Legacy filed returns (status 'filed' with no tax_filings row) are given a
-- snapshot by the application on first read: the snapshot hash is the SHA-256
-- of canonical JSON, which is produced by the same code that verifies it, not
-- re-implemented in SQL.

ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "manual_edits" jsonb;

CREATE OR REPLACE FUNCTION tax_filings_no_delete() RETURNS trigger AS $fn$
BEGIN
  -- ON DELETE CASCADE from companies runs after the company row is gone.
  IF EXISTS (SELECT 1 FROM "companies" WHERE "id" = OLD."company_id") THEN
    RAISE EXCEPTION 'tax_filings rows cannot be deleted: a return recorded as filed is a permanent record'
      USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_filings_no_delete_trg ON "tax_filings";
CREATE TRIGGER tax_filings_no_delete_trg
  BEFORE DELETE ON "tax_filings"
  FOR EACH ROW EXECUTE FUNCTION tax_filings_no_delete();

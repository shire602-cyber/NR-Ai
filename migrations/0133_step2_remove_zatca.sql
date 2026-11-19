-- 0133_step2_remove_zatca (STEP2 S2): Saudi ZATCA removed from the product (owner, 2026-11-19).
-- Idempotent: guarded DROP TABLE IF EXISTS and a conditional UPDATE only. A ZATCA table that still
-- holds rows is never dropped silently: the migration stops so the owner can export it first.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.zatca_documents') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM zatca_documents' INTO n;
    IF n > 0 THEN RAISE EXCEPTION '0133: zatca_documents holds % row(s); export and get owner sign-off first', n; END IF;
  END IF;
  IF to_regclass('public.zatca_egs_units') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM zatca_egs_units' INTO n;
    IF n > 0 THEN RAISE EXCEPTION '0133: zatca_egs_units holds % row(s); export and get owner sign-off first', n; END IF;
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "zatca_documents";
--> statement-breakpoint
DROP TABLE IF EXISTS "zatca_egs_units";
--> statement-breakpoint
-- A 15% company default (only ever stored for a Saudi-address company) would make every new line
-- fail validation now that the UAE 5% rate is the only standard rate. Settings data, not ledger data.
UPDATE companies SET default_vat_rate = 0.05 WHERE default_vat_rate = 0.15;

-- Self-healing type fix: production receipts.date is TEXT (legacy) while the
-- schema declares TIMESTAMP. Mixed-type expressions like
-- COALESCE(date, created_at) then fail ("COALESCE types text and timestamp
-- cannot be matched"), breaking the VAT autopilot calculation. Convert in
-- place with a regex-guarded cast so any non-ISO garbage becomes NULL instead
-- of aborting the migration. No-op when the column is already a timestamp.
DO $heal$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts'
      AND column_name = 'date' AND data_type = 'text'
  ) THEN
    ALTER TABLE "receipts"
      ALTER COLUMN "date" TYPE timestamp
      USING (CASE WHEN "date" ~ '^\d{4}-\d{2}-\d{2}' THEN "date"::timestamp ELSE NULL END);
  END IF;
END
$heal$;

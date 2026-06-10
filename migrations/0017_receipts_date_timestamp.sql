-- Change receipts.date from text to timestamp.
-- OCR output stored dates as freeform text; this converts to proper timestamp for date filtering/sorting.
-- Rows with unparseable dates are set to NULL rather than failing the migration.

ALTER TABLE receipts
  ALTER COLUMN date TYPE timestamp USING
    CASE
      WHEN date IS NULL OR trim(date) = '' THEN NULL
      ELSE date::timestamp
    END;

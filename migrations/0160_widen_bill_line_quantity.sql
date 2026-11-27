-- 0160_widen_bill_line_quantity (bill quantity precision).
-- Idempotent: retain existing quantities and store all four accepted decimal places.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'bill_line_items'::regclass AND attname = 'quantity'
      AND format_type(atttypid, atttypmod) = 'numeric(10,2)'
  ) THEN
    ALTER TABLE bill_line_items ALTER COLUMN quantity TYPE numeric(16,4);
  END IF;
END $$;

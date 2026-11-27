-- 0160_widen_bill_line_quantity (bill, purchase order and goods receipt quantity precision).
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

-- Convert the stored float via double precision so real's six-significant-digit
-- numeric cast does not discard digits before the scale is applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'purchase_order_lines'::regclass AND attname = 'quantity'
      AND atttypid = 'real'::regtype
  ) THEN
    ALTER TABLE purchase_order_lines ALTER COLUMN quantity TYPE numeric(16,4)
      USING quantity::double precision::numeric(16,4);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'purchase_order_lines'::regclass AND attname = 'quantity_received'
      AND atttypid = 'real'::regtype
  ) THEN
    ALTER TABLE purchase_order_lines ALTER COLUMN quantity_received TYPE numeric(16,4)
      USING quantity_received::double precision::numeric(16,4);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'purchase_order_lines'::regclass AND attname = 'quantity_billed'
      AND atttypid = 'real'::regtype
  ) THEN
    ALTER TABLE purchase_order_lines ALTER COLUMN quantity_billed TYPE numeric(16,4)
      USING quantity_billed::double precision::numeric(16,4);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'purchase_order_receipt_lines'::regclass AND attname = 'quantity'
      AND atttypid = 'real'::regtype
  ) THEN
    ALTER TABLE purchase_order_receipt_lines ALTER COLUMN quantity TYPE numeric(16,4)
      USING quantity::double precision::numeric(16,4);
  END IF;
END $$;

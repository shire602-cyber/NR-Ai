-- 0160_widen_bill_line_quantity (bill, purchase order and goods receipt quantity precision).
-- Idempotent: widen quantities to four decimal places.
-- Type changes take ACCESS EXCLUSIVE locks and rewrite each changed table once.
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

-- Cast real directly to numeric using PostgreSQL's six-significant-digit conversion.
-- Keep positive values that would round to zero at the minimum quantity of 0.0001.
DO $$
DECLARE
  column_name text;
  converted text;
  changes text[] := ARRAY[]::text[];
BEGIN
  FOR column_name IN
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'purchase_order_lines'::regclass
      AND attname IN ('quantity', 'quantity_received', 'quantity_billed')
      AND atttypid = 'real'::regtype
  LOOP
    converted := format('GREATEST(%1$I::numeric, CASE WHEN %1$I > 0 THEN 0.0001 END)', column_name);
    IF column_name <> 'quantity' THEN
      -- USING reads the old row. Cap each counter at the converted ordered quantity.
      converted := format(
        'LEAST(%s, GREATEST(quantity::numeric, CASE WHEN quantity > 0 THEN 0.0001 END))',
        converted
      );
    END IF;
    changes := array_append(
      changes, format('ALTER COLUMN %I TYPE numeric(16,4) USING %s', column_name, converted)
    );
  END LOOP;
  IF cardinality(changes) > 0 THEN
    EXECUTE 'ALTER TABLE purchase_order_lines ' || array_to_string(changes, ', ');
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
      USING GREATEST(quantity::numeric, CASE WHEN quantity > 0 THEN 0.0001 END);
  END IF;
END $$;

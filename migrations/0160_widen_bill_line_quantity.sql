-- 0160_widen_bill_line_quantity (bill, purchase order and goods receipt quantity precision).
-- Idempotent: widen quantities to four decimal places.
-- Type changes take ACCESS EXCLUSIVE locks and rewrite each changed table once.
DO $$
DECLARE
  table_name text;
  real_columns text[];
  column_name text;
  bad_id text;
  bad_value text;
  changes text[];
  alterations text[] := ARRAY[]::text[];
  alteration text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['purchase_order_lines', 'purchase_order_receipt_lines']
  LOOP
    SELECT array_agg(attname::text ORDER BY attnum) INTO real_columns
    FROM pg_attribute
    WHERE attrelid = table_name::regclass
      AND attname IN ('quantity', 'quantity_received', 'quantity_billed')
      AND atttypid = 'real'::regtype;

    IF real_columns IS NULL THEN
      CONTINUE;
    END IF;

    -- Use the shortest round-trip text the app read, regardless of the caller's setting.
    SET LOCAL extra_float_digits = 1;
    -- Prevent writes between the pre-check and conversion.
    EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', table_name);
    changes := ARRAY[]::text[];

    FOREACH column_name IN ARRAY real_columns
    LOOP
      EXECUTE format(
        'SELECT id::text, %1$I::text FROM %2$I
         WHERE %1$I > 0 AND round(%1$I::text::numeric, 4) = 0
         ORDER BY id LIMIT 1',
        column_name, table_name
      ) INTO bad_id, bad_value;

      IF bad_value IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot widen %.%: id %, value % rounds to 0.0000',
          table_name, column_name, bad_id, bad_value;
      END IF;

      changes := array_append(changes, format(
        'ALTER COLUMN %1$I TYPE numeric(16,4) USING round(%1$I::text::numeric, 4)', column_name
      ));
    END LOOP;

    alterations := array_append(alterations, format(
      'ALTER TABLE %I %s', table_name, array_to_string(changes, ', ')
    ));
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'bill_line_items'::regclass AND attname = 'quantity'
      AND format_type(atttypid, atttypmod) = 'numeric(10,2)'
  ) THEN
    ALTER TABLE bill_line_items ALTER COLUMN quantity TYPE numeric(16,4);
  END IF;

  FOREACH alteration IN ARRAY alterations
  LOOP
    EXECUTE alteration;
  END LOOP;
END $$;

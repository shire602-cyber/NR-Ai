-- Check legacy invoice lines after the release migration has applied 0159.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoice_lines'
      AND column_name = 'document_discount_amount'
      AND data_type = 'numeric' AND numeric_precision = 15 AND numeric_scale = 2
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '0159 did not add a nullable numeric(15,2) invoice line document discount';
  END IF;

  IF EXISTS (SELECT 1 FROM invoice_lines WHERE document_discount_amount IS NOT NULL) THEN
    RAISE EXCEPTION '0159 did not preserve the unknown document discounts on legacy invoice lines';
  END IF;
END
$$;

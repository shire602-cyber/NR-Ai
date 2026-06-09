-- Prevent multiple active full credit-note reversals for the same source invoice.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM invoices
    WHERE invoice_type = 'credit_note'
      AND original_invoice_id IS NOT NULL
      AND status <> 'void'
    GROUP BY company_id, original_invoice_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Multiple active credit notes exist for at least one invoice; resolve duplicate reversals before applying invoices_credit_note_original_once';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_credit_note_original_once
  ON invoices (company_id, original_invoice_id)
  WHERE invoice_type = 'credit_note'
    AND original_invoice_id IS NOT NULL
    AND status <> 'void';

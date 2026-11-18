-- 0130_cash_sale_numbering (CASH-SERIES; W3-A sales): cash sales get their own number series.
-- Idempotent: INSERT ... ON CONFLICT only; no existing document is renumbered or changed.
--
-- Owner decision 2026-11-18: a cash sale takes its number from its own series (doc_type
-- 'cash_sale' in invoice_number_sequences / document_numbering_settings, default prefix "CS"),
-- never from the tax-invoice series. Cash sales issued before this migration keep their
-- numbers (INV-...) exactly; the invoice series is not touched.
--
-- 1) A company where another document type already uses the prefix "CS" gets "CSL" for cash
--    sales, so the default can never collide with an existing prefix.
INSERT INTO document_numbering_settings (company_id, doc_type, prefix, padding, yearly_reset, updated_at)
SELECT DISTINCT s.company_id, 'cash_sale', 'CSL', 5, true, now()
  FROM document_numbering_settings s
 WHERE s.doc_type <> 'cash_sale' AND s.prefix = 'CS'
ON CONFLICT (company_id, doc_type) DO NOTHING;
--> statement-breakpoint
-- 2) Start each cash-sale sequence above any number already written in its format (imported
--    or hand-numbered documents), so the first cash sale can never reuse an existing number.
--    Sequences only move up (GREATEST), so re-running this is a no-op.
WITH fmt AS (
  SELECT c.id AS company_id,
         COALESCE(s.prefix, 'CS') AS prefix,
         COALESCE(s.yearly_reset, true) AS yearly_reset
    FROM companies c
    LEFT JOIN document_numbering_settings s
      ON s.company_id = c.id AND s.doc_type = 'cash_sale'
), docs AS (
  SELECT company_id, number FROM invoices
  UNION ALL SELECT company_id, number FROM credit_notes
  UNION ALL SELECT company_id, number FROM quotes
), hits AS (
  SELECT f.company_id,
         CASE WHEN f.yearly_reset
              THEN substring(d.number from ('^' || f.prefix || '-([0-9]{4})-[0-9]+$'))::int
              ELSE 0 END AS year,
         substring(d.number from '([0-9]+)$')::bigint AS n
    FROM fmt f
    JOIN docs d ON d.company_id = f.company_id
   WHERE d.number ~ ('^' || f.prefix ||
                     CASE WHEN f.yearly_reset THEN '-[0-9]{4}-[0-9]+$' ELSE '-[0-9]+$' END)
)
INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
SELECT company_id, 'cash_sale', year, MAX(n), now()
  FROM hits
 GROUP BY company_id, year
ON CONFLICT (company_id, doc_type, year)
  DO UPDATE SET last_value = GREATEST(invoice_number_sequences.last_value, EXCLUDED.last_value),
                updated_at = now();

-- 0130_cash_sale_numbering (CASH-SERIES; W3-A sales): cash sales get their own number series.
-- Idempotent: INSERT ... ON CONFLICT only; no existing document is renumbered or changed.
--
-- Owner decision 2026-11-18: a cash sale takes its number from its own series (doc_type
-- 'cash_sale' in invoice_number_sequences / document_numbering_settings, default prefix "CS"),
-- never from the tax-invoice series. Cash sales issued before this migration keep their
-- numbers (INV-...) exactly; the invoice series is not touched.
--
-- 1) When CS is occupied, choose the first unused alternative: CSL, CSL2, CSL3, ...
INSERT INTO document_numbering_settings (company_id, doc_type, prefix, padding, yearly_reset, updated_at)
SELECT occupied.company_id, 'cash_sale', candidate.prefix, 5, true, now()
  FROM (SELECT DISTINCT company_id FROM document_numbering_settings
         WHERE doc_type <> 'cash_sale' AND prefix = 'CS') occupied
 CROSS JOIN LATERAL (
   SELECT CASE WHEN n = 1 THEN 'CSL' ELSE 'CSL' || n::text END AS prefix
     FROM generate_series(1, 1 + (SELECT count(*)::integer FROM document_numbering_settings
                                  WHERE company_id = occupied.company_id)) AS series(n)
    WHERE NOT EXISTS (
      SELECT 1 FROM document_numbering_settings s
       WHERE s.company_id = occupied.company_id
         AND s.prefix = CASE WHEN n = 1 THEN 'CSL' ELSE 'CSL' || n::text END
    )
    ORDER BY n LIMIT 1
 ) candidate
ON CONFLICT (company_id, doc_type) DO NOTHING;
--> statement-breakpoint
-- 2) Start each cash-sale sequence above any number already written in its format (imported
--    or hand-numbered documents), so the first cash sale can never reuse an existing number.
--    Only write when the historical maximum advances the existing sequence.
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
  DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = now()
  WHERE invoice_number_sequences.last_value < EXCLUDED.last_value;

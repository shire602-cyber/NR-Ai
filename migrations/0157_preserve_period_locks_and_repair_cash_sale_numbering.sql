-- 0157_preserve_period_locks_and_repair_cash_sale_numbering (accounting audit).
-- Idempotent: identify existing fiscal lock rows and repair cash-sale numbering collisions.
ALTER TABLE month_end_close ADD COLUMN IF NOT EXISTS fiscal_year_lock boolean NOT NULL DEFAULT false;

-- Older fiscal closes wrote both records in one transaction with the same close timestamp.
UPDATE month_end_close m
   SET fiscal_year_lock = true
  FROM fiscal_year_closes f
 WHERE m.company_id = f.company_id AND m.period_end = f.fiscal_year_end
   AND m.status = 'locked' AND f.status = 'closed'
   AND m.lock_scope = 'through'
   AND m.lock_type = CASE WHEN f.hard_closed THEN 'hard' ELSE 'soft' END
   AND m.closed_at = f.closed_at AND m.closed_by IS NOT DISTINCT FROM f.closed_by
   AND m.lock_reason = COALESCE(f.reason, 'Year-end close ' || f.fiscal_year_end::text);

--> statement-breakpoint

-- Include implicit defaults. Prefixes use the same letter/digit/slash/hyphen alphabet as
-- the settings API, so they can also be used literally in the expression for issued numbers.
WITH formats AS (
  SELECT c.id AS company_id, defaults.doc_type,
         COALESCE(s.prefix, defaults.prefix) AS prefix,
         COALESCE(s.padding, 5) AS padding,
         COALESCE(s.yearly_reset, true) AS yearly_reset
    FROM companies c
   CROSS JOIN (VALUES ('cash_sale', 'CS'), ('invoice', 'INV'), ('credit_note', 'CN'),
                      ('debit_note', 'DN'), ('quote', 'QT')) AS defaults(doc_type, prefix)
    LEFT JOIN document_numbering_settings s ON s.company_id = c.id AND s.doc_type = defaults.doc_type
), displaced AS (
  SELECT cash.company_id, other.doc_type
    FROM formats cash
    JOIN formats other ON other.company_id = cash.company_id AND other.doc_type <> 'cash_sale'
   WHERE cash.doc_type = 'cash_sale'
     AND (
       cash.prefix = other.prefix
       OR (cash.yearly_reset AND NOT other.yearly_reset
           AND other.prefix ~ ('^' || cash.prefix || '-(0|[1-9][0-9]{0,3})$'))
       OR (other.yearly_reset AND NOT cash.yearly_reset
           AND cash.prefix ~ ('^' || other.prefix || '-(0|[1-9][0-9]{0,3})$'))
     )
), repaired AS (
  INSERT INTO document_numbering_settings (company_id, doc_type, prefix, padding, yearly_reset, updated_at)
  SELECT cash.company_id, cash.doc_type, candidate.prefix, cash.padding, cash.yearly_reset, now()
    FROM formats cash
   CROSS JOIN LATERAL (
     SELECT proposed.prefix
       FROM generate_series(1, 5) AS series(n)
      CROSS JOIN LATERAL (SELECT CASE WHEN n = 1 THEN 'CSL' ELSE 'CSL' || n::text END AS prefix) proposed
      WHERE NOT EXISTS (
        SELECT 1 FROM formats other
         WHERE other.company_id = cash.company_id AND other.doc_type <> 'cash_sale'
           AND (other.prefix = proposed.prefix
                OR (cash.yearly_reset AND NOT other.yearly_reset
                    AND other.prefix ~ ('^' || proposed.prefix || '-(0|[1-9][0-9]{0,3})$')))
      )
      ORDER BY n LIMIT 1
   ) candidate
   WHERE cash.doc_type = 'cash_sale'
     AND EXISTS (SELECT 1 FROM displaced WHERE displaced.company_id = cash.company_id)
  ON CONFLICT (company_id, doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, updated_at = now()
  RETURNING company_id, doc_type, prefix, yearly_reset
), reserve AS (
  SELECT company_id, doc_type, prefix, yearly_reset FROM repaired
  UNION ALL
  SELECT f.company_id, f.doc_type, f.prefix, f.yearly_reset
    FROM formats f JOIN displaced d USING (company_id, doc_type)
), docs AS (
  SELECT company_id, number FROM invoices
  UNION ALL SELECT company_id, number FROM credit_notes
  UNION ALL SELECT company_id, number FROM quotes
), hits AS (
  SELECT r.company_id, r.doc_type, COALESCE(NULLIF(parts[1], '')::int, 0) AS year, parts[2]::bigint AS n
    FROM reserve r
    JOIN docs d ON d.company_id = r.company_id
   CROSS JOIN LATERAL regexp_match(d.number, '^' || r.prefix ||
     CASE WHEN r.yearly_reset THEN '-(0|[1-9][0-9]{0,3})-([0-9]+)$' ELSE '()-([0-9]+)$' END
   ) AS matched(parts)
   WHERE parts IS NOT NULL
)
INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
SELECT company_id, doc_type, year, MAX(n), now()
  FROM hits
 GROUP BY company_id, doc_type, year
ON CONFLICT (company_id, doc_type, year)
  DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = now()
  WHERE invoice_number_sequences.last_value < EXCLUDED.last_value;

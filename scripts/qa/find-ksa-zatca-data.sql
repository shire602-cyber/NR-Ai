-- Read-only pre-deploy check (STEP2, migration 0133): Saudi ZATCA and the 15% KSA VAT rate were
-- removed from the product. Run on production (or the restored snapshot) BEFORE the release phase:
--   psql "$DATABASE_URL" -f scripts/qa/find-ksa-zatca-data.sql
-- All counts 0 = clear. Stop rule: a non-zero zatca_* count blocks migration 0133 (it refuses to drop
-- a table that holds rows: export it and get owner sign-off first). A non-zero count of POSTED 15%
-- documents needs an owner decision before the deploy: their stored totals and the GL stay as
-- posted, but re-rendering a stored 15% line (PDF, e-invoice) would recompute it at 5%.
-- Draft 15% documents, 15% company defaults (reset to 5% by 0133) and Saudi-address companies are
-- informational. Nothing here writes.
SELECT check_name, n
  FROM (
    SELECT 1 AS ord, 'companies with a Saudi address' AS check_name,
           (SELECT count(*) FROM companies
             WHERE upper(btrim(address_country)) IN ('SA', 'KSA', 'SAU', 'SAUDI ARABIA')) AS n
    UNION ALL
    SELECT 2, 'companies.default_vat_rate = 0.15 (reset to 0.05 by 0133)',
           (SELECT count(*) FROM companies WHERE default_vat_rate = 0.15)
    UNION ALL
    SELECT 3, 'invoice_lines at 15%, invoice posted (draft/void excluded)',
           (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
             WHERE l.vat_rate = 0.15 AND i.status NOT IN ('draft', 'void'))
    UNION ALL
    SELECT 4, 'invoice_lines at 15%, invoice still draft',
           (SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
             WHERE l.vat_rate = 0.15 AND i.status = 'draft')
    UNION ALL
    SELECT 5, 'quote_lines at 15%, quote not draft',
           (SELECT count(*) FROM quote_lines l JOIN quotes q ON q.id = l.quote_id
             WHERE l.vat_rate = 0.15 AND q.status <> 'draft')
    UNION ALL
    SELECT 6, 'quote_lines at 15%, quote still draft',
           (SELECT count(*) FROM quote_lines l JOIN quotes q ON q.id = l.quote_id
             WHERE l.vat_rate = 0.15 AND q.status = 'draft')
    UNION ALL
    SELECT 7, 'credit_note_lines at 15%, credit note issued',
           (SELECT count(*) FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id
             WHERE l.vat_rate = 0.15 AND c.status = 'issued')
    UNION ALL
    SELECT 8, 'credit_note_lines at 15%, credit note draft/void',
           (SELECT count(*) FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id
             WHERE l.vat_rate = 0.15 AND c.status <> 'issued')
    UNION ALL
    SELECT 9, 'recurring_invoices templates whose lines_json holds a 15% rate',
           (SELECT count(*) FROM recurring_invoices
             WHERE lines_json ~ '"vatRate"\s*:\s*"?(0\.15|15)(\.0+)?"?\s*[,}]')
    UNION ALL
    SELECT 10, 'zatca_egs_units rows (blocks 0133)',
           CASE WHEN to_regclass('public.zatca_egs_units') IS NULL THEN 0
                ELSE (xpath('/row/c/text()',
                       query_to_xml('SELECT count(*) AS c FROM zatca_egs_units', false, true, '')))[1]::text::bigint
           END
    UNION ALL
    SELECT 11, 'zatca_documents rows (blocks 0133)',
           CASE WHEN to_regclass('public.zatca_documents') IS NULL THEN 0
                ELSE (xpath('/row/c/text()',
                       query_to_xml('SELECT count(*) AS c FROM zatca_documents', false, true, '')))[1]::text::bigint
           END
    UNION ALL
    SELECT 12, 'audit_logs with a zatca.* action',
           (SELECT count(*) FROM audit_logs WHERE action LIKE 'zatca.%')
    UNION ALL
    SELECT 13, 'products.vat_rate = 0.15 (informational: the API now refuses any rate but 0 and 0.05)',
           (SELECT count(*) FROM products WHERE vat_rate = 0.15)
  ) c
 ORDER BY ord;

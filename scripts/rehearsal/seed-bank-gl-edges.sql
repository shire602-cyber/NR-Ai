-- Exercise same-company destination eligibility and legacy links in each SQL path.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  bank_gl uuid := md5('nr-rehearsal:account:' || company || ':1020')::uuid;
  expense_gl uuid := md5('nr-rehearsal:account:' || company || ':5000')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:1:1')::uuid;
  posting uuid := md5('nr-rehearsal:invoice-payment-posting:' || invoice)::uuid;
  statement_account uuid := md5('nr-rehearsal:bank-account:1')::uuid;
BEGIN
  INSERT INTO accounts (id, company_id, code, name_en, type, sub_type, is_active, is_archived, created_at)
  SELECT md5('nr-rehearsal:bank-edge:gl:' || suffix)::uuid, company, code, name,
         'asset', subtype, active, archived, '2025-12-01'
  FROM (VALUES ('inactive-bank', '9021', 'Inactive bank GL', 'bank', false, false),
               ('archived-bank', '9022', 'Archived bank GL', 'bank', true, true),
               ('nonbank-asset', '9023', 'Equipment GL', 'fixed_asset', true, false),
               ('active-cash', '9024', 'Cash settlement GL', 'cash', true, false)
  ) destinations(suffix, code, name, subtype, active, archived);

  -- A misleading bank subtype cannot override the reserved AR control-account code.
  UPDATE accounts SET sub_type = 'bank'
  WHERE id = md5('nr-rehearsal:account:' || company || ':1040')::uuid;

  INSERT INTO bank_accounts (id, company_id, name_en, bank_name, account_number, gl_account_id, created_at)
  SELECT md5('nr-rehearsal:bank-edge:statement:' || suffix)::uuid, company, suffix,
         'Synthetic Bank', 'EDGE-' || suffix,
         CASE suffix WHEN 'expense' THEN expense_gl
                     WHEN 'control-bank' THEN md5('nr-rehearsal:account:' || company || ':1040')::uuid
                     ELSE md5('nr-rehearsal:bank-edge:gl:' || suffix)::uuid END, '2025-12-01'
  FROM unnest(ARRAY['expense', 'inactive-bank', 'archived-bank', 'nonbank-asset', 'control-bank', 'active-cash']) suffix;

  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                 transaction_date, description, amount, reference, import_source,
                                 is_reconciled, match_status, matched_invoice_id,
                                 matched_journal_entry_id, created_at)
  SELECT md5('nr-rehearsal:bank-edge:line:' || suffix)::uuid, company,
         bank_statement_id, cached_gl, '2026-03-12', 'Legacy statement row ' || suffix,
         37.20, 'GL-EDGE-' || suffix, 'csv:rehearsal-gl-edges', false,
         CASE WHEN suffix LIKE 'legacy-%' THEN 'suggested' ELSE 'unmatched' END,
         CASE WHEN suffix = 'legacy-invoice' THEN invoice END,
         CASE WHEN suffix = 'legacy-journal' THEN posting END, '2026-03-12'
  FROM (
    SELECT suffix, md5('nr-rehearsal:bank-edge:statement:' || suffix)::uuid,
           CASE WHEN suffix = 'active-cash' THEN expense_gl ELSE bank_gl END
    FROM unnest(ARRAY['expense', 'inactive-bank', 'archived-bank', 'nonbank-asset', 'control-bank', 'active-cash']) suffix
    UNION ALL VALUES ('legacy-invoice', statement_account, expense_gl),
                     ('legacy-journal', statement_account, expense_gl)
  ) lines(suffix, bank_statement_id, cached_gl);
END
$$;

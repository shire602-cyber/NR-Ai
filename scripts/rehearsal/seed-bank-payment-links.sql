-- Two invoices have one payment each in a shared balanced posting. A second
-- posting contains two payments for the same invoice, making its link ambiguous.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  actor uuid := md5('nr-rehearsal:owner:1')::uuid;
  bank_gl uuid := md5('nr-rehearsal:account:' || company || ':1020')::uuid;
  receivables_gl uuid := md5('nr-rehearsal:account:' || company || ':1040')::uuid;
  statement_account uuid := md5('nr-rehearsal:bank-account:1')::uuid;
  shared_posting uuid := md5('nr-rehearsal:bank-payment:shared-posting')::uuid;
  ambiguous_posting uuid := md5('nr-rehearsal:bank-payment:ambiguous-posting')::uuid;
BEGIN
  INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status,
                               source, posted_by, posted_at, created_at)
  VALUES (shared_posting, company, '2026-03-10', 'Customer receipt batch', actor, 'JE-EDGE-1',
          'posted', 'payment', actor, '2026-03-10', '2026-03-10'),
         (ambiguous_posting, company, '2026-03-11', 'Partial receipt batch', actor, 'JE-EDGE-2',
          'posted', 'payment', actor, '2026-03-11', '2026-03-11');

  INSERT INTO journal_lines (entry_id, account_id, debit, credit)
  VALUES (shared_posting, bank_gl, 105, 0), (shared_posting, receivables_gl, 0, 105),
         (ambiguous_posting, bank_gl, 35, 0), (ambiguous_posting, receivables_gl, 0, 35);

  INSERT INTO invoice_payments (id, invoice_id, company_id, amount, date, method, reference,
                                payment_account_id, journal_entry_id, created_by, created_at)
  SELECT md5('nr-rehearsal:bank-payment:' || suffix)::uuid,
         md5('nr-rehearsal:invoice:1:' || invoice_number)::uuid, company, amount,
         posted_on, 'bank_transfer', 'EDGE-' || suffix, bank_gl, entry_id, actor, posted_on
  FROM (VALUES ('shared-a', 7, 40, '2026-03-10'::timestamp, shared_posting),
               ('shared-b', 11, 65, '2026-03-10'::timestamp, shared_posting),
               ('ambiguous-a', 10, 20, '2026-03-11'::timestamp, ambiguous_posting),
               ('ambiguous-b', 10, 15, '2026-03-11'::timestamp, ambiguous_posting)
  ) payments(suffix, invoice_number, amount, posted_on, entry_id);

  UPDATE invoices SET status = 'partial'
  WHERE id IN (md5('nr-rehearsal:invoice:1:7')::uuid, md5('nr-rehearsal:invoice:1:11')::uuid);

  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                 transaction_date, description, amount, reference, import_source,
                                 is_reconciled, match_status, matched_invoice_id,
                                 matched_journal_entry_id, created_at)
  SELECT md5('nr-rehearsal:bank-payment:line:' || suffix)::uuid, company, statement_account, bank_gl,
         posted_on, 'Customer receipt ' || suffix, amount, 'EDGE-' || suffix, 'csv:rehearsal-receipts',
         true, 'matched', md5('nr-rehearsal:invoice:1:' || invoice_number)::uuid, entry_id, posted_on
  FROM (VALUES ('shared-a', 7, 40, '2026-03-10'::timestamp, shared_posting),
               ('shared-b', 11, 65, '2026-03-10'::timestamp, shared_posting),
               ('ambiguous', 10, 35, '2026-03-11'::timestamp, ambiguous_posting)
  ) lines(suffix, invoice_number, amount, posted_on, entry_id);
END
$$;

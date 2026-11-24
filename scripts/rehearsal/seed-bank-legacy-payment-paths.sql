-- Reproduce the records written by the pre-0097 manual invoice match route.
-- The unmatched balance created a payment and journal. An already-paid invoice
-- received an invoice link and the bank reconciliation audit only.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:3')::uuid;
  actor uuid := md5('nr-rehearsal:owner:3')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:3:7')::uuid;
  bank_gl uuid := md5('nr-rehearsal:account:' || company || ':1020')::uuid;
  receivables_gl uuid := md5('nr-rehearsal:account:' || company || ':1040')::uuid;
  posting uuid := md5('nr-rehearsal:legacy-payment:posting')::uuid;
  payment uuid := md5('nr-rehearsal:legacy-payment:payment')::uuid;
  bank_line uuid := md5('nr-rehearsal:legacy-payment:bank-created')::uuid;
  paid_invoice uuid := md5('nr-rehearsal:invoice:4:5')::uuid;
  unpaid_invoice uuid := md5('nr-rehearsal:invoice:4:7')::uuid;
  paid_company uuid := md5('nr-rehearsal:company:4')::uuid;
  paid_actor uuid := md5('nr-rehearsal:owner:4')::uuid;
  paid_bank_gl uuid := md5('nr-rehearsal:account:' || paid_company || ':1020')::uuid;
  reference text := 'REHEARSAL-LEGACY-PAYMENT';
  description text := 'Deposit from synthetic customer';
  paid_on timestamp := '2026-03-26';
  recorded_at timestamp := '2026-03-26 09:10:00';
BEGIN
  INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status,
                               source, source_id, posted_by, posted_at, created_at)
  VALUES (posting, company, paid_on, 'Invoice payment by bank reconciliation', actor,
          'JE-LEGACY-BANK-PAYMENT', 'posted', 'payment', invoice, actor, paid_on, recorded_at);

  INSERT INTO journal_lines (entry_id, account_id, debit, credit)
  VALUES (posting, bank_gl, 90.00, 0), (posting, receivables_gl, 0, 90.00);

  INSERT INTO invoice_payments (id, invoice_id, company_id, amount, date, method, reference,
                                notes, payment_account_id, journal_entry_id, created_by,
                                exchange_rate, created_at)
  VALUES (payment, invoice, company, 90.00, paid_on, 'bank_reconciliation', reference,
          'Reconciled from bank statement: ' || description, bank_gl, posting, actor, 1,
          recorded_at);
  UPDATE invoices SET status = 'partial' WHERE id = invoice AND company_id = company;

  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                 transaction_date, description, amount, reference, import_source,
                                 is_reconciled, match_status, matched_invoice_id,
                                 matched_journal_entry_id, created_at)
  VALUES (bank_line, company, md5('nr-rehearsal:bank-account:3')::uuid, bank_gl,
          paid_on, description, 90.00, reference, 'csv:rehearsal-legacy-payment',
          true, 'matched', invoice, posting, paid_on - interval '1 day'),
         (md5('nr-rehearsal:legacy-payment:already-paid')::uuid, paid_company,
          md5('nr-rehearsal:bank-account:4')::uuid, paid_bank_gl, paid_on,
          'Already settled customer invoice', 77.00, 'LEGACY-PAID', 'csv:rehearsal-legacy-payment',
          true, 'matched', paid_invoice, NULL, paid_on - interval '1 day'),
         -- Malformed imported match data can look similar even when no payment settled the invoice.
         (md5('nr-rehearsal:legacy-payment:unsettled')::uuid, paid_company,
          md5('nr-rehearsal:bank-account:4')::uuid, paid_bank_gl, paid_on,
          'Unresolved customer deposit', 77.00, 'LEGACY-UNSETTLED', 'csv:rehearsal-legacy-payment',
          true, 'matched', unpaid_invoice, NULL, paid_on - interval '1 day');

  INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, created_at)
  SELECT md5('nr-rehearsal:legacy-payment:audit:' || suffix)::uuid, user_id,
         'bank.reconcile', 'bank_transaction', line_id::text,
         jsonb_build_object(
           'companyId', company_id,
           'before', jsonb_build_object('matchStatus', 'unmatched'),
           'after', jsonb_build_object('matchedType', 'invoice', 'matchedId', invoice_id,
                                       'matchStatus', 'matched')
         )::text,
         recorded_at + interval '1 second'
    FROM (VALUES
      ('bank-created', actor, company, bank_line, invoice),
      ('already-paid', paid_actor, paid_company, md5('nr-rehearsal:legacy-payment:already-paid')::uuid, paid_invoice),
      ('unsettled', paid_actor, paid_company, md5('nr-rehearsal:legacy-payment:unsettled')::uuid, unpaid_invoice)
    ) matches(suffix, user_id, company_id, line_id, invoice_id);

  INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, created_at)
  SELECT md5('nr-rehearsal:legacy-payment:independent-audit')::uuid, paid_actor,
         'invoice.payment', 'invoice', paid_invoice::text,
         jsonb_build_object(
           'companyId', paid_company,
           'before', jsonb_build_object('status', 'sent', 'totalPaid', 0),
           'after', jsonb_build_object('status', 'paid', 'totalPaid', p.amount),
           'paymentId', p.id, 'journalEntryId', p.journal_entry_id,
           'method', p.method, 'amount', p.amount
         )::text,
         p.created_at + interval '1 second'
    FROM invoice_payments p WHERE p.invoice_id = paid_invoice AND p.company_id = paid_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected a previously entered payment on the already-paid invoice';
  END IF;
END
$$;

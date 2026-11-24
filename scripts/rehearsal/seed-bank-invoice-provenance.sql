-- One bank line links to a payment already entered in the books. A second
-- line owns its invoice-linked journal and has never created an invoice payment.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  actor uuid := md5('nr-rehearsal:owner:1')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:1:3')::uuid;
  bank_gl uuid := md5('nr-rehearsal:account:' || company || ':1020')::uuid;
  receivables_gl uuid := md5('nr-rehearsal:account:' || company || ':1040')::uuid;
  posting uuid := md5('nr-rehearsal:bank-invoice-provenance:posting')::uuid;
  bank_created_line uuid := md5('nr-rehearsal:bank-invoice-provenance:bank-created-line')::uuid;
BEGIN
  -- The old payment service posted with the invoice ID as source_id.
  UPDATE journal_entries SET source_id = md5('nr-rehearsal:invoice:2:5')::uuid
  WHERE id = md5('nr-rehearsal:invoice-payment-posting:' || md5('nr-rehearsal:invoice:2:5')::uuid)::uuid;

  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                  transaction_date, description, amount, reference, import_source,
                                  is_reconciled, match_status, matched_invoice_id,
                                  matched_journal_entry_id, created_at)
  SELECT md5('nr-rehearsal:bank-invoice-provenance:linked-line')::uuid, p.company_id,
         md5('nr-rehearsal:bank-account:2')::uuid, p.payment_account_id,
         p.date, 'Deposit already recorded as a payment', p.amount,
         'BANK-PROVENANCE-LINK', 'csv:rehearsal-invoice-provenance',
         true, 'matched', p.invoice_id, p.journal_entry_id, p.date
    FROM invoice_payments p
   WHERE p.invoice_id = md5('nr-rehearsal:invoice:2:5')::uuid AND p.method = 'bank_transfer';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected a previously entered bank-transfer payment for the linked line';
  END IF;

  INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status,
                               source, source_id, posted_by, posted_at, created_at)
  VALUES (posting, company, '2026-03-22', 'Deposit posted by bank matching', actor,
          'JE-BANK-PROVENANCE', 'posted', 'bank_reconciliation', bank_created_line,
          actor, '2026-03-22', '2026-03-22');

  INSERT INTO journal_lines (entry_id, account_id, debit, credit)
  VALUES (posting, bank_gl, 117.50, 0), (posting, receivables_gl, 0, 117.50);

  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                 transaction_date, description, amount, reference, import_source,
                                 is_reconciled, match_status, matched_invoice_id,
                                 matched_journal_entry_id, created_at)
  VALUES (bank_created_line, company, md5('nr-rehearsal:bank-account:1')::uuid, bank_gl,
          '2026-03-22', 'Deposit posted during reconciliation', 117.50,
          'BANK-PROVENANCE-POST', 'csv:rehearsal-invoice-provenance',
          true, 'matched', invoice, posting, '2026-03-22');
END
$$;

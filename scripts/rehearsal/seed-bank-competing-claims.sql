-- These recorded allocations share one owned payment. The pending claim has no
-- payment_id and can only be identified from its invoice and journal.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:1:1')::uuid;
  posting uuid := md5('nr-rehearsal:invoice-payment-posting:' || invoice)::uuid;
  pending_line uuid := md5('nr-rehearsal:bank-competing-claim:pending-line')::uuid;
  pending_match uuid := md5('nr-rehearsal:bank-competing-claim:pending-match')::uuid;
BEGIN
  INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                                 transaction_date, description, amount, reference, import_source,
                                 is_reconciled, match_status, matched_invoice_id,
                                 matched_journal_entry_id, created_at)
  SELECT pending_line, company, bank_statement_account_id, bank_account_id,
         '2026-03-20', 'Second import of the same transfer', amount,
         'REVIEW-PENDING-CLAIM', 'csv:rehearsal-competing-claim', false, 'suggested',
         invoice, posting, '2026-03-20'
    FROM bank_transactions
   WHERE id = md5('nr-rehearsal:bank-line:1:1')::uuid;

  INSERT INTO bank_transaction_matches (id, company_id, bank_transaction_id, match_group_id,
                                        target_type, target_id, amount, journal_entry_id,
                                        status, created_at)
  SELECT pending_match, company, id, pending_match, 'invoice', invoice, amount, posting,
         'pending', '2026-03-20'
    FROM bank_transactions WHERE id = pending_line;
END
$$;

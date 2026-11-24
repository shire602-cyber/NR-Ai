-- Both reconciled lines are already recorded at 0088. Neither has an allocation
-- yet, so 0097 must account for both when deciding if it can set a payment ID.
INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                               transaction_date, description, amount, reference, import_source,
                               is_reconciled, match_status, matched_invoice_id,
                               matched_journal_entry_id, created_at)
SELECT md5('nr-rehearsal:bank-duplicate-legacy-claim:' || ordinal)::uuid, p.company_id,
       md5('nr-rehearsal:bank-account:1')::uuid, p.payment_account_id,
       p.date, 'Repeated transfer ' || ordinal, p.amount, 'LEGACY-CLAIM-' || ordinal,
       'csv:rehearsal-duplicate-legacy-claim', true, 'matched',
       p.invoice_id, p.journal_entry_id, p.date
  FROM invoice_payments p CROSS JOIN generate_series(1, 2) ordinal
 WHERE p.invoice_id = md5('nr-rehearsal:invoice:1:5')::uuid;

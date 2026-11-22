DO $$
BEGIN
  IF (SELECT count(*) FROM bank_transaction_matches m
      JOIN bank_transactions bt ON bt.id = m.bank_transaction_id AND bt.company_id = m.company_id
      WHERE bt.id IN (SELECT md5('nr-rehearsal:bank-duplicate-legacy-claim:' || n)::uuid
                        FROM generate_series(1, 2) n)
        AND m.status = 'active' AND m.target_type = 'invoice'
        AND m.target_id = bt.matched_invoice_id AND m.journal_entry_id = bt.matched_journal_entry_id
        AND m.payment_id IS NULL AND bt.is_reconciled) <> 2 THEN
    RAISE EXCEPTION '0097 assigned a payment ID to a legacy line with a competing unallocated claim';
  END IF;
END
$$;

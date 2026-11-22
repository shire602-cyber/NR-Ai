-- The active allocation holds the reconciliation details on this imported row.
-- Simulate nullable legacy summary fields without changing the allocation or its posting.
DO $$
BEGIN
  UPDATE bank_transactions bt
     SET bank_account_id = NULL,
         matched_type = NULL,
         matched_invoice_id = NULL,
         matched_journal_entry_id = NULL
   WHERE bt.id = md5('nr-rehearsal:bank-line:2:1')::uuid
     AND bt.is_reconciled AND bt.match_status = 'matched'
     AND EXISTS (
       SELECT 1 FROM bank_transaction_matches m
       WHERE m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
         AND m.status = 'active' AND m.journal_entry_id = bt.matched_journal_entry_id
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay fixture is missing its reconciled line with an active allocation';
  END IF;
END
$$;

-- Original 0097 cleared the stale reconciliations after its GL pass. Verify that the
-- six now-eligible rows still carry their local expense GL and a different managed target.
DO $$
BEGIN
  IF (SELECT count(*)
      FROM bank_transactions bt
      JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
      WHERE bt.id IN (
        SELECT md5('nr-rehearsal:bank-line:' || n || ':2')::uuid FROM generate_series(1, 4) n
        UNION ALL VALUES (md5('nr-rehearsal:bank-link:foreign-statement')::uuid),
                         (md5('nr-rehearsal:bank-link:foreign-target')::uuid)
      )
        AND bt.bank_account_id IS DISTINCT FROM ba.gl_account_id
        AND bt.bank_account_id = md5('nr-rehearsal:account:' || bt.company_id || ':5000')::uuid
        AND NOT bt.is_reconciled AND bt.match_status = 'unmatched'
        AND bt.matched_journal_entry_id IS NULL AND bt.matched_invoice_id IS NULL AND bt.matched_receipt_id IS NULL
  ) <> 6 THEN
    RAISE EXCEPTION 'Historical fixture did not retain the six stale GL links after original 0097';
  END IF;
END
$$;

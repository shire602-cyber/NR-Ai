-- Check immediately after guarded 0097, before the forward repair can mask an ordering regression.
DO $$
DECLARE
  company_ids uuid[] := ARRAY(SELECT md5('nr-rehearsal:company:' || n)::uuid FROM generate_series(1, 4) n ORDER BY n);
  affected_company uuid := company_ids[1];
  foreign_company uuid := company_ids[2];
BEGIN
  IF (SELECT count(*) FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
      WHERE bt.id IN (SELECT md5('nr-rehearsal:bank-line:' || n || ':2')::uuid FROM generate_series(1, 4) n)
        AND NOT bt.is_reconciled AND bt.match_status = 'unmatched' AND bt.bank_account_id = ba.gl_account_id) <> 4 THEN
    RAISE EXCEPTION '0097 did not clear stale bank reconciliation and relink the four fees to their managed GL accounts';
  END IF;

  IF (SELECT count(*) FROM bank_transaction_matches WHERE company_id = ANY (company_ids) AND status = 'active') <> 4
     OR (SELECT count(*) FROM bank_transaction_matches m
         JOIN bank_transactions bt ON bt.id = m.bank_transaction_id AND bt.company_id = m.company_id
         JOIN invoice_payments p ON p.id = m.payment_id AND p.journal_entry_id = bt.matched_journal_entry_id
         WHERE m.company_id = ANY (company_ids) AND m.target_type = 'invoice' AND m.status = 'active'
           AND m.target_id = bt.matched_invoice_id AND m.journal_entry_id = bt.matched_journal_entry_id
           AND m.amount = bt.amount AND bt.is_reconciled AND bt.match_status = 'matched'
           AND bt.matched_type = 'invoice') <> 4 THEN
    RAISE EXCEPTION '0097 did not preserve all four valid invoice allocations';
  END IF;

  IF (SELECT count(*)
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
      WHERE bt.bank_account_id = ba.gl_account_id
        AND ((bt.id = md5('nr-rehearsal:bank-line:4:1')::uuid AND bt.is_reconciled)
          OR (bt.id = md5('nr-rehearsal:bank-line:1:3')::uuid AND NOT bt.is_reconciled))) <> 2 THEN
    RAISE EXCEPTION 'Bank migration did not preserve or fill the correct local GL for both sample rows';
  END IF;

  IF (SELECT count(*)
      FROM bank_transactions bt
      JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
      JOIN accounts target ON target.id = ba.gl_account_id
      WHERE bt.company_id = affected_company
        AND bt.bank_account_id = md5('nr-rehearsal:account:' || affected_company || ':5000')::uuid
        AND NOT bt.is_reconciled AND bt.match_status = 'unmatched'
        AND (
          (bt.id = md5('nr-rehearsal:bank-link:foreign-statement')::uuid
            AND ba.id = md5('nr-rehearsal:bank-account:2')::uuid
            AND ba.company_id = foreign_company AND target.company_id = foreign_company)
          OR
          (bt.id = md5('nr-rehearsal:bank-link:foreign-target')::uuid
            AND ba.id = md5('nr-rehearsal:bank-account:foreign-target')::uuid
            AND ba.company_id = affected_company AND target.company_id = foreign_company)
        )) <> 2 THEN
    RAISE EXCEPTION '0097 adopted a foreign statement or target GL link or failed to clear a stale match';
  END IF;
END
$$;

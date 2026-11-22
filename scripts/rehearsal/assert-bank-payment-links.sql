-- The allocation's payment must resolve by the whole company/invoice/journal tuple.
DO $$
BEGIN
  IF (SELECT count(*)
      FROM (VALUES ('shared-a', 'shared-a'), ('shared-b', 'shared-b'), ('ambiguous', NULL)) expected(suffix, payment)
      JOIN bank_transactions bt ON bt.id = md5('nr-rehearsal:bank-payment:line:' || expected.suffix)::uuid
      JOIN bank_transaction_matches m ON m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
      WHERE m.target_type = 'invoice' AND m.status = 'active' AND NOT m.created_journal
        AND m.target_id = bt.matched_invoice_id AND m.journal_entry_id = bt.matched_journal_entry_id
        AND m.payment_id IS NOT DISTINCT FROM md5('nr-rehearsal:bank-payment:' || expected.payment)::uuid
        AND m.amount = bt.amount AND bt.is_reconciled AND bt.match_status = 'matched') <> 3 THEN
    RAISE EXCEPTION '0097 mislinked payments on the shared journal or selected an ambiguous candidate';
  END IF;
END
$$;

SELECT jsonb_agg(m.created_journal ORDER BY expected.ordinal)
  FROM (VALUES ('bank-created', 1), ('receipt-owned', 2), ('foreign-receipt', 3))
       expected(suffix, ordinal)
  JOIN bank_transactions bt
    ON bt.id = md5('nr-rehearsal:receipt-provenance:transaction:' || expected.suffix)::uuid
  JOIN bank_transaction_matches m ON m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
 WHERE m.status = 'active' AND m.target_type = 'receipt'
   AND m.target_id = bt.matched_receipt_id AND m.journal_entry_id = bt.matched_journal_entry_id;

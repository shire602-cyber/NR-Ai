SELECT jsonb_agg(jsonb_build_array(m.payment_id IS NOT NULL, m.created_journal)
                 ORDER BY expected.ordinal)
  FROM (VALUES ('linked-line', 1), ('bank-created-line', 2)) expected(suffix, ordinal)
  JOIN bank_transactions bt
    ON bt.id = md5('nr-rehearsal:bank-invoice-provenance:' || expected.suffix)::uuid
  JOIN bank_transaction_matches m ON m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
  JOIN invoices inv ON inv.id = bt.matched_invoice_id AND inv.company_id = bt.company_id
  JOIN journal_entries j ON j.id = m.journal_entry_id AND j.company_id = bt.company_id
  LEFT JOIN invoice_payments p ON p.journal_entry_id = j.id AND p.invoice_id = inv.id
    AND p.company_id = bt.company_id
 WHERE m.status = 'active' AND m.target_type = 'invoice'
   AND m.target_id = inv.id AND m.journal_entry_id = bt.matched_journal_entry_id
   AND bt.is_reconciled AND bt.match_status = 'matched' AND j.status = 'posted'
   AND (m.payment_id IS NULL OR m.payment_id = p.id)
   AND (expected.ordinal = 1 AND p.method = 'bank_transfer' AND j.source = 'payment'
         AND j.source_id = inv.id
      OR expected.ordinal = 2 AND p.id IS NULL
         AND j.source = 'bank_reconciliation' AND j.source_id = bt.id);

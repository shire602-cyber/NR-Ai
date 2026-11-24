DO $$
DECLARE
  paid_company uuid := md5('nr-rehearsal:company:4')::uuid;
  paid_invoice uuid := md5('nr-rehearsal:invoice:4:5')::uuid;
BEGIN
  IF (SELECT count(*)
        FROM (VALUES ('bank-created', 3, 7, 'partial'), ('already-paid', 4, 5, 'paid'),
                     ('unsettled', 4, 7, 'sent')) expected(suffix, tenant, invoice_number, invoice_status)
        JOIN bank_transactions bt ON bt.id = md5('nr-rehearsal:legacy-payment:' || expected.suffix)::uuid
        JOIN bank_transaction_matches m ON m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
        JOIN invoices inv ON inv.id = m.target_id AND inv.company_id = bt.company_id
        JOIN audit_logs a ON a.id = md5('nr-rehearsal:legacy-payment:audit:' || expected.suffix)::uuid
        LEFT JOIN invoice_payments p ON p.id = m.payment_id
        LEFT JOIN journal_entries j ON j.id = m.journal_entry_id
       WHERE bt.company_id = md5('nr-rehearsal:company:' || expected.tenant)::uuid
         AND inv.id = md5('nr-rehearsal:invoice:' || expected.tenant || ':' || expected.invoice_number)::uuid
         AND inv.status = expected.invoice_status AND bt.is_reconciled AND bt.match_status = 'matched'
         AND bt.matched_invoice_id = inv.id AND bt.matched_receipt_id IS NULL
         AND m.target_type = 'invoice' AND m.status = 'active' AND NOT m.created_journal
         AND m.idempotency_key IS NULL AND m.created_by IS NULL
         AND m.journal_entry_id IS NOT DISTINCT FROM bt.matched_journal_entry_id
         AND a.company_id = bt.company_id AND a.legacy AND a.hash IS NOT NULL AND a.seq IS NOT NULL
         AND a.action = 'bank.reconcile' AND a.resource_type = 'bank_transaction'
         AND a.resource_id = bt.id::text AND a.user_id = md5('nr-rehearsal:owner:' || expected.tenant)::uuid
         AND a.details::jsonb = jsonb_build_object(
           'companyId', bt.company_id, 'before', jsonb_build_object('matchStatus', 'unmatched'),
           'after', jsonb_build_object('matchedType', 'invoice', 'matchedId', inv.id, 'matchStatus', 'matched')
         )
         AND (
           (expected.suffix = 'bank-created'
             AND p.id = md5('nr-rehearsal:legacy-payment:payment')::uuid
             AND p.company_id = bt.company_id AND p.invoice_id = inv.id AND p.journal_entry_id = j.id
             AND p.method = 'bank_reconciliation' AND p.reference = bt.reference
             AND p.notes = 'Reconciled from bank statement: ' || bt.description
             AND p.amount = bt.amount AND p.date = bt.transaction_date
             AND p.payment_account_id = bt.bank_account_id AND p.created_by = a.user_id
             AND p.created_at <= a.created_at
             AND j.company_id = bt.company_id AND j.source = 'payment' AND j.source_id = inv.id
             AND j.status = 'posted')
           OR (expected.suffix <> 'bank-created' AND m.payment_id IS NULL AND m.journal_entry_id IS NULL)
         )) <> 3 THEN
    RAISE EXCEPTION 'Migration did not preserve the reconstructed legacy allocations and audit evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM invoice_payments p
    JOIN invoices inv ON inv.id = p.invoice_id AND inv.company_id = p.company_id
    JOIN audit_logs a ON a.id = md5('nr-rehearsal:legacy-payment:independent-audit')::uuid
    WHERE inv.id = paid_invoice AND inv.company_id = paid_company AND inv.total = p.amount
      AND a.company_id = paid_company AND a.legacy AND a.hash IS NOT NULL AND a.seq IS NOT NULL
      AND a.action = 'invoice.payment' AND a.resource_type = 'invoice'
      AND a.resource_id = inv.id::text AND a.user_id = p.created_by
      AND a.details::jsonb->>'paymentId' = p.id::text
      AND a.details::jsonb->>'journalEntryId' = p.journal_entry_id::text
  ) THEN
    RAISE EXCEPTION 'The already-paid invoice lost its separately posted payment or direct audit evidence';
  END IF;

  IF (SELECT count(*)
        FROM bank_gl_migration_findings f
        CROSS JOIN LATERAL jsonb_array_elements(f.details->'allocations') allocation(details)
       WHERE f.bank_transaction_id IN (md5('nr-rehearsal:legacy-payment:already-paid')::uuid,
                                       md5('nr-rehearsal:legacy-payment:unsettled')::uuid)
         AND f.company_id = paid_company AND f.kind = 'invoice_payment_link_review'
         AND (allocation.details->'problems') ?& ARRAY['journal_missing', 'payment_link_missing']) <> 2 THEN
    RAISE EXCEPTION 'Expected historical missing-link findings for both journal-free invoice matches';
  END IF;
END
$$;

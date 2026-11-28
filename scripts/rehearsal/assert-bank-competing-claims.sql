DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  active_line uuid := md5('nr-rehearsal:bank-line:1:1')::uuid;
  pending_line uuid := md5('nr-rehearsal:bank-competing-claim:pending-line')::uuid;
  foreign_line uuid := md5('nr-rehearsal:bank-competing-claim:foreign-line')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:1:1')::uuid;
  payment uuid;
BEGIN
  SELECT p.id INTO STRICT payment FROM invoice_payments p
  JOIN bank_transactions bt ON bt.matched_journal_entry_id = p.journal_entry_id
  WHERE bt.id = active_line AND p.company_id = company AND p.invoice_id = invoice;

  IF (SELECT count(*)
        FROM (VALUES (active_line, payment, 'active'), (pending_line, NULL, 'pending'))
             expected(transaction_id, payment_id, status)
        JOIN bank_transaction_matches m ON m.bank_transaction_id = expected.transaction_id
        JOIN bank_gl_migration_findings f ON f.bank_transaction_id = expected.transaction_id
          AND f.company_id = company AND f.kind = 'invoice_payment_competing_claims'
        CROSS JOIN LATERAL jsonb_array_elements(f.details->'claims') claim(details)
       WHERE m.company_id = company AND m.target_id = invoice AND m.status = expected.status
         AND m.payment_id IS NOT DISTINCT FROM expected.payment_id
         AND (claim.details->>'match_id')::uuid = m.id
         AND (claim.details->>'claimed_payment_id')::uuid = payment
         AND (claim.details->>'stored_payment_id')::uuid IS NOT DISTINCT FROM expected.payment_id
         AND (claim.details->>'claim_count')::int = 2) <> 2 THEN
    RAISE EXCEPTION 'Competing-claim findings did not include both the linked and inferred payment while preserving their stored IDs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM bank_gl_migration_findings f
    CROSS JOIN LATERAL jsonb_array_elements(f.details->'allocations') allocation(details)
    WHERE f.bank_transaction_id = foreign_line AND f.company_id = company
      AND f.kind = 'invoice_payment_link_review'
      AND (allocation.details->'problems') ?& ARRAY['invoice_company_mismatch', 'journal_company_mismatch']
  ) OR NOT EXISTS (
    SELECT 1 FROM bank_gl_migration_findings
    WHERE bank_transaction_id = foreign_line AND company_id = company
      AND kind = 'cached_gl_company_mismatch'
  ) THEN
    RAISE EXCEPTION 'Foreign invoice, posting, or cached GL references were not reported';
  END IF;
END
$$;

DO $$
BEGIN
  IF (SELECT count(*)
      FROM (VALUES ('shared-a', 1, 'shared_payment_journal'), ('shared-b', 1, 'shared_payment_journal'),
                   ('ambiguous', 2, 'duplicate_payment_candidates')) expected(suffix, candidates, problem)
      JOIN bank_gl_migration_findings f ON f.kind = 'invoice_payment_link_review'
        AND f.bank_transaction_id = md5('nr-rehearsal:bank-payment:line:' || expected.suffix)::uuid
      CROSS JOIN LATERAL jsonb_array_elements(f.details->'allocations') a(data)
      WHERE f.company_id = md5('nr-rehearsal:company:1')::uuid
        AND (a.data->>'candidate_count')::int = expected.candidates
        AND (a.data->>'journal_payment_count')::int = 2
        AND (a.data->'problems') ? expected.problem) <> 3 THEN
    RAISE EXCEPTION 'Bank allocation audit did not distinguish a shared journal from an ambiguous invoice link';
  END IF;
END
$$;

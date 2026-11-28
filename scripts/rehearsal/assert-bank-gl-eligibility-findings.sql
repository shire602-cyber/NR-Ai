DO $$
BEGIN
  IF (SELECT count(*)
      FROM (VALUES ('expense', 'target_gl_ineligible'), ('inactive-bank', 'target_gl_ineligible'),
                   ('archived-bank', 'target_gl_ineligible'), ('nonbank-asset', 'target_gl_ineligible'),
                   ('control-bank', 'target_gl_ineligible'), ('legacy-invoice', 'cached_gl_ineligible'),
                   ('legacy-journal', 'cached_gl_ineligible')) expected(suffix, kind)
      JOIN bank_gl_migration_findings f ON f.kind = expected.kind
        AND f.bank_transaction_id = md5('nr-rehearsal:bank-edge:line:' || expected.suffix)::uuid
      WHERE f.company_id = md5('nr-rehearsal:company:1')::uuid) <> 7
     OR EXISTS (
       SELECT 1 FROM bank_gl_migration_findings
       WHERE bank_transaction_id = md5('nr-rehearsal:bank-edge:line:active-cash')::uuid
     ) THEN
    RAISE EXCEPTION 'Bank GL audit did not report the expected ineligible same-company destinations and caches';
  END IF;
END
$$;

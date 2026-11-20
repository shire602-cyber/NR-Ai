-- Each independently unsafe link must produce one durable discovery with the relevant IDs.
DO $$
DECLARE
  local_company uuid := md5('nr-rehearsal:company:1')::uuid;
  foreign_company uuid := md5('nr-rehearsal:company:2')::uuid;
  foreign_statement uuid := md5('nr-rehearsal:bank-link:foreign-statement')::uuid;
  foreign_target uuid := md5('nr-rehearsal:bank-link:foreign-target')::uuid;
BEGIN
  IF EXISTS (
    WITH expected(bank_transaction_id, company_id, kind, details) AS (
      SELECT id, local_company, kind, jsonb_build_object(
        'statement_account_id', statement_account_id,
        'statement_company_id', statement_company_id,
        'target_gl_account_id', md5('nr-rehearsal:account:' || foreign_company || ':1020')::uuid,
        'target_gl_company_id', foreign_company,
        'cached_gl_account_id', md5('nr-rehearsal:account:' || local_company || ':5000')::uuid
      )
      FROM (VALUES
        (foreign_statement, 'statement_company_mismatch',
          md5('nr-rehearsal:bank-account:2')::uuid, foreign_company),
        (foreign_target, 'target_gl_company_mismatch',
          md5('nr-rehearsal:bank-account:foreign-target')::uuid, local_company)
      ) defects(id, kind, statement_account_id, statement_company_id)
    ), actual AS (
      SELECT bank_transaction_id, company_id, kind, details FROM bank_gl_migration_findings
      WHERE company_id = local_company OR bank_transaction_id IN (foreign_statement, foreign_target)
    )
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION 'Bank GL diagnostics did not record exactly the two expected ownership mismatches';
  END IF;
END
$$;

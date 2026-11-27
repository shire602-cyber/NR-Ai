-- DEPLOY-RUNBOOK section 2b + 2d (AFTER migrating).
\pset footer off
\echo '== row counts'
SELECT (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM company_users) AS company_users, (SELECT count(*) FROM journal_entries) AS journal_entries,
       (SELECT count(*) FROM invoices) AS invoices, (SELECT count(*) FROM drizzle.__drizzle_migrations) AS ledger_rows;
\echo '== 0090 / 0092 findings'
SELECT kind, count(*) FROM ledger_repair_findings GROUP BY kind ORDER BY 2 DESC;
SELECT kind, count(*) FROM identity_migration_findings GROUP BY kind ORDER BY 2 DESC;
\echo '== 0092 pending invitations, roles after'
SELECT count(*) AS pending_invitations FROM company_invitations WHERE status = 'pending';
SELECT role, count(*) FROM company_users GROUP BY role ORDER BY 2 DESC;
SELECT count(*) AS placeholder_users_left FROM users WHERE password_hash = '';
\echo '== 0094 FX flags'
SELECT count(*) AS rates, count(*) FILTER (WHERE legacy_unscoped) AS legacy_unscoped,
       count(*) FILTER (WHERE legacy_inverted) AS legacy_inverted,
       count(*) FILTER (WHERE company_id IS NOT NULL) AS company_scoped FROM exchange_rates;
\echo '== 0097 deactivated rules'
SELECT count(*) AS deactivated_rules FROM reconciliation_rules WHERE NOT is_active;
\echo '== 0103 portal tokens'
SELECT count(*) AS hashed_link_tokens FROM portal_access_tokens WHERE kind = 'link';
SELECT count(*) AS plaintext_left FROM customer_contacts WHERE portal_access_token IS NOT NULL;
SELECT count(*) AS contact_backfill_findings FROM portal_contact_backfill_findings;
\echo '== 0108 firm backfill'
SELECT (SELECT count(*) FROM firms) AS firms, (SELECT count(*) FROM firm_members) AS firm_members,
       (SELECT count(*) FROM firm_client_links) AS client_links, (SELECT count(*) FROM firm_company_grants) AS company_grants;
\echo '== 0109 audit chain'
SELECT count(*) FILTER (WHERE legacy) AS legacy_chained, count(*) AS total,
       count(*) FILTER (WHERE seq IS NULL) AS unsealed FROM audit_logs;
\echo '== 0113 subscriptions'
SELECT count(*) AS free_rows FROM subscriptions WHERE plan_id = 'free';
SELECT count(*) AS companies_without_subscription FROM companies c WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);
\echo '== 2d 0118 employee unique indexes'
SELECT 'uq_employees_company_employee_number' AS expected, to_regclass('uq_employees_company_employee_number') IS NOT NULL AS present
UNION ALL SELECT 'uq_employees_company_iban', to_regclass('uq_employees_company_iban') IS NOT NULL
UNION ALL SELECT 'uq_employees_company_emirates_id', to_regclass('uq_employees_company_emirates_id') IS NOT NULL;
\echo '== S-H3 0054 owner account state (must be unchanged by the chain)'
SELECT email, is_admin, user_type, firm_role FROM users WHERE lower(email) = 'shire602@gmail.com';

\echo '== 2d required schema assertions'
DO $$
DECLARE
  stale_tables text[];
  missing_indexes text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name) INTO stale_tables
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND (table_name LIKE 'zatca\_%' OR table_name IN ('subscription_plans', 'user_subscriptions'));
  SELECT array_agg(expected ORDER BY expected) INTO missing_indexes
    FROM unnest(ARRAY['uq_employees_company_employee_number', 'uq_employees_company_iban',
                      'uq_employees_company_emirates_id']) AS indexes(expected)
   WHERE NOT EXISTS (
     SELECT FROM pg_index WHERE indexrelid = to_regclass('public.' || expected)
       AND indisvalid AND indisunique
   );
  IF stale_tables IS NOT NULL OR missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Release schema check failed. Stale tables: %. Missing or invalid indexes: %.',
      coalesce(stale_tables::text, '{}'), coalesce(missing_indexes::text, '{}');
  END IF;
END $$;

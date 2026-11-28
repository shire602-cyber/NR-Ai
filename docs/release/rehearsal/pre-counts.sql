-- DEPLOY-RUNBOOK section 2a (BEFORE migrating).
\pset footer off
\echo '== row counts (section 1)'
SELECT (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM company_users) AS company_users, (SELECT count(*) FROM journal_entries) AS journal_entries,
       (SELECT count(*) FROM invoices) AS invoices, (SELECT count(*) FROM drizzle.__drizzle_migrations) AS ledger_rows;
\echo '== 0092 placeholder users / memberships'
SELECT count(*) AS placeholder_users FROM users WHERE password_hash = '';
SELECT count(*) AS placeholder_memberships FROM company_users cu JOIN users u ON u.id = cu.user_id WHERE u.password_hash = '';
\echo '== 0092 roles to rewrite'
SELECT role, count(*) FROM company_users
 WHERE role NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer')
 GROUP BY role ORDER BY 2 DESC;
SELECT count(*) AS roles_mapping_to_employee FROM company_users
 WHERE role NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer')
   AND lower(trim(role)) NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer',
                                 'cfo','manager','readonly','read_only','read-only');
\echo '== 0092 email-case duplicates'
SELECT count(*) AS email_case_duplicates FROM (SELECT lower(trim(email)) FROM users GROUP BY 1 HAVING count(*) > 1) d;
\echo '== 0094 FX'
SELECT (SELECT count(*) FROM companies) AS companies, count(*) AS rates,
       count(*) FILTER (WHERE source <> 'fta') AS non_fta_rates,
       count(*) FILTER (WHERE source = 'manual') AS manual_rates FROM exchange_rates;
\echo '== 0097 reconciliation rules (all active rules are unscoped before account_id exists)'
SELECT count(*) FILTER (WHERE match_type NOT IN ('exact','contains','starts_with','regex','equals','equal','is')) AS bad_match_type,
       count(*) FILTER (WHERE is_active) AS active FROM reconciliation_rules;
SELECT count(*) FILTER (WHERE to_jsonb(r)->>'account_id' IS NULL AND is_active) AS active_without_account
  FROM reconciliation_rules r;
\echo '== 0103 plaintext portal tokens'
SELECT count(*) AS plaintext_portal_tokens FROM customer_contacts WHERE portal_access_token IS NOT NULL;
\echo '== 0113 Free subscriptions and companies without a subscription'
\ir subscription-counts.sql
SELECT :free_rows AS free_rows, :companies_without_subscription AS companies_without_subscription;
\echo '== 0109 audit rows'
SELECT count(*) AS audit_rows FROM audit_logs;
\echo '== S-H3 0054 owner account state'
SELECT email, is_admin, user_type, firm_role FROM users WHERE lower(email) = 'shire602@gmail.com';

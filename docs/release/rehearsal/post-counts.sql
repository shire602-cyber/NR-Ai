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
\echo '== 0113 Free subscriptions and companies without a subscription'
\ir subscription-counts.sql
SELECT :'free_rows'::bigint - :'pre_free'::bigint AS free_rows_added,
       :'pre_missing'::bigint AS expected_free_rows_added,
       :'companies_without_subscription'::bigint AS companies_without_subscription;
SELECT :'free_rows'::bigint - :'pre_free'::bigint = :'pre_missing'::bigint
       AND :'companies_without_subscription'::bigint = 0 AS subscription_backfill_ok
\gset
\if :subscription_backfill_ok
\else
DO $$ BEGIN
  RAISE EXCEPTION 'Free subscription increase does not match the pre-migration gap, or companies still lack a subscription';
END $$;
\endif

\echo '== S-H3 0054 owner account state (must be unchanged by the chain)'
SELECT email, is_admin, user_type, firm_role FROM users WHERE lower(email) = 'shire602@gmail.com';

\echo '== 2d required schema assertions'
-- Pin the search path for consistent deparsing and catalog name resolution.
SET search_path = pg_catalog;
DO $$
DECLARE
  stale_tables text[];
  incorrect_indexes text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO stale_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'f', 'v', 'm')
     AND (c.relname LIKE 'zatca\_%' OR c.relname IN ('subscription_plans', 'user_subscriptions'));

  -- Compare PostgreSQL's canonical definition, including the access method,
  -- indexed expressions, and partial predicates from migration 0118.
  WITH expected(name, definition) AS (VALUES
    ('uq_employees_company_employee_number',
     $index$(company_id, lower(btrim(employee_number))) WHERE ((archived_at IS NULL) AND (employee_number IS NOT NULL) AND (btrim(employee_number) <> ''::text))$index$),
    ('uq_employees_company_iban',
     $index$(company_id, upper(regexp_replace(iban, '\s'::text, ''::text, 'g'::text))) WHERE ((archived_at IS NULL) AND (status <> 'terminated'::text) AND (iban IS NOT NULL) AND (regexp_replace(iban, '\s'::text, ''::text, 'g'::text) <> ''::text))$index$),
    ('uq_employees_company_emirates_id',
     $index$(company_id, regexp_replace(emirates_id, '[^0-9]'::text, ''::text, 'g'::text)) WHERE ((archived_at IS NULL) AND (status <> 'terminated'::text) AND (emirates_id IS NOT NULL) AND (regexp_replace(emirates_id, '[^0-9]'::text, ''::text, 'g'::text) <> ''::text))$index$)
  )
  SELECT array_agg(name ORDER BY name) INTO incorrect_indexes
    FROM expected
   WHERE NOT EXISTS (
     SELECT FROM pg_index
      WHERE indexrelid = to_regclass('public.' || name)
        AND indrelid = 'public.employees'::regclass
        AND indisvalid AND indisready AND indislive AND indisunique
        AND pg_get_indexdef(indexrelid) =
            format('CREATE UNIQUE INDEX %I ON public.employees USING btree %s', name, definition)
   );

  IF stale_tables IS NOT NULL OR incorrect_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Release schema check failed. Stale tables: %. Missing, invalid or incorrect payroll indexes: %.',
      coalesce(stale_tables::text, '{}'), coalesce(incorrect_indexes::text, '{}');
  END IF;
END $$;

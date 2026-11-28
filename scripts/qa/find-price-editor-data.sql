-- Read-only pre-deploy check (STEP3, migration 0134): the unused admin price editor was removed
-- and its two tables are dropped. Run on production (or the restored snapshot) BEFORE the release:
--   psql "$DATABASE_URL" -f scripts/qa/find-price-editor-data.sql
-- Both counts 0 = clear. Stop rule: a non-zero count blocks migration 0134 (it refuses to drop a
-- table that holds rows). Export first (\copy subscription_plans TO 'subscription_plans.csv' CSV
-- HEADER), get owner sign-off, TRUNCATE, then deploy. Those rows never affected any price (every
-- surface reads shared/plans.ts). Nothing here writes.
SELECT 'subscription_plans' AS table_name,
       CASE WHEN to_regclass('public.subscription_plans') IS NULL THEN 0
            ELSE (xpath('/row/n/text()',
                   query_to_xml('SELECT count(*) AS n FROM subscription_plans', false, true, '')))[1]::text::bigint
       END AS n
UNION ALL
SELECT 'user_subscriptions',
       CASE WHEN to_regclass('public.user_subscriptions') IS NULL THEN 0
            ELSE (xpath('/row/n/text()',
                   query_to_xml('SELECT count(*) AS n FROM user_subscriptions', false, true, '')))[1]::text::bigint
       END;

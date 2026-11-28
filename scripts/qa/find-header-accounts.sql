-- Read-only pre-deploy check (X6a, council REQUIRED 1): parent/child pairs in the chart of
-- accounts and what the ledger does with each parent after this release.
--
-- The ledger refuses postings only to a CASH or BANK account that has active sub-accounts
-- (ACCOUNT_IS_HEADER). Sub-accounts under any other account (4010 sales, 1040 receivables,
-- 2020 VAT, 5000 expenses, ...) are reporting groups and the parent keeps receiving postings.
--
--   verdict = 'header_refused'      cash/bank parent: postings to it are refused; payments
--                                   default to one of its leaves. Expected for 1020 once bank
--                                   accounts exist.
--   verdict = 'bank_gl_header'      the GL account behind a managed bank account has
--                                   sub-accounts: statement matching / payments to that bank
--                                   account would be refused. FIX BEFORE DEPLOY (move the
--                                   children under 1020 or archive them).
--   verdict = 'posting_parent_ok'   any other parent: postings continue as before.
--
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/qa/find-header-accounts.sql
-- Changes nothing (the whole check runs in a READ ONLY transaction).
BEGIN READ ONLY;

SELECT c.name AS company,
       p.company_id,
       p.code AS parent_code,
       p.name_en AS parent_name,
       p.sub_type AS parent_sub_type,
       p.is_system_account AS parent_is_system,
       COUNT(ch.id)::int AS active_children,
       string_agg(ch.code, ', ' ORDER BY ch.code) AS child_codes,
       CASE
         WHEN p.sub_type IN ('cash', 'bank')
              AND EXISTS (SELECT 1 FROM bank_accounts ba
                           WHERE ba.company_id = p.company_id AND ba.gl_account_id = p.id)
           THEN 'bank_gl_header'
         WHEN p.sub_type IN ('cash', 'bank') THEN 'header_refused'
         ELSE 'posting_parent_ok'
       END AS verdict
  FROM accounts p
  JOIN accounts ch ON ch.parent_id = p.id AND ch.company_id = p.company_id
                  AND ch.is_archived = false
  JOIN companies c ON c.id = p.company_id
 GROUP BY c.name, p.company_id, p.id, p.code, p.name_en, p.sub_type, p.is_system_account
 ORDER BY verdict, c.name, p.code;

COMMIT;

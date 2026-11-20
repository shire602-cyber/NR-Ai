-- Read-only pre-deploy check: parent (header) accounts that carry posted journal lines.
-- Run on production (or the restored snapshot) BEFORE deploying a build that blocks posting to
-- parent accounts. Usage: psql "$DATABASE_URL" -f scripts/qa/find-header-posting-accounts.sql
-- Every row returned needs an owner decision (re-point the lines to a child account via a reversing
-- adjustment, or make the account a leaf by clearing its children's parent_id). Zero rows = clear.
-- (If worker X6a's version of this check exists under the same name, prefer it; this one is standalone.)
SELECT a.company_id,
       a.code,
       a.name_en,
       a.type,
       count(DISTINCT c.id)              AS child_accounts,
       count(jl.id)                      AS posted_lines,
       min(je.date)                      AS first_posting,
       max(je.date)                      AS last_posting
  FROM accounts a
  JOIN accounts c ON c.parent_id = a.id AND c.company_id = a.company_id
  JOIN journal_lines jl ON jl.account_id = a.id
  JOIN journal_entries je ON je.id = jl.entry_id
 WHERE je.status = 'posted'
 GROUP BY a.company_id, a.code, a.name_en, a.type
 ORDER BY posted_lines DESC, a.company_id, a.code;

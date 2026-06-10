# Schema Hardening Runbook

**Status:** planned, not yet applied to production.
**Owner:** before running any command below, read "Safety" all the way through.

This document describes the next coordinated DB migration for Muhasib.ai:
changing `real` (single-precision float, ~7 decimal digits) financial
columns to `numeric(15, 2)` / `numeric(15, 4)` / `numeric(10, 6)`, and
adding a handful of missing uniqueness and NOT NULL constraints. It is
deliberately separate from the application-code batches that already
landed on `refactor/platform-overhaul` because the code changes are
reversible and the column-type migration is not.

## Why

1. **Accounting precision.** 115 columns across journal lines, invoice
   lines, receipts, bank, payroll, fixed-assets and VAT tables are
   currently stored as PostgreSQL `real` (IEEE-754 single precision).
   Real cannot represent 0.10 + 0.20 exactly and rounds at ~7 digits,
   so balances drift over compounded operations (month-end close,
   multi-currency, VAT box math). `numeric(15, 2)` is the standard
   accounting type and is the only safe choice going forward.
2. **Duplicate prevention.** `(company_id, number)` on `invoices` and
   `(company_id, code)` on `accounts` are currently unconstrained —
   retries can create duplicate invoice numbers and two accounts can
   share a code, which breaks trial balance.
3. **Referential integrity.** `journal_lines.account_id` is nullable.
   Business logic treats it as required; a null row is a silent
   corruption.

## What

| Change | Rationale |
| --- | --- |
| `ALTER COLUMN … TYPE numeric(15, 2)` for all money columns | precision |
| `ALTER COLUMN … TYPE numeric(15, 4)` for quantities | precision |
| `ALTER COLUMN … TYPE numeric(10, 6)` for rates (vat_rate, tax_rate, ai_confidence) | precision + range |
| `ALTER COLUMN journal_lines.account_id SET NOT NULL` | integrity |
| `ADD CONSTRAINT unique_company_invoice_number UNIQUE (company_id, number)` on `invoices` | dedup |
| `ADD CONSTRAINT unique_company_account_code UNIQUE (company_id, code)` on `accounts` | dedup |
| `CREATE INDEX idx_invoices_company_date ON invoices(company_id, date)` | report perf |
| `CREATE INDEX idx_journal_lines_account ON journal_lines(account_id)` | ledger perf |
| `CREATE INDEX idx_receipts_company_category ON receipts(company_id, category)` | receipt filter perf |

## Safety

* **Test in staging first.** Restore a production snapshot into staging,
  run the migration there end-to-end, run a representative reporting
  load (balance sheet, trial balance, VAT 201), compare totals to the
  pre-migration snapshot. Any drift > 0.01 AED on any account aborts
  the rollout.
* **ALTER COLUMN TYPE rewrites the table.** Neon/Postgres takes a brief
  exclusive lock per table while the rewrite runs. For our current
  data volume this is seconds-to-minutes per table, but it is not
  zero-downtime. Schedule a maintenance window and expect writes to
  stall briefly during each ALTER.
* **Backup immediately before.** `pg_dump` the target database and
  confirm the dump is readable (`pg_restore --list`) before the first
  ALTER.
* **Pre-flight dedup check.** The two new UNIQUE constraints will fail
  if existing rows already violate them. Run the detection queries in
  the "Pre-flight" section below and resolve duplicates first.
* **Numeric rounding.** Casting `real → numeric(15, 2)` rounds to two
  decimals. Values like `1000.0000001` become `1000.00`. This is a
  correction, not a new error, but expect micro-shifts in individual
  row values. Running balance totals should come out identical or
  *closer to* the hand-calculated truth than before.

## Pre-flight queries

Run each of these. Each must return zero rows before the corresponding
constraint can be added.

```sql
-- duplicate (company_id, number) on invoices
select company_id, number, count(*)
  from invoices
  group by 1, 2
  having count(*) > 1;

-- duplicate (company_id, code) on accounts
select company_id, code, count(*)
  from accounts
  group by 1, 2
  having count(*) > 1;

-- null account_id on journal_lines
select count(*) from journal_lines where account_id is null;
```

If any return rows, dedup/repair first (merge the duplicates into the
earliest row, reassign references, then delete the losers; assign a
reasonable account for null journal_lines rows).

## Runbook

1. **Announce maintenance window.** 15-minute window is enough for the
   current data footprint. Extend if staging timing suggests more.
2. **`pg_dump` the prod database.** Save two copies (one hot, one
   cold storage). Record the restore command.
3. **Pause background jobs.** Scheduler (`server/services/scheduler.service.ts`)
   and any cron that writes to the affected tables. Bring the web
   service down or put it in read-only mode (`app.use(readonlyGate)`
   is a one-line middleware we can add temporarily).
4. **Run the pre-flight queries.** Abort if any return rows.
5. **Apply the Drizzle migration.**
   ```
   DATABASE_URL=<prod> npm run db:migrate
   ```
   This runs the SQL generated by `npm run db:generate` after the
   schema.ts helper update (monetaryColumn / rateColumn / quantityColumn).
   The same change is already on the `main` branch (commit 77db2b9)
   and can be cherry-picked or re-generated from refactor with the
   same helpers.
6. **Verify.** For each affected table, query `information_schema.columns`
   to confirm the type is `numeric` and the precision/scale is right.
7. **Smoke test.** Create a journal entry from the UI, run balance
   sheet, run VAT 201 preview, confirm totals.
8. **Resume scheduler + web service.**
9. **Hold a 24-hour watch window.** Monitor error rates, sample a few
   reports, confirm no NaN / decimal coercion crashes reach Sentry.

## Rollback plan

The only safe rollback is "restore from the pre-migration dump".
`ALTER COLUMN TYPE numeric → real` is technically possible but lossy
and is not advised. If the migration fails mid-run, Postgres has
already committed some ALTERs and aborted others; the cleanest recovery
is restore-from-backup rather than trying to reverse individual
statements.

## Tracked items not in this runbook

* `invoices.contact_id` FK to `customer_contacts` — referenced by the
  portal IDOR fix in commit 318445c (defense-in-depth already shipped).
  Adding the FK is its own migration and will let us drop name-based
  matching entirely.
* MemoryStore → Redis for Express session. Not a schema migration;
  tracked as an infra-level change.

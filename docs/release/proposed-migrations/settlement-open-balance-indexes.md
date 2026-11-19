# Proposed: indexes for the settlement rule (owner decision)

Status: **approved by the owner (2026-11-18) and shipped as migration
`migrations/0135_settlement_open_balance_indexes.sql`**, an explicit exception to the frozen-migration
rule (see [MIGRATION-REHEARSAL.md](../MIGRATION-REHEARSAL.md)). This page keeps the evidence. The
`CONCURRENTLY` variant in [settlement-open-balance-indexes.sql](settlement-open-balance-indexes.sql) is
no longer the plan. It stays for reference, or for an operator who pre-builds the indexes
concurrently before the deploy; 0133's `IF NOT EXISTS` then makes the migration a no-op.

## What it fixes

`server/reporting/settlement.ts` is the one settlement rule for open invoice balances. It feeds
the invoice list balances (`server/services/invoice-balances.ts`), A/R ageing, the dashboard
"outstanding" figure, customer statements, auto-reconcile and payment chasing. Its "credited" part
runs, per invoice, a correlated subquery on `invoices.original_invoice_id` and another on
`credit_notes.invoice_id`. Neither column has an index on #67 (checked with `pg_indexes` on the
migrated rehearsal database), so every read is quadratic in the company's invoice count.

## Evidence (rehearsal database, 20x volume: 80,000 invoices, 4,000 credit notes, Postgres 16)

The query is the open-balance count for one company with 10,000 invoices, built from
`receivableStatusSql` / `receivableOpenSql` exactly as the app builds it.

| Run                                                           | No indexes     | `invoices.original_invoice_id` only | Both indexes   |
| ------------------------------------------------------------- | -------------- | ----------------------------------- | -------------- |
| First measurement (2026-11-18, `rh_x20_timing`)               | 34.5 s, 35.7 s | 1.72 s, 1.65 s                      | 0.43 s, 0.46 s |
| Re-measured with the CONCURRENTLY statements (`rh_x20_rerun`) | 31.8 s, 30.0 s | -                                   | 0.42 s, 0.39 s |

That is about **35 s vs 0.45 s**. The plan switches from `Seq Scan on invoices c` per invoice to
`Index Scan using idx_invoices_original_invoice_id`. Building both indexes CONCURRENTLY took 127 ms
on that volume. The read-only `scripts/qa/find-sales-ledger-drift.mjs` hits the same pattern: it took
388 s on the same database without the indexes.

## How to apply (if approved)

Release phase, after `npm run db:migrate`, in autocommit psql (CONCURRENTLY cannot run inside the
single transaction `drizzle-kit migrate` uses):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/release/proposed-migrations/settlement-open-balance-indexes.sql
```

The file ends with a check that both indexes are valid.

The alternative is a numbered migration without `CONCURRENTLY`. That takes a brief write lock on
`invoices` and `credit_notes` during the build. If the owner chooses it, assign the next number in
`migrations/meta/_journal.json`, coordinating with the base branch, which is also adding numbers.

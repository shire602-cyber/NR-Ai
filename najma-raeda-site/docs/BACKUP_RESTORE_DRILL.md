# Backup & Restore Drill (runbook)

> Phase R deliverable. The app already ships a checksum-verified, transactional
> restore path (`server/routes/backups.routes.ts`, E2E-tested). This runbook
> defines the **two backup layers**, the **drill cadence**, and the
> **verification steps** so "we have backups" becomes "we have *tested*
> backups." Owner-run — requires the live DB / Railway access.

## Targets (private beta)
- **RPO (max data loss): 24h.** Daily platform snapshot + on-demand app backups.
- **RTO (max downtime to restore): 4h.** Single-replica beta; restore-and-redeploy.
- Revisit both downward (RPO ≤1h via PITR, RTO ≤1h) before GA / paid SLAs.

## Two backup layers
1. **Platform layer — Railway/managed Postgres snapshots.** Automatic daily
   snapshots by the provider. This is the disaster-recovery floor (host loss,
   accidental `DROP`, corruption). Confirm snapshots are enabled and note the
   retention window in the Railway dashboard. For point-in-time needs, take a
   manual `pg_dump` before any risky migration:
   ```
   # run from an env that can reach the DB; never commit the dump
   pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%Y%m%d-%H%M).dump
   ```
2. **Application layer — in-app backup/restore.** `backups.routes.ts` produces a
   checksum-verified logical backup and restores it transactionally in FK order
   (`onConflictDoNothing`), respecting the 5-year retention guard. This is for
   per-company recovery and integrity re-checks, not host-level DR.

## Drill cadence
- **Weekly (beta):** restore the latest **app** backup into a scratch/staging
  DB and run the verification checklist below. ~15 min.
- **Monthly:** restore a **platform** snapshot into a throwaway Railway DB,
  point a staging deploy at it, and smoke-test login + a financial report.
- **Always before** a destructive migration or a bulk data operation: take a
  manual `pg_dump` (layer 1) first.
- Log each drill (date, layer, source timestamp, restore duration, pass/fail) in
  the table at the bottom — this is the audit evidence that RPO/RTO are real.

## Verification checklist (after any restore)
- [ ] Restore completed without error; row counts for `journal_entries`,
      `journal_lines`, `invoices`, `invoice_payments` match (±expected delta) the
      source snapshot.
- [ ] **Ledger balances:** for a sample company, total debits = total credits
      across `journal_lines` (the core invariant). Quick check:
      ```sql
      SELECT company_id,
             SUM(debit_fils)  AS dr,
             SUM(credit_fils) AS cr
      FROM journal_lines GROUP BY company_id HAVING SUM(debit_fils) <> SUM(credit_fils);
      ```
      Expect **zero rows**.
- [ ] A balance sheet + P&L render for a sample company and tie to pre-backup
      figures.
- [ ] Auth works (one login) and the activity-log endpoint returns recent rows.
- [ ] Checksum reported by the app backup matches on restore (app layer).

## Restore procedure (summary)
- **App layer:** use the in-app restore endpoint against the target DB; it
  re-inserts missing rows in FK order and is idempotent (`onConflictDoNothing`).
- **Platform layer:** create a new DB from the snapshot in Railway, set
  `DATABASE_URL` on a staging service to the restored DB, run `npm run migrate`
  if the snapshot predates the latest migration, then smoke-test before any
  production cutover. Never restore directly over the live production DB without
  a fresh `pg_dump` of current state first.

## Drill log
| Date | Layer | Source timestamp | Restore time | Result | Notes |
|------|-------|------------------|--------------|--------|-------|
| _ |  |  |  |  | _first drill pending live staging DB_ |

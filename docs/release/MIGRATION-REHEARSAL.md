# Migration rehearsal: main (0000-0088) to #67 (0089-0136)

Rehearsed on 2026-11-18 on branch `launch/hardening-on-67` (PR #67 head `ea6d1bd` plus this
branch's changes), following [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) sections 1, 2 and 7. **This is a
rehearsal on synthetic production-like data, not on a production snapshot.** The owner still has
to run section 1 and 2 on a restored production dump before deploying. The same driver does that
in one command (see "Re-run on the real snapshot").

The runbook named 0089-0122 (updated on this branch). The chain on #67 now ends at **0123** (`0123_b1_posting_guards`),
so 35 files were rehearsed. The task asked for 0089-0117; all of 0089-0123 are covered.

**Result: pass.** Every file applied on the first attempt, with no errors and no file needing a fix.
A second `db:migrate` was a no-op. Re-running each 0089+ file by hand succeeded for 35 of 35
(idempotent). The app booted on the migrated database (`/health/ready` 200, `/api/version` 200).
The rollback restore reproduced the pre-0089 database exactly. Findings that need the owner are listed
at the end.

## Open launch risk: no production-data rehearsal

**The owner decided to skip the production-data rehearsal for now (2026-11-18).** Every result in this
document comes from synthetic data seeded on main's schema. Real production data can hold shapes the
seed does not, for example:

- roles or emails the 0092 rewrite does not expect;
- FX rows that 0094 cannot classify;
- more duplicates than 0118 tolerates;
- an `audit_logs` volume that makes 0109 (about 0.12 ms per row, inside the single `db:migrate`
  transaction) hold its lock for minutes.

Until `rehearse.sh` has run on a restored production dump, treat the first production migrate as
**unrehearsed**:

- take and verify the section 1 backup immediately before the deploy;
- record the production `audit_logs` count to size 0109;
- keep the dump-restore rollback (section 7) ready.

This stays open until the owner runs it.

## Owner exception: migration 0136 (settlement indexes)

AGENTS.md freezes the migration chain ("never edit `migrations/meta/_journal.json` or add new numbers").
**The owner approved an explicit exception on 2026-11-18 (PR #68)** for
`0136_settlement_open_balance_indexes`.

It was added as 0125 and renumbered three times, before any deploy, because the base branch kept
taking numbers: 0125 and 0126 (WQ7, WQ3), 0127 and 0128 (WQ2, WQ5), 0129 (WQ1), then 0130
(cash-sale numbering). It is now 0136 (the base took 0131 to 0135 in turn, last 0135_step4_signup_plan_choice), journal idx 135, `when` +10 s as the migrations test requires. The header
and `IF NOT EXISTS` rules are followed.

It adds two partial indexes, `idx_invoices_original_invoice_id` and `idx_credit_notes_invoice_id`.
They are also declared in `shared/schema/sales.ts`, so `db:push` keeps them. The build is not
`CONCURRENTLY`, because `drizzle-kit migrate` runs inside one transaction.

Re-rehearsed from scratch after the renumber to 0133 (renumbered again to 0134, 0135 and finally 0136 on 2026-11-19 when the base took 0133 (ZATCA removal), 0134 (price editor removal) and 0135 (STEP4 sign-up plan choice); `db:migrate` on a fresh database and the db-harness migration tests cover it) (2026-11-18, merged tree on top of the base's
`0130_cash_sale_numbering`): fresh 1x and 20x pre-0089 databases (main's chain 0000-0088 plus
`ensureCriticalSchema()`, then the seed), the full `rehearse.sh`, 0089-0136 (48 files).

| Check                                           | 1x                                | 20x                                            |
| ----------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `db:migrate` (one transaction)                  | exit 0, 1.55 s                    | exit 0, 8.25 s                                 |
| 0132 / 0133 (per-file runner)                   | 7 / 6 ms, DDL only                | 37 / 21 ms, DDL only                           |
| Second `db:migrate`                             | no-op (ledger 132 = 132)          | no-op (ledger 132 = 132)                       |
| Each 0089+ file re-run by hand                  | 43/43 ok                          | 43/43 ok                                       |
| Schema, drizzle vs per-file                     | identical                         | identical                                      |
| Indexes present and valid                       | yes (`indisvalid = t`)            | yes (`indisvalid = t`)                         |
| Rollback restore                                | 0 errors, counts equal, ledger 88 | 0 errors, counts equal, ledger 88              |
| Open balances, one company with 10,000 invoices | -                                 | **56-82 ms** (was 30-35 s without the indexes) |

The ledger is now at 131 rows. The earlier runs with the index migration numbered 0125 (37 files),
0127 (39), 0129 (41) and 0130 (42) gave the same results. The open-balances figure is the
`count(*)` of open invoices for the busiest company (`receivableStatusSql` and
`receivableOpenBaseFilsSql`, as the app builds it), four runs, warm cache. This re-timing did not
re-run `find-sales-ledger-drift.mjs` or re-compare the section 2 counts line by line; those figures
are from the earlier runs and the data and seed are unchanged.

### Addendum: 0124 (added to the base after the main run)

The base branch then gained `0124_e3_invoice_line_income` (one nullable `invoice_lines.revenue_account_id`
column, `ADD COLUMN IF NOT EXISTS`). It was applied with the per-file runner on top of both migrated
snapshots. At 1x it took 598 ms, the first statement after a Postgres restart, so the cache was cold.
At 20x it took 301 ms. It changed no rows. A second run by hand was a no-op (notice: column already
exists). Both ledgers ended at 124 rows. The runbook now names 0089-0124.

## Environment and method

| Item             | Value                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres         | 16.15 (Ubuntu), local                                                                                                                                                                        |
| Baseline schema  | `origin/main` worktree: `drizzle-kit migrate` (0000-0088, 88 ledger rows), then main's boot-time `ensureCriticalSchema()` (production boots with it)                                         |
| Seed             | [rehearsal/seed-main-production-like.sql](rehearsal/seed-main-production-like.sql), on top of the two legacy test companies main's chain seeds                                               |
| #67 migrate      | `npm run db:migrate` (`drizzle-kit migrate`: all pending files in **one** transaction) on the snapshot                                                                                       |
| Per-file timings | [rehearsal/time-migrations.mjs](rehearsal/time-migrations.mjs) on a clone: one transaction per file, rows from `pg_stat_xact_user_tables` before COMMIT, the same ledger rows drizzle writes |
| Schema check     | `pg_dump -s` of the drizzle-migrated snapshot vs the per-file clone: identical (only the random `\restrict` token differs)                                                                   |
| Driver           | [rehearsal/rehearse.sh](rehearsal/rehearse.sh), with [pre-counts.sql](rehearsal/pre-counts.sql) and [post-counts.sql](rehearsal/post-counts.sql)                                             |

Two volumes were run:

| Run | Companies | Users | Invoices (lines) | Journal entries | Payments | Credit notes | Audit rows | Dump size |
| --- | --------- | ----- | ---------------- | --------------- | -------- | ------------ | ---------- | --------- |
| 1x  | 10        | 34    | 4,000 (12,000)   | 4,005           | 1,600    | 200          | 2,500      | 2.2 MB    |
| 20x | 10        | 34    | 80,000 (240,000) | 80,005          | 32,000   | 4,000        | 50,000     | 37.4 MB   |

The seed covers every case the 0089+ migrations rewrite:

- 3 placeholder (invited) users with memberships, free-text roles (`cfo`, `manager`, `Read-Only`, `bookkeeping clerk`, `superuser`), and an email-case duplicate.
- 60 FX rates with no company, including 5 inverted manual rows.
- 40 plaintext customer portal tokens.
- 24 reconciliation rules, 8 of them with an unknown match type.
- 3 unbalanced journals and a doubly-reversed entry.
- Employees with a duplicate number and a duplicate IBAN.
- 5 of 10 companies without a subscription.
- NR firm staff (`firm_owner`, `firm_admin`) and two NR client companies.
- The owner account `shire602@gmail.com` in the state the original 0054 left it (admin, `firm_owner`).

An earlier 1x pass also posted void invoices without a reversal. It found 800 "phantom void" rows,
which were a seed artifact, so the seed was corrected and the run repeated. That pass had the same
migration results.

## 1. Backup and verified restore (runbook section 1)

| Step                                                                       | 1x                                      | 20x                         |
| -------------------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| `pg_dump -Fc`                                                              | 0.3 s, 2,228,654 bytes                  | 3.0 s, 37,432,197 bytes     |
| sha256                                                                     | `3242c38e...4035aa`                     | `9fc3a446...97bfc5`         |
| `pg_restore --list`                                                        | readable                                | readable                    |
| Restore into `restore_check`                                               | 1.0 s, 0 errors                         | 5.0 s, 0 errors             |
| companies/users/company_users/journal_entries/invoices, source vs restored | 10/34/32/4005/4000 = 10/34/32/4005/4000 | 10/34/32/80005/80000 = same |

## 2. Rehearsal table (runbook section 2)

1x run. The 20x run gave identical counts except the volume rows (journal entries, invoices, audit rows).

| Item                                                          | Migration   | Pre                                                                                                     | Post                                                                                                                           |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Placeholder users removed or converted to invitations         | 0092        | 3 users, 3 memberships                                                                                  | 0 placeholder users left; 3 pending invitations; users 34 to 31, company_users 32 to 29                                        |
| `company_users` roles mapped to employee                      | 0092        | 10 free-text roles (cfo 2, manager 2, Read-Only 2, bookkeeping clerk 2, superuser 2); 4 map to employee | 10 rows rewritten: owner 10, employee 6, accountant 5, admin 4, viewer 4                                                       |
| Email-case duplicates                                         | 0092        | 1 group                                                                                                 | 1 `case_duplicate_email` finding; `users_email_lower_unique` **skipped** (notice)                                              |
| Rates flagged `legacy_unscoped` / `legacy_inverted`           | 0094        | 60 rates, 30 non-FTA, 10 manual, 10 companies                                                           | 30 `legacy_unscoped`, 5 `legacy_inverted` (35 rows updated)                                                                    |
| Reconciliation rules deactivated                              | 0097        | 24 active, 8 with an unknown match type                                                                 | **24** deactivated (all of them; see finding 2)                                                                                |
| Portal tokens hashed                                          | 0103        | 40 plaintext                                                                                            | 40 `portal_access_tokens` (kind link), 0 plaintext left, 0 backfill findings                                                   |
| Firm backfill (firms, members, links, grants)                 | 0108        | -                                                                                                       | 1 firm, 3 members, 2 client links, 3 company grants                                                                            |
| Audit rows chained as legacy                                  | 0109        | 2,500                                                                                                   | 2,500 legacy, 0 unsealed                                                                                                       |
| Free subscription rows backfilled                             | 0113        | 4 companies without a row                                                                               | 4 inserted; 6 Free in total; 0 companies without a row                                                                         |
| `ledger_repair_findings` / `identity_migration_findings` rows | 0090 / 0092 | -                                                                                                       | 4 (3 `unbalanced_entry`, 1 `duplicate_reversal`) / 1 (`case_duplicate_email`)                                                  |
| `uq_employees_*` indexes (2d)                                 | 0118        | -                                                                                                       | employee_number **missing**, iban **missing**, emirates_id present (seeded duplicates; notices `0118: duplicate employee ...`) |
| Owner account (S-H3)                                          | 0054        | admin, firm_owner                                                                                       | unchanged (the neutralised 0054 is not re-run on an applied ledger)                                                            |
| Total migrate time, slowest file                              | all         | -                                                                                                       | `db:migrate` 1.55 s (1x) / 8.8 s (20x). Slowest: 0109 (0.27 s / 5.9 s), then 0090 (0.08 s / 0.78 s)                            |

### Per-file timings and row changes

Times are in ms (one transaction per file, clone of the snapshot). Rows are the 1x run, shown as
`+inserted/~updated/-deleted`; the 20x figures scale with the audit and journal volume only.

| File                              | 1x ms | 20x ms | Rows changed (1x) and notices                                                                                                                                                                                                  |
| --------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0089_platform_foundation          | 17    | 23     | users +0/~2/-0                                                                                                                                                                                                                 |
| 0090_w2a_ledger_kernel            | 83    | 783    | journal_entries +0/~4/-0; ledger_repair_findings +4/~0/-0                                                                                                                                                                      |
| 0091_w2b_reporting_close          | 12    | 13     | DDL only                                                                                                                                                                                                                       |
| 0092_w2c_identity                 | 29    | 170    | company_users +0/~10/-3; users +0/~0/-3; company_invitations +3/~0/-0; identity_migration_findings +1/~0/-0 (0092: 1 case-duplicate email group(s) recorded in identity_migration_findings; skipping users_email_lower_unique) |
| 0093_w2d_write_sweep              | 9     | 12     | accounts +22/~40/-0                                                                                                                                                                                                            |
| 0094_w2e_fx_core                  | 13    | 17     | exchange_rates +0/~35/-0                                                                                                                                                                                                       |
| 0095_w3a_sales                    | 21    | 145    | DDL only                                                                                                                                                                                                                       |
| 0096_w3b_purchases                | 36    | 46     | DDL only                                                                                                                                                                                                                       |
| 0097_w3c_banking                  | 39    | 32     | reconciliation_rules +0/~24/-0                                                                                                                                                                                                 |
| 0098_w3d_payroll                  | 37    | 39     | DDL only                                                                                                                                                                                                                       |
| 0099_w3e_dashboard_planning       | 12    | 14     | DDL only                                                                                                                                                                                                                       |
| 0100_w4a_corporate_tax_compliance | 20    | 23     | DDL only                                                                                                                                                                                                                       |
| 0101_w4b_inventory_assets         | 35    | 39     | DDL only                                                                                                                                                                                                                       |
| 0102_w4c_einvoicing               | 30    | 31     | DDL only                                                                                                                                                                                                                       |
| 0103_w4d_portals_comms            | 72    | 77     | customer_contacts +0/~40/-0; portal_access_tokens +40/~0/-0                                                                                                                                                                    |
| 0104_w4e_vat_engine               | 28    | 28     | DDL only                                                                                                                                                                                                                       |
| 0105_w5a_reports                  | 11    | 10     | DDL only                                                                                                                                                                                                                       |
| 0106_w5b_commercial               | 50    | 46     | DDL only                                                                                                                                                                                                                       |
| 0107_w5c_multi_entity             | 36    | 31     | DDL only                                                                                                                                                                                                                       |
| 0108_w5d_firm                     | 55    | 62     | firm_company_grants +3/~0/-0; firm_members +3/~0/-0; firm_client_links +2/~0/-0; firms +1/~0/-0                                                                                                                                |
| 0109_w5e_security                 | 274   | 5943   | audit_logs +0/~7500/-0                                                                                                                                                                                                         |
| 0110_s1_sales_tax                 | 4     | 5      | DDL only                                                                                                                                                                                                                       |
| 0111_s2_purchases                 | 9     | 10     | DDL only                                                                                                                                                                                                                       |
| 0112_s3_banking_ai                | 4     | 4      | DDL only                                                                                                                                                                                                                       |
| 0113_s5_platform                  | 5     | 7      | subscriptions +4/~0/-0                                                                                                                                                                                                         |
| 0114_s8_residuals                 | 8     | 8      | DDL only                                                                                                                                                                                                                       |
| 0115_f8_event_outbox              | 9     | 11     | DDL only                                                                                                                                                                                                                       |
| 0116_e1_einvoice_acube            | 16    | 17     | DDL only                                                                                                                                                                                                                       |
| 0117_e2_einvoice_complyance       | 3     | 3      | DDL only                                                                                                                                                                                                                       |
| 0118_x4_payroll                   | 6     | 7      | DDL only (0118: duplicate employee numbers exist; uq_employees_company_employee_number not created; 0118: duplicate employee IBANs exist; uq_employees_company_iban not created)                                               |
| 0119_a3_chart                     | 4     | 3      | accounts +0/~2/-0                                                                                                                                                                                                              |
| 0120_a2_purchases                 | 5     | 4      | DDL only                                                                                                                                                                                                                       |
| 0121_a1_vat_lock                  | 6     | 5      | DDL only                                                                                                                                                                                                                       |
| 0122_a4_payroll_ct                | 19    | 23     | employees +0/~42/-0                                                                                                                                                                                                            |
| 0123_b1_posting_guards            | 5     | 4      | DDL only                                                                                                                                                                                                                       |

Sum of per-file times: 1.0 s (1x), 7.7 s (20x). Notices that only say an object "does not exist,
skipping" or "already exists, skipping" (idempotent DDL guards) are omitted.

### 2c. Read-only QA scripts (post-migrate)

| Script                                | Exit                         | Result (1x)                                                            |
| ------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `find-bad-closing-entries.mjs --json` | 0                            | 0 scanned, 0 findings                                                  |
| `find-inverted-rates.mjs`             | 0                            | inverted 0, ambiguous 0, unscoped 30 (the 0094 `legacy_unscoped` rows) |
| `find-sales-ledger-drift.mjs`         | 0                            | all five checks 0. **388 s at 20x** (see finding 1)                    |
| `find-purchases-ledger-drift.mjs`     | 0                            | all checks 0                                                           |
| `repair-misposted-payments.ts --json` | 0                            | `[]`                                                                   |
| `find-header-posting-accounts.sql`    | pre: **error**; post: 0 rows | see finding 4                                                          |

`rehearse.sh` runs the five scripts above with `--fail-on-findings`: each exits 1 when it reports at least one
actionable finding (default runs, for other callers, still exit 0 with findings; 2 is bad usage), so step 2c
fails on findings and not only on crashes. For `find-inverted-rates.mjs`, rows 0094 already handled
(`rewritten`, quarantined `legacy_unscoped`) are informational and do not fail the gate. A failing gate logs
`<name>_findings_file=` with the path of the findings file; the finder's stderr summary is beside it as
`<file>.err`.

### Idempotency

- A second `npm run db:migrate` on the migrated snapshot exited 0. The ledger stayed at 123 rows.
- Each of the 35 files 0089-0123 was re-run by hand with `psql --single-transaction` on a migrated clone: 35/35 ok (`rerun.txt`). That includes 0117, which the runbook (9a) asks to re-run as a no-op.

### Boot check

`npm run build` succeeded. `npm start` (production, `AUTO_MIGRATE_ON_BOOT` unset) on the migrated
1x snapshot answered `/health/ready` 200 with `{"database":"ok"}` and `/api/version` 200.

## 7. Rollback verified

The pre-0089 dump was restored into a fresh database: 1.0 s (1x) and 4.3 s (20x), with 0 errors.

| Check                    | Result                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Row counts               | 10/34/32/4005/4000 (1x) and 10/34/32/80005/80000 (20x), equal to before the migration |
| Drizzle ledger           | 88 rows, back to main                                                                 |
| `ledger_repair_findings` | does not exist (no 0089+ object)                                                      |

The runbook's "restore the verified backup" rollback works as written.

The "redeploy the previous release" rollback was not exercised, because main's code was not booted
on the migrated schema. Treat it as unverified. The data-preserving rollback is the dump restore.

## Findings for the owner

1. **Missing indexes made the settlement rule quadratic. Fixed by migration 0136 (owner exception).**
   `invoices.original_invoice_id` and `credit_notes.invoice_id` had no index. The settlement rule
   (`server/reporting/settlement.ts`, used by the invoice list balances, ageing, dashboard,
   statements and payment chasing) runs a correlated subquery on each.

   On the 20x data, open balances for one company with 10,000 invoices took 35 s; with both
   indexes, 0.45 s, and after the settlement-index migration on the re-rehearsed database 57-114 ms.
   `find-sales-ledger-drift.mjs` went from 388 s to under 1 s. See "Owner exception: migration
   0136" above, and the evidence in
   [proposed-migrations/settlement-open-balance-indexes.md](proposed-migrations/settlement-open-balance-indexes.md).

2. **0097 deactivates every reconciliation rule on main data.** `reconciliation_rules.account_id`
   only exists from 0097 on, so every active rule from main has no GL account, and 0097 switches all
   24 off, not only the 8 with a bad match type. The tenant message in section 6 should say "all bank
   rules were switched off; re-enable them after choosing an account". The runbook 2a query on
   `account_id` errors on a main schema. The pre-count file here counts active rules instead.
3. **0092 skips `users_email_lower_unique` while a case-duplicate group exists.** Login stays
   case-insensitive only once the owner merges the duplicates and creates the index by hand.
4. **The runbook's pre-deploy header-posting check cannot run on production.** `accounts.parent_id`
   is added by 0093, so `find-header-posting-accounts.sql` errors on main. It is meaningful only after
   migrating; on the rehearsal it returned 0 rows. The runbook now says to run it on the migrated
   rehearsal copy.
5. **0109 time grows linearly with `audit_logs`**: about 0.12 ms per row (three updates per row),
   inside the single `db:migrate` transaction. At 1M audit rows, expect about 2 minutes holding the
   `audit_logs` lock. Record the production `audit_logs` count before scheduling.
6. **0118 skips unique indexes when duplicates exist** (as documented in 2d). The check caught both
   seeded duplicates.
7. 0090 flagged the seeded defects exactly: 3 unbalanced entries and 1 duplicate reversal. They are
   findings, not repairs.

## Re-run on the real snapshot

Build the candidate with `npm run build` and follow the disposable-cluster setup in
[the deploy runbook](DEPLOY-RUNBOOK.md#2e-scripted-rehearsal-and-the-2026-11-18-record).
Supply the custom-format archive via `SNAPSHOT_FILE`. The driver verifies the loopback
cluster against `REHEARSAL_CLUSTER_ID` and creates the target databases for that run.

It writes `steps.log`, the migration, restore and boot logs, the QA findings and the schema
diff to `OUT`. A failed gate returns a nonzero exit. Do not commit the outputs or the dump.

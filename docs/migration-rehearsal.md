# Local database migration rehearsal

This rehearsal covers the migration chain through `0138` for `claude/eloquent-maxwell-kjxxjc`.
It uses a disposable PostgreSQL 16 instance and locally generated accounting data.
[Earlier migration rehearsal](release/MIGRATION-REHEARSAL.md)

## Run it

Use Node 20.19 or later within the range in `package.json`, npm, and a running Docker daemon.
Run these commands from the repository root.

```sh
npm ci
npm run db:rehearse
npm run test:migration-rehearsal
```

The script creates a temporary PostgreSQL 16 container on an ephemeral loopback port. It verifies
the cluster identity, uses its own connection settings, and removes the container and temporary
files after the run. The test runs the same rehearsal as the command. Production deployment and
recovery procedures are in the release runbook. [Deploy runbook](release/DEPLOY-RUNBOOK.md)

## What the rehearsal checks

1. **Empty database.** Run the Railway release migration entry point through all 138 registered
   files, from `0000_workable_fixer` through `0138_repair_bank_gl_links`. Verify the ledger
   timestamps and file hashes in journal order. Number `0052` is absent from the active chain.
   Historical SQL under `migrations/_orphaned` is outside the Drizzle journal.
2. **Seeded upgrade.** Apply the first 88 entries through `0088_emirate_no_default`, insert the
   fixture, and take a custom-format `pg_dump`. Read the archive with `pg_restore --list`, restore
   it to a fresh database, and compare schema, table contents, and sequence state. Apply the 50
   pending files from `0089` through `0138` with the release entry point. Run Drizzle Kit and a
   per-file timing pass on separate copies and compare their resulting schema and preserved rows.
   Stop another copy immediately after `0097` to check the ownership guards and stale GL repair
   before `0138` runs.
3. **Previously migrated database.** Apply the historically shipped SQL through `0137` to a copy
   of the seeded baseline. Verify the original `0097` ledger hash and confirm the legacy GL
   states. Run the release entry point with only `0138` pending and verify the repair, ownership
   findings, and original ledger entries. Repeat the release migration to check the resulting
   state. Replay the forward repair SQL directly, then replay all 50 files from `0089` through
   `0138` in journal order with the pending allocation and existing reconciliation still present.
4. **Preservation and replay.** Compare the seeded business records before and after upgrade and
   check the expected backfills. Run the tracked release entry point again against the migrated
   databases and compare the schema, rows, sequences, and ledger. Replay the `0089`
   through `0138` SQL in order on a separate copy with an active allocation whose legacy
   reconciliation fields are empty. Require both ordered replays to preserve the schema, ledger,
   table rows, and sequences.
   The earlier migrations include one-time DDL, such as the unguarded `CREATE TABLE` in `0000`.
   The ordered first run and ledger check cover those files.
5. **Failure and recovery.** Force `0134` to encounter an occupied legacy subscription table.
   Check its explicit refusal and verify that the pending transaction rolls back. Restore the
   pre-upgrade archive into a fresh database, verify the restored state and migration ledger, and
   retry the upgrade. PostgreSQL sequence increments survive a transaction rollback. The archive
   restore also resets the Drizzle ledger sequence to the pre-upgrade value.

## Seeded data and expected changes

The fixture adds four companies, two of them firm clients, along with six users and eight
memberships. It includes two firm engagements and a staff assignment. The accounting data covers
48 invoices with 96 lines and 24 payments, 32 bills with 64 lines and 12 payments, and 96 balanced
journal entries with 252 lines. It includes four VAT returns and their linked periods, five bank
accounts, and 18 statement rows across eight CSV or PDF import fingerprints. At the `0088` cutoff,
legacy imports record their source on each statement row. `0097` adds the import-batch table.
[Seed SQL](../scripts/rehearsal/seed.sql)

The upgrade normalizes the legacy read-only role, backfills firm and client relationships, and
hashes the legacy portal token. The subscription assertion compares the active
`(company_id, plan_id)` tuples as a multiset, requiring one Starter and three Free plans, each at
its expected company. The imported `CS-2026-00042` number remains on its original document and
sets the floor for the cash-sale sequence.

The banking fixture includes four stale matches with a wrong same-company GL link and four valid
invoice matches. Two additional rows isolate the ownership checks. One links to another company's
statement account and one links to a local statement account with a foreign GL target. The test
verifies both findings and the retention of the existing GL links. The forward-upgrade fixture
also covers an empty GL link, an existing reconciliation, and a pending allocation whose cached
GL differs from its managed statement account's current GL. The full SQL replay preserves that
pending allocation and the earlier reconciliation. The upgrade-copy replay also preserves an
active allocation, its reconciled status, and its empty legacy match and GL fields.

## Migration fixes

- `0089` keeps the existing password marker on an already-revoked test account. It still revokes
  usable test credentials and clears the accounts' privileges and memberships.
  [0089 migration](../migrations/0089_platform_foundation.sql)
- `0097` repairs stale reconciliation state before filling in the GL account from the managed
  bank account. The original order fixed the reconciliation flags on the first pass and needed a
  second pass to correct the GL link. The fixture now verifies both repairs on the first pass,
  together with separate checks for statement ownership and target GL ownership. The migration
  now checks for active or pending allocations before clearing reconciliation flags or filling
  GL links. It fills the match type only on rows for which it creates a legacy allocation.
  [0097 migration](../migrations/0097_w3c_banking.sql)
- `0138` repairs eligible legacy GL links on databases that already ran `0097`. The transaction,
  statement bank account, and target GL account must belong to the same company. Reconciled rows
  and rows with existing match links or active or pending allocations retain their GL links.
  Ownership mismatches and missing references are recorded for review with the links preserved.
  [0138 migration](../migrations/0138_repair_bank_gl_links.sql)
- `0130` updates the cash-sale sequence only if an imported document raises the current counter.
  Replaying the SQL preserves the timestamp on an unchanged sequence.
  [0130 migration](../migrations/0130_cash_sale_numbering.sql)
- The release entry point clears its pool shutdown timer when the database pool finishes closing.
  The timer previously kept the process alive for the rest of the 10-second timeout.
  [Pool shutdown](../server/db.ts)

Drizzle selects pending entries using the recorded journal timestamps. The original ledger entries
for `0089`, `0097`, and `0130` remain valid, and `0138` supplies the bank GL repair for already
migrated databases. The historical-path rehearsal uses the shipped versions of those three files.
It verifies the original `0097` SHA-256
`fc545f83c7470e6624251c1d4492a9f6f6a842d2fd20b4afb94fb28e0fbdc7be` before and after the upgrade.
[Historical `0097` SQL](../scripts/rehearsal/historical/0097_w3c_banking.sql)

### Review bank GL findings

After migration, query the durable findings ordered by company and transaction. Each transaction
can have independent `statement_company_mismatch` and `target_gl_company_mismatch` findings.
The migration also records `statement_account_missing` and `target_gl_account_missing` for
missing referenced accounts.

```sql
SELECT company_id, bank_transaction_id, kind, details, found_at
  FROM bank_gl_migration_findings
 ORDER BY company_id, bank_transaction_id, kind;
```

Use the related account IDs in `details` to review ownership and assess the intended GL link in
the affected company's records. A rerun preserves the existing finding for each transaction and
kind.

Findings are for database operators and can reference another company's account identifiers.
Tenant backup creation, downloads of older tenant backups, and tenant restores exclude these
diagnostics. Full database archives retain them.

## Results

The latest local rehearsal passed with PostgreSQL 16.16 and Node 22.22.2. The clean
and upgraded release databases had identical schemas and 138 correctly ordered ledger entries.
Seeded business data matched across both upgrade paths. On the previously migrated copy, the
release appended the one `0138` entry, repaired the eligible GL links, and recorded two distinct
ownership findings. The tracked reruns, both ordered replays of all 50 files, and direct replay
of the forward repair preserved the checked schema, rows, and sequences. A separate run with
the preceding revision of the migration failed the full historical replay because the bank
transaction rows changed. Both automated rehearsal tests passed in 45.9 seconds.

| Step                                                  |  Elapsed |
| ----------------------------------------------------- | -------: |
| Clean release migration (138 files)                   | 4,367 ms |
| Tracked rerun on clean database                       | 1,108 ms |
| Apply baseline (88 files) and seed                    | 1,625 ms |
| Create custom-format backup (425,634 bytes)           |   217 ms |
| Verify by restoring the backup                        |   808 ms |
| Migrate a seeded copy through `0097` and check guards |   206 ms |
| Time the pending files individually on a clone        | 1,009 ms |
| Seeded upgrade using Drizzle Kit                      | 1,586 ms |
| Guarded failure at `0134` and transaction rollback    | 2,238 ms |
| Restore the pre-upgrade backup after the failure      |   752 ms |
| Seeded release migration after restore (50 files)     | 2,028 ms |
| Tracked rerun on upgraded database                    | 1,188 ms |
| Ordered SQL replay on upgraded copy (50 files)        |   181 ms |
| Restore the separate historical-upgrade copy          |   708 ms |
| Apply the historical files through `0137`             |   939 ms |
| Release migration with only `0138` pending            | 1,143 ms |
| Tracked rerun after the forward repair                | 1,167 ms |
| Direct replay of the forward repair SQL               |    13 ms |
| Ordered SQL replay with live allocations (50 files)   |   216 ms |

The release and Drizzle Kit measurements include command startup. The timing copy ran one
transaction per file and produced the same schema as Drizzle Kit. Its file timings added up to
872 ms, with `0103_w4d_portals_comms` (76 ms), `0108_w5d_firm` (62 ms), and
`0096_w3b_purchases` (50 ms) the slowest in this run. A separate test inserted a duplicate active
Starter subscription and verified that the multiset check rejected it.

Separate local checks covered both historical `0136` states. Starting with either the portal
table or the two settlement indexes, `0137` produced all three objects and both indexes were
valid. A replay on the earlier 4,000-invoice fixture also preserved sorted row contents across
243 tables. The focused migrations, cash-sale numbering, and banking-reconciliation suites
passed 34 tests. [Earlier migration rehearsal](release/MIGRATION-REHEARSAL.md)

## Recovery scope

The restore check exercises database recovery to the pre-upgrade snapshot. For an actual recovery,
quiesce application writes, preserve any writes made after the backup, and restore the verified
archive into a fresh database. Check the restore before redirecting the application and run the
release smoke tests after cutover. The database restore duration excludes application startup,
traffic cutover, and reconciliation of writes after the dump. The local fixture also leaves
production-sized lock waits, managed database snapshots, encrypted off-site backup, and uploads
outside this measurement. [Deploy runbook](release/DEPLOY-RUNBOOK.md#7-rollback)

# Local database migration rehearsal

This rehearsal covers the migration chain through `0137` on a branch based on
`claude/eloquent-maxwell-kjxxjc` commit `2b4a170d8c7377266c6991133df22674ce576b72`. It uses a
disposable PostgreSQL 16 instance and locally generated accounting data.
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

1. **Empty database.** Run the Railway release migration entry point through all 137 registered
   files, from `0000_workable_fixer` through `0137_combine_portal_invitations_and_settlement_indexes`.
   Verify the ledger timestamps and file hashes in journal order. Number `0052` is absent from the
   active chain. Historical SQL under `migrations/_orphaned` is outside the Drizzle journal.
2. **Seeded upgrade.** Apply the first 88 entries through `0088_emirate_no_default`, insert the
   fixture, and take a custom-format `pg_dump`. Read the archive with `pg_restore --list`, restore
   it to a fresh database, and compare schema, table contents, and sequence state. Apply the 49
   pending files from `0089` through `0137` with the release entry point. Run Drizzle Kit and a
   per-file timing pass on separate copies and compare their resulting schema and preserved rows.
3. **Preservation and replay.** Compare the seeded business records before and after upgrade and
   check the expected backfills. Run the tracked release entry point again against both migrated
   databases and compare the schema, rows, sequences, and ledger. Replay the `0089`
   through `0137` SQL in order on a separate copy to test the migration statements themselves.
   The earlier migrations include one-time DDL, such as the unguarded `CREATE TABLE` in `0000`.
   The ordered first run and ledger check cover those files.
4. **Failure and recovery.** Force `0134` to encounter an occupied legacy subscription table.
   Check its explicit refusal and verify that the pending transaction rolls back. Restore the
   pre-upgrade archive into a fresh database, verify the restored state and migration ledger, and
   retry the upgrade. PostgreSQL sequence increments survive a transaction rollback. The archive
   restore also resets the Drizzle ledger sequence to the pre-upgrade value.

## Seeded data and expected changes

The fixture adds four companies, two of them firm clients, along with six users and eight
memberships. It includes two firm engagements and a staff assignment. The accounting data covers
48 invoices with 96 lines and 24 payments, 32 bills with 64 lines and 12 payments, and 96 balanced
journal entries with 252 lines. It includes four VAT returns and their linked periods, four bank
accounts, and 16 statement rows across eight CSV or PDF import fingerprints. At the `0088` cutoff,
legacy imports record their source on each statement row. `0097` adds the import-batch table.
[Seed SQL](../scripts/rehearsal/seed.sql)

The upgrade normalizes the legacy read-only role, backfills firm and client relationships, hashes
the legacy portal token, and adds three Free subscriptions while preserving the existing Starter
subscription. It also repairs four stale bank reconciliation states and backfills allocations for
four valid invoice matches. The imported `CS-2026-00042` number remains on its original document
and sets the floor for the cash-sale sequence.

## Migration fixes

- `0089` keeps the existing password marker on an already-revoked test account. It still revokes
  usable test credentials and clears the accounts' privileges and memberships.
  [0089 migration](../migrations/0089_platform_foundation.sql)
- `0097` repairs stale reconciliation state before filling in the GL account from the managed
  bank account. The original order fixed the reconciliation flags on the first pass and needed a
  second pass to correct the GL link. The fixture now verifies both repairs on the first pass.
  [0097 migration](../migrations/0097_w3c_banking.sql)
- `0130` updates the cash-sale sequence only if an imported document raises the current counter.
  Replaying the SQL preserves the timestamp on an unchanged sequence.
  [0130 migration](../migrations/0130_cash_sale_numbering.sql)
- The release entry point clears its pool shutdown timer when the database pool finishes closing.
  The timer previously kept the process alive for the rest of the 10-second timeout.
  [Pool shutdown](../server/db.ts)

Drizzle selects pending entries using the recorded journal timestamps, so the automatic fixes
apply when `0089`, `0097`, or `0130` is pending. A database with those entries already recorded
skips their revised SQL. The three files retain their journal positions and timestamps.

## Results

The rehearsal passed on 2026-11-20 with PostgreSQL 16.16 and Node 22.22.0. The clean and upgraded
release databases had identical schemas and 137 correctly ordered ledger entries. The seeded
business data matched across the upgrade, and the expected backfills passed. A tracked rerun on
each database and the ordered replay of all 49 pending SQL files preserved the checked schema,
rows, and sequences. The automated rehearsal test passed in a second run (38.6 seconds).

| Step                                               |  Elapsed |
| -------------------------------------------------- | -------: |
| Clean release migration (137 files)                | 6,057 ms |
| Tracked rerun on clean database                    | 1,610 ms |
| Apply baseline (88 files) and seed                 | 2,706 ms |
| Create custom-format backup (425,396 bytes)        |   261 ms |
| Verify by restoring the backup                     | 1,151 ms |
| Time the pending files individually on a clone     | 1,689 ms |
| Seeded upgrade using Drizzle Kit                   | 2,360 ms |
| Guarded failure at `0134` and transaction rollback | 2,679 ms |
| Restore the pre-upgrade backup after the failure   |   992 ms |
| Seeded release migration after restore (49 files)  | 2,464 ms |
| Tracked rerun on upgraded database                 | 1,300 ms |
| Ordered SQL replay on upgraded copy (49 files)     |   272 ms |

The release and Drizzle Kit measurements include command startup. The timing copy ran one
transaction per file and produced the same schema as Drizzle Kit. Its file timings added up to
1,478 ms, with `0103_w4d_portals_comms` (114 ms), `0096_w3b_purchases` (107 ms), and
`0108_w5d_firm` (95 ms) the slowest in this run.

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

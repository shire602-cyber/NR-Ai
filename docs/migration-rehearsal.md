# Local database migration rehearsal

This rehearsal covers the migration chain through `0140` for `claude/eloquent-maxwell-kjxxjc`.
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

1. **Empty database.** Run the Railway release migration entry point through all 140 registered
   files, from `0000_workable_fixer` through `0140_repair_bank_receipt_provenance`. Verify the ledger
   timestamps and file hashes in journal order. Number `0052` is absent from the active chain.
   Historical SQL under `migrations/_orphaned` is outside the Drizzle journal.
2. **Seeded upgrade.** Apply the first 88 entries through `0088_emirate_no_default`, insert the
   fixture, and take a custom-format `pg_dump`. Read the archive with `pg_restore --list`, restore
   it to a fresh database, and compare schema, table contents, and sequence state. Apply the 52
   pending files from `0089` through `0140` with the release entry point. Run Drizzle Kit and a
   per-file timing pass on separate copies and compare their resulting schema and preserved rows.
   Stop another copy after `0097` to verify payment selection, receipt journal provenance,
   ownership, and GL eligibility before the forward repair runs. Two unallocated legacy lines
   share a unique payment candidate and must both retain a NULL payment ID. Finish the upgrade
   and repeat the full ordered SQL replay with those cases still present.
3. **Previously migrated database.** Apply the historically shipped SQL through `0137` to a copy
   of the seeded baseline. Verify the original `0097` ledger hash and confirm the legacy GL
   states. Apply `0138` to `0140` and verify the repair, findings, and original ledger entries.
   Repeat the release migration, replay the forward files directly, then replay all 52 files in
   journal order with the live allocations and legacy references still present.
4. **Exact earlier review heads.** Verify the entire ledger against the published migration
   file hashes and timestamps through `1c266ae5` and `29e9a1fa`. Apply `0139` and `0140` to the first
   copy, and `0140` alone to the second. Confirm both histories retain their exact ledger entries
   and report the competing allocation claims, including the claim whose stored payment ID is NULL.
   On the `29e9a1fa` copy, verify the missing bank-created receipt flag is restored. Fingerprint
   every table and sequence before and after, allowing that one flag, new findings, and appended
   ledger state. Replay the pending SQL on each upgraded copy to confirm idempotency.
5. **Preservation and replay.** Compare the seeded business records before and after upgrade and
   check the expected backfills. Run the tracked release entry point again against the migrated
   databases and compare the schema, rows, sequences, and ledger. Replay the `0089`
   through `0140` SQL in order on a separate copy with an active allocation whose legacy
   reconciliation fields are empty. Require the ordered replays to preserve the schema, ledger,
   table rows, and sequences.
   The earlier migrations include one-time DDL, such as the unguarded `CREATE TABLE` in `0000`.
   The ordered first run and ledger check cover those files.
6. **Failure and recovery.** Force `0134` to encounter an occupied legacy subscription table.
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

The dedicated banking cases include two invoice payments in one balanced posting and two
payments for the same invoice within a separate posting. The migration selects the unique
payment for each invoice in the first posting. It leaves the ambiguous payment link empty and
records it for review. Additional unreconciled rows retain their cached expense GL when they
carry a legacy invoice or journal link. The expense, inactive bank, archived bank, non-bank
asset, and receivables control destinations are all same-company accounts. The rehearsal
checks that their links are preserved and reported, and that a valid cash destination is used.

The receipt cases distinguish a bank-created journal, a receipt-owned journal, and a foreign
receipt reference. The payment cases include a persisted pending claim whose invoice and journal
identify a payment even though its stored payment ID is NULL. A foreign invoice, journal, and
cached GL reference exercise the tenant ownership findings.

## Migration fixes

- `0089` keeps the existing password marker on an already-revoked test account. It still revokes
  usable test credentials and clears the accounts' privileges and memberships.
  [0089 migration](../migrations/0089_platform_foundation.sql)
- `0097` repairs stale reconciliation state before filling in the GL account from the managed
  bank account. The original order fixed the reconciliation flags on the first pass and needed a
  second pass to correct the GL link. The fixture now verifies both repairs on the first pass,
  together with separate checks for statement ownership and target GL ownership. The migration
  now checks for active or pending allocations before clearing reconciliation flags or filling
  GL links. It fills the match type only on rows for which it creates a legacy allocation and
  links invoice payments only when the company, invoice, and posting identify exactly one
  unclaimed payment. It recognizes a bank-created receipt posting only when its source proves
  the bank transaction created it and the receipt and posting belong to the same company.
  [0097 migration](../migrations/0097_w3c_banking.sql)
- `0138` repairs eligible legacy GL links on databases that already ran `0097`. The transaction,
  statement bank account, and target GL account must belong to the same company. The target must
  be an active, unarchived bank or cash asset outside the control ledgers. Reconciled rows and
  rows with existing match links or active or pending allocations retain their GL links.
  [0138 migration](../migrations/0138_repair_bank_gl_links.sql)
- `0139` records unsafe GL destinations and caches, and reports ambiguous, shared, mismatched, or
  competing payment links. It audits previously migrated databases and retains the recorded
  allocations, payments, and journals. The unmatch service blocks unsafe reversals for operator
  review.
  [0139 migration](../migrations/0139_audit_bank_match_links.sql)
- `0140` restores the receipt allocation flag when the recorded journal proves the bank line
  created it and the allocation, receipt, transaction, and posting agree on ownership. It also
  adds the competing-claim findings when an earlier `0139` is already recorded.
  [0140 migration](../migrations/0140_repair_bank_receipt_provenance.sql)
- `0130` updates the cash-sale sequence only if an imported document raises the current counter.
  Replaying the SQL preserves the timestamp on an unchanged sequence.
  [0130 migration](../migrations/0130_cash_sale_numbering.sql)
- The release entry point clears its pool shutdown timer when the database pool finishes closing.
  The timer previously kept the process alive for the rest of the 10-second timeout.
  [Pool shutdown](../server/db.ts)

Drizzle selects pending entries using the recorded journal timestamps. The original ledger entries
remain valid. The base lane verifies the original `0097` SHA-256
`fc545f83c7470e6624251c1d4492a9f6f6a842d2fd20b4afb94fb28e0fbdc7be`. The exact review-head
lanes verify all 138 or 139 historical entries before and after upgrade, including the
`1c266ae5` hashes for `0089`, `0097`, `0130`, and `0138` and the `29e9a1fa` hash for `0139`.
[Historical SQL](../scripts/rehearsal/historical/)

### Review bank GL findings

After migration, query the durable findings ordered by company and transaction. Each transaction
can have independent statement account, target GL, cached GL, and invoice payment link findings.
`invoice_payment_link_review` includes each flagged allocation, its candidate counts, and the
reason it requires review.
`invoice_payment_competing_claims` lists the match IDs, stored and inferred payment IDs, and
the number of claims on each payment.

```sql
SELECT company_id, bank_transaction_id, kind, details, found_at
  FROM bank_gl_migration_findings
 ORDER BY company_id, bank_transaction_id, kind;
```

Use the account and payment IDs in `details` to review the intended links in the affected
company's records. A shared journal can contain multiple payments, even when the allocation
points to the right invoice payment. Review the whole posting before correcting a shared or
ambiguous link. A rerun preserves the existing finding for each transaction and kind.

Findings are for database operators and can reference another company's account identifiers.
Tenant backup creation, downloads of older tenant backups, and tenant restores exclude these
diagnostics. Full database archives retain them.

## Results

The latest local rehearsal passed with PostgreSQL 16.16 and Node 22.22.2. The clean and
upgraded release databases had identical schemas and 140 ordered ledger entries. The `0137`
copy applied `0138` through `0140`, repaired eligible GL links, and recorded the expected
ownership and eligibility findings. Three ordered replays of the 52-file release chain
preserved the checked schema, rows, and sequences.

The `1c266ae5` copy applied `0139` and `0140`, and the `29e9a1fa` copy applied `0140` alone.
Both retained their exact historical ledger hashes, preserved the NULL payment pointer, and
reported its competing claim. The `29e9a1fa` copy also restored the proven bank-created receipt
flag. The other allocation fields, receipts, payments, and journals matched their original state.
Both forward replays preserved their findings and accounting state.
Both automated rehearsal tests passed in 98.7 seconds while other local checks were running.

| Step                                                         |  Elapsed |
| ------------------------------------------------------------ | -------: |
| Clean release migration (140 files)                          | 5,542 ms |
| Tracked rerun on clean database                              | 2,902 ms |
| Apply baseline (88 files) and seed                           | 4,199 ms |
| Create custom-format backup (425,635 bytes)                  |   332 ms |
| Verify by restoring the backup                               | 1,209 ms |
| Migrate a seeded copy through `0097` and check guards        |   487 ms |
| Ordered SQL replay with banking edge cases (52 files)        |   591 ms |
| Time the pending files individually on a clone               | 2,430 ms |
| Seeded upgrade using Drizzle Kit                             | 2,189 ms |
| Guarded failure at `0134` and transaction rollback           | 4,022 ms |
| Restore the pre-upgrade backup after the failure             | 1,244 ms |
| Seeded release migration after restore (52 files)            | 3,509 ms |
| Tracked rerun on upgraded database                           | 1,447 ms |
| Ordered SQL replay on upgraded copy (52 files)               |   219 ms |
| Restore the separate historical-upgrade copy                 | 1,006 ms |
| Apply the historical files through `0137`                    | 1,165 ms |
| Run the release migration with `0138` through `0140` pending | 1,191 ms |
| Tracked rerun after the forward repair                       | 1,777 ms |
| Direct replay of the forward files                           |    39 ms |
| Ordered SQL replay with live allocations (52 files)          |   217 ms |
| Apply the exact historical `1c266ae5` files                  |   876 ms |
| Apply `0139` and `0140` on `1c266ae5`                        |    69 ms |
| Replay the `1c266ae5` forward files                          |    27 ms |
| Apply the exact historical `29e9a1fa` files                  | 1,183 ms |
| Apply `0140` on `29e9a1fa`                                   |    26 ms |
| Replay the `29e9a1fa` forward file                           |    81 ms |

The release and Drizzle Kit measurements include command startup. The timing copy ran one
transaction per file and produced the same schema as Drizzle Kit. Its file timings added up to
2,139 ms, with `0097_w3c_banking` (167 ms), `0098_w3d_payroll` (164 ms), and
`0096_w3b_purchases` (137 ms) the slowest in this run. A separate test inserted a duplicate active
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

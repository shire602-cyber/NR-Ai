# Local database migration rehearsal

This rehearsal covers the migration chain through `0148` for `claude/eloquent-maxwell-kjxxjc`.
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

1. **Empty database.** Run the Railway release migration entry point through all 151 registered
   files, from `0000_workable_fixer` through `0148_reconcile_preview_firm_membership`. Verify the ledger
   timestamps and file hashes in journal order. Number `0052` is absent from the active chain.
   Historical SQL under `migrations/_orphaned` is outside the Drizzle journal.
2. **Seeded upgrade.** Apply the first 88 entries through `0088_emirate_no_default`, insert the
   fixture, and take a custom-format `pg_dump`. Read the archive with `pg_restore --list`, restore
   it to a fresh database, and compare schema, table contents, and sequence state. Apply the 63
   pending files from `0089` through `0148` with the release entry point. Run Drizzle Kit and a
   per-file timing pass on separate copies and compare their resulting schema and preserved rows.
   Stop another copy after `0097` to verify payment selection, journal provenance, ownership,
   and GL eligibility before the forward repair runs. Two unallocated legacy lines share a
   unique payment candidate and must both retain a NULL payment ID. Finish the upgrade and
   repeat the full ordered SQL replay with those cases still present. Verify that the audit
   chain retains pre-`0097` artifacts from manual invoice matches before and after replay.
3. **Previously migrated database.** Apply the historically shipped SQL through `0137` to a copy
   of the seeded baseline. Verify the original `0097` ledger hash and confirm the legacy GL
   states. Apply the remaining release migrations and verify the repair, findings, and original ledger entries.
   Repeat the release migration, replay the forward files directly, then replay all 63 files in
   journal order with the live allocations and legacy references still present. Check both
   legacy invoice match paths on this older baseline as well.
4. **Exact earlier review heads.** Verify the entire ledger against the published migration
   file hashes and timestamps through `1c266ae5`, `29e9a1fa`, and `48b878ba`. Apply each pending
   suffix and verify the pre-existing ledger rows. Check competing allocation claims on the
   first two copies, including the claim whose stored payment ID is NULL.
   On the `29e9a1fa` copy, verify the missing bank-created receipt flag is restored. Fingerprint
   every table and sequence before and after, allowing that one flag, new findings, and appended
   ledger state. On the `48b878ba` copy, `0141` restores the bank-created invoice journal flag.
   It preserves the independent payment link, payment and journal rows, and existing audit
   findings. Replay the pending SQL on each upgraded copy and the full ordered chain on the
   `48b878ba` copy to confirm idempotency.
5. **Preservation and replay.** Compare the seeded business records before and after upgrade and
   check the expected backfills. Run the tracked release entry point again against the migrated
   databases and compare the schema, rows, sequences, and ledger. Replay the `0089`
   through `0148` SQL in order on a separate copy with an active allocation whose legacy
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

The invoice provenance fixture links one bank line to an independently entered bank-transfer
payment and links a second to a same-company journal created by that bank line. The second journal
has no invoice payment. The rehearsal verifies the independent payment pointer and bank-created
journal flag before and after migration. Separate unmatch tests cover clearing the independent
match and reversing the bank-created posting.

The pre-`0097` manual match fixture adds three cases with the historical `bank.reconcile` audit
payload. One line created a canonical invoice payment. A second linked to an already-paid
invoice without creating a payment or journal. An unsettled invoice supplies a malformed
comparison with the same missing references. After `0109`, the rehearsal checks the audit
payloads and tenant chain fields. It also checks the separately recorded payment and its
`invoice.payment` audit on the already-paid invoice.
[Pre-0097 payment fixture](../scripts/rehearsal/seed-bank-legacy-payment-paths.sql)

### Legacy invoice payment evidence

The old manual route applied the smaller of the available bank amount and the unpaid balance.
It passed the bank line's date and reference to the payment service and wrote the
`bank_reconciliation` method and `Reconciled from bank statement: …` notes. The service posted a
`payment` journal with the invoice ID as its source. The route linked the bank line to its
invoice and journal and wrote a `bank.reconcile` event with the actor, tenant, invoice target,
and transition to matched. The event carried the bank transaction ID as the audit resource.
For an already-paid invoice, the amount was zero and the route only wrote the invoice match and
its audit event.
[Historical bank match route](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/routes/bank-statements.routes.ts#L621-L685)
[Historical payment posting](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/storage.ts#L5366-L5442)

A direct invoice payment could accept the same method and notes from its caller. The invoice-only
`bank.reconcile` payload identifies the match target and leaves payment and journal creation
unproven. Unmatch validates that the same-company allocation, payment, invoice, and posting agree
with the bank line, then clears an exact legacy link while retaining the payment, posted journal,
and invoice settlement. An already-paid legacy link with empty payment and journal references
can be cleared when the same-company invoice remains paid and the receivable balance is zero.
[Historical direct payment route](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/routes/invoices.routes.ts#L1352-L1401)
[Historical audit writer](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/services/audit.service.ts#L20-L52)

The old journal-only route could link an existing journal before a manual invoice match, and
the old unmatch route cleared the originating line's references while its earlier match event
remained in the audit history. An exact payment or journal claim from another bank line requires
review, including when the line survives only in the audit. Separate installments on one invoice
can be unmatched individually when each has its own payment and journal. Current allocations
with explicit payment creation evidence can reverse their own payment and journal. The checks
use existing records and require no migration ledger changes.
[Historical journal-only route](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/routes/ai.routes.ts#L1009-L1042)
[Historical unmatch route](https://github.com/shire602-cyber/NR-Ai/blob/04c3986bb50882cfdafb6ad4affe56cdf891bf93/server/routes/bank-statements.routes.ts#L854-L887)

The release journal retains the portal security entries from PR #71. Its bank entries use
timestamps above the last historical preview timestamp. Catch-up migrations apply the portal
security schema from PR #71 and the reminder language change from PR #75, and the firm membership provenance changes
from PR #74 on preview ledgers that occupied the original slots. A prerequisite entry installs the
firm membership column before the release backfill when a preview ledger skips the original entry. Historical journal entries and compressed SQL fixtures
reproduce their original hashes on replay. The rehearsal verifies the exact `d6d0c35c`
and `0be21c6d` ledgers, applies the catch-up migrations, and compares the
resulting schema and seeded business records.

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
  It also records bank-created invoice journal provenance when that same-company journal has no
  invoice payment.
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
- `0141` restores the allocation flag for a bank-created invoice journal when the journal's
  source identifies the bank line, ownership agrees, and no invoice payment uses the journal.
  The unmatch service can then reverse the bank-created journal while it clears the match alone
  for an independently posted payment. [0141 migration](../migrations/0141_restore_legacy_invoice_bank_provenance.sql)
- `0130` updates the cash-sale sequence only if an imported document raises the current counter.
  Replaying the SQL preserves the timestamp on an unchanged sequence.
  [0130 migration](../migrations/0130_cash_sale_numbering.sql)
- The release entry point clears its pool shutdown timer when the database pool finishes closing.
  The timer previously kept the process alive for the rest of the 10-second timeout.
  [Pool shutdown](../server/db.ts)

Drizzle selects pending entries using the recorded journal timestamps. The original ledger entries
remain valid. The base lane verifies the original `0097` SHA-263
`fc545f83c7470e6624251c1d4492a9f6f6a842d2fd20b4afb94fb28e0fbdc7be`. The exact review-head
lanes verify 138, 139, or 140 historical entries before and after upgrade, including the
`1c266ae5` hashes for `0089`, `0097`, `0130`, and `0138` and the `48b878ba` hashes for `0097`,
`0139`, and `0140`.
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
The report also records missing references on legacy invoice links. It captures the migration
state. An unmatch decision uses the current settlement and ownership evidence, including the
case where an invoice was already fully paid when the bank link was recorded.

Findings are for database operators and can reference another company's account identifiers.
Tenant backup creation, downloads of older tenant backups, and tenant restores exclude these
diagnostics. Full database archives retain them.

## Results

The latest local rehearsal passed with PostgreSQL 16.16 and Node 22.22.2. The clean and
upgraded release databases had identical schemas and 151 ordered ledger entries. The `0137`
copy applied the remaining release entries, repaired eligible GL links, and recorded the expected
ownership and eligibility findings. The ordered 63-file replays preserved the checked schema,
rows, and sequences on each copy.

The `1c266ae5` copy applied `0139` through `0141` and the `29e9a1fa` copy applied `0140` and
`0141`. Both retained their historical ledger hashes, preserved the NULL payment pointer,
and reported its competing claim. The `29e9a1fa` copy also restored the proven bank-created
receipt flag.

The `48b878ba` copy applied `0141` alone. The original 140 ledger entries, the independent
payment and journal, the invoice-linked posting, and the existing audit findings all matched
their pre-upgrade state. The forward migration restored the bank-created flag on the one
eligible allocation. Direct replay and the full ordered replay preserved the resulting state.
The expanded banking cases kept the legacy audit payloads and accounting records intact through
the full ordered replay on both the current and original-release copies.

The focused bank reconciliation suite passed 55 HTTP tests on local PostgreSQL 16.16. A fixture
with the original invoice-only audit payload and no direct-payment audit cleared an exact legacy
link, keeping the paid invoice, payment, and journal intact. An exact journal claim in a deleted
line's audit returned HTTP 409 with `PAYMENT_REVERSAL_REVIEW_REQUIRED` and preserved the match
and accounting. Two legacy installments unlinked independently and kept their postings. Two
current installments each reversed their own payment and journal when unmatched. An upgraded
AED 100 deposit kept its original payment and bank debit after unlinking. Rematching returned
HTTP 409 and the bank balance stayed at AED 100.
[Bank reconciliation tests](../tests/db/banking-reconciliation.test.ts)

Historical timings below were recorded before PR #71 was integrated.

| Step                                                         |  Elapsed |
| ------------------------------------------------------------ | -------: |
| Clean release migration (141 files)                          | 2,876 ms |
| Tracked rerun on clean database                              | 1,326 ms |
| Apply baseline (88 files) and seed                           | 2,379 ms |
| Create custom-format backup (425,636 bytes)                  |   310 ms |
| Verify by restoring the backup                               |   761 ms |
| Migrate a seeded copy through `0097` and check guards        |   194 ms |
| Ordered SQL replay with banking edge cases (53 files)        |   157 ms |
| Time the pending files individually on a clone               | 1,054 ms |
| Seeded upgrade using Drizzle Kit                             | 1,429 ms |
| Guarded failure at `0134` and transaction rollback           | 1,743 ms |
| Restore the pre-upgrade backup after the failure             |   597 ms |
| Seeded release migration after restore (53 files)            | 2,097 ms |
| Tracked rerun on upgraded database                           | 1,005 ms |
| Ordered SQL replay on upgraded copy (53 files)               |   167 ms |
| Restore the separate historical-upgrade copy                 |   614 ms |
| Apply the historical files through `0137`                    |   647 ms |
| Run the release migration with `0138` through `0141` pending | 1,174 ms |
| Tracked rerun after the forward repair                       | 1,024 ms |
| Direct replay of the forward files                           |    24 ms |
| Ordered SQL replay with live allocations (53 files)          |   152 ms |
| Apply the exact historical `1c266ae5` files                  |   631 ms |
| Apply `0139` through `0141` on `1c266ae5`                    |    28 ms |
| Replay the `1c266ae5` forward files                          |    20 ms |
| Apply the exact historical `29e9a1fa` files                  |   901 ms |
| Apply `0140` and `0141` on `29e9a1fa`                        |    27 ms |
| Replay the `29e9a1fa` forward files                          |    20 ms |
| Apply the exact historical `48b878ba` files                  |   904 ms |
| Apply `0141` on `48b878ba`                                   |    38 ms |
| Replay `0141` on the `48b878ba` copy                         |    35 ms |
| Replay the 53-file chain on the `48b878ba` copy              |   204 ms |

The release and Drizzle Kit measurements include command startup. The timing copy ran one
transaction per file and produced the same schema as Drizzle Kit. Its file timings added up to
909 ms, with `0103_w4d_portals_comms` (78 ms), `0106_w5b_commercial` (76 ms), and
`0108_w5d_firm` (57 ms) the slowest in this run. A separate test inserted a duplicate active
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

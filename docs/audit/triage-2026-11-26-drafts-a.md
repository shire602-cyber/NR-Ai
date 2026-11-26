# Draft test triage, 2026-11-26 (drafts A)

Base `7f3aff4e51`.

The initial local PGlite run discovered 21 cases across 6 files but ran only nine (5 failed and 4
passed). It did not reach all 21, and 12 were blocked in startup (#86 and #88 data integrity).

Final totals: 2 unit tests and 24 distinct targeted database cases passed using PGlite. Two existing
expanded billing race cases are Postgres-only and were skipped locally. Standalone `tsc`, started
before the last edits, returned exit 0. `npm run check` passed on the remediation changes (typecheck,
API contracts and all three guards). See "Local runtime notes".

## #86 billing

The original billing cases were confirmed against the draft with Git diff/show, by name and claims.
The rerun of this file gave 6 passes, including both original DB cases, and skipped the two existing
Postgres-only concurrent metadata variants.

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #86 | `tests/unit/au5-checkout.test.ts` | Same blob already tracked. Unit test passed. | Retain existing coverage |
| #86 | `au5-subscription-lifecycle`, "keeps the customer's current subscription when a previous one is cancelled" | Included in the expanded tracked file. First run blocked in startup, passed on rerun. | Retain existing coverage |
| #86 | `au5-subscription-lifecycle`, "reflects a change to the yearly Professional price in the Stripe customer portal" | Included in the expanded tracked file. First run blocked in startup, passed on rerun. | Retain existing coverage |
| #86 | `au5-subscription-lifecycle`, "reconciles a portal downgrade delivered during the checkout Stripe read (metadata: %s)" (expanded race, two cases, `true` and `false`) | Postgres-only through `ctx.skip(!h.concurrencySupported)`. Skipped locally on PGlite. | Retain existing coverage, requires Postgres CI |

The DB file path is `tests/db/au5-subscription-lifecycle.test.ts`.

## #88 backup

The three behaviour cases were confirmed against the draft with Git diff/show, by name and claims.
The backup fixes are on the tip through merge `b9ffe43f` and commit `27885b41`. All rows are in
`tests/db/audit-au7-backup.test.ts`. All three cases passed on rerun.

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #88 | "merge preserves a bank transaction's invoice match made after the snapshot" | Fix and draft behaviour on tip. First run timed out, passed on rerun. | Retain existing coverage |
| #88 | "clone refuses a target with a purchase order and preserves the order" | Fix and draft behaviour on tip. First run timed out, passed on rerun. | Retain existing coverage |
| #88 | "replace preserves data in a table introduced after the snapshot" | Fix on tip, coverage strengthened to preservation. First run timed out, passed on rerun. | Retain existing coverage |

## #88 other six paths

The six imported paths (one unit file, five DB files) were untracked on resumption and matched the
draft blobs at that point. ESLint passed on all six then (exit 0, no output). Test-side corrections
made since are noted in the rows below.

A rerun of all six billing and AU7 DB files gave 18 passed and two Postgres-only intrinsic skips.
It also gave one confirmed failure, which occurred before the posted-stocktake product-delete
storage fix was loaded (posted line fields were null after the cascade). An isolated rerun of the
data-integrity file with wasm tier-up disabled and the latest storage guard passed 4/4, including
the zero-variance posted-stocktake case. Everything else passed, including all transactions (3),
receipts (2), delivery (2), migrations (2) and the other three data-integrity cases.

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #88 | `tests/unit/audit-au7-delivery-pagination.test.ts`: "includes every inbound invoice across provider pages during reconciliation" | Unit test passed. | Retain imported test, unmodified |

The 13 DB cases:

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #88 | `tests/db/audit-au7-data-integrity.test.ts`: "AU7 preserves existing budget lines when a replacement CSV exceeds the annual amount limit" | Defect confirmed in code. Blocked in startup on the first run, passed on rerun. | Fixed, budget import is atomic in one transaction |
| #88 | `tests/db/audit-au7-data-integrity.test.ts`: "AU7 preserves the cost centre referenced by a budget plan" | Defect confirmed in code. Blocked in startup on the first run, passed on rerun. | Fixed, budget references to a cost centre are guarded |
| #88 | `tests/db/audit-au7-data-integrity.test.ts`: "AU7 retains the lines of a posted zero-variance stocktake after product deletion is requested" | Defect confirmed in code. Blocked in startup on the first run. Failed before the storage fix was loaded (posted line fields null after cascade). | Fixed, posted zero-variance stocktakes are protected in the existing product-deletion storage seam, without the #169 route list. Passed in the isolated rerun with the guard loaded |
| #88 | `tests/db/audit-au7-data-integrity.test.ts`: "AU7 omits soft-deleted bank transactions from the period close checklist" | Defect confirmed in code. Blocked in startup on the first run, passed on rerun. | Fixed, month-end excludes rows with `deleted_at` |
| #88 | `tests/db/audit-au7-delivery.test.ts`: "reconciles a transient draft-creation error when an inbound document is delivered again" | First run, the call resolved because the test mocked the old registry key. Passed on rerun. | Test now mocks the current `bills.prepareDraftFromInbound` seam, same assertion |
| #88 | `tests/db/audit-au7-delivery.test.ts`: "preserves a delivered acknowledgement received before the sender records the provider result" | First run failed, status ended `sent` despite a delivered timestamp. Passed on rerun. | Fixed, provider states are preserved atomically |
| #88 | `tests/db/audit-au7-migrations.test.ts`: "0039 preserves a paid payroll run and its payslip when a newer draft exists" | Reduced in-memory PGlite baseline reproduced 0039 removing the paid row item. After the fix, a probe verified payroll preserved, with an explicit reconcile error. Passed on rerun. | Fix covers unapplied upgrade paths only (see "Migration fix scope") |
| #88 | `tests/db/audit-au7-migrations.test.ts`: "0074 renumbers a duplicate beyond 999 without colliding with an existing journal" | Reduced in-memory PGlite baseline reproduced a unique index error from 0074. After the fix, a probe verified journal 1000 applied. Passed on rerun. | Fix covers unapplied upgrade paths only (see "Migration fix scope") |
| #88 | `tests/db/audit-au7-receipts.test.ts`: "preserves the retained receipt's image after a split sibling is deleted" | Baseline case, the sibling DELETE succeeded, then the retained sibling's image GET returned 404. Passed on rerun. | Fixed, scoped reference check after row deletion |
| #88 | `tests/db/audit-au7-receipts.test.ts`: "keeps receipt posting retryable when writing its VAT treatment fails" | Passed on the first run (VAT retry). | Retain coverage |
| #88 | `tests/db/audit-au7-transactions.test.ts`: "AU7 preserves goods received after a completed count awaiting posting" | Baseline assertion failed, stock dropped from 15 units / AED 300 to 10 / AED 200. Passed on rerun. | Fixed, post the variance captured at count, and a transactional drift guard rejects a conflicting nonzero draft (Arabic and English message) |
| #88 | `tests/db/audit-au7-transactions.test.ts`: "AU7 keeps the recurring bill date due if creation is blocked by a closed period" | Passed on the first run. | Retain coverage |
| #88 | `tests/db/audit-au7-transactions.test.ts`: "AU7 claims the stored recurring-bill day when the worker runs in Dubai" | First run, the correct timestamp was billed, but the check compared raw timestamp text with a date-only value (stale). Passed on rerun. | SQL now casts to date first, no assertion lowered |

### Migration fix scope

Only unapplied upgrade paths are fixed. The documented precedent in
`docs/release/PLATFORM-OWNER.md` is that the migrator goes by journal timestamps, not hashes, so
already-applied scripts do not re-run. These changes cannot recover past losses.

## #82 portal exclusions

Both rows are in `tests/db/backup-full-restore.test.ts`, the only file #82 changes. The exclusions
are verified in the backup service code (`server/services/backup.service.ts`), and the defensive
assertions are already on the tip. Both existing portal table manifest cases passed on rerun.

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #82 | "keeps customer_portal_accounts out of the accounting backup and restore manifest" | Exclusion and assertion on tip. First run timed out, passed on rerun. | Retain existing coverage |
| #82 | "keeps customer_portal_invitations out of the accounting backup and restore manifest" | Exclusion and assertion on tip. First run timed out, passed on rerun. | Retain existing coverage |

## Local runtime notes

- Vitest forks fail on this Windows host with spawn `EPERM`. The runs used the native config loader
  and worker threads.
- Totals: 2 unit tests and 24 distinct targeted database cases passed using PGlite. The two
  existing expanded billing race cases are Postgres-only and were skipped.
- Full `npm run lint` passed, as did targeted ESLint. The migration journal check passed 158 files.
  The Bash wrapper of `npm run check:migrations` was blocked on this host (spawn `EPERM`), and the
  equivalent `git grep` scan of the same patterns and allowlist passed.
- Standalone `npx tsc --noEmit -p .` returned exit 0. It was started before the last edits, so it
  does not cover them. The later `npm run check` passed on the remediation changes (typecheck, API
  contracts and all three guards).
- Postgres is unavailable (`ECONNREFUSED`), so DB runs use the PGlite fallback. Earlier setup hit
  the 300s timeout. A setup timeout is not evidence of a product defect.
- Native PGlite/WASM crashed during a combined targeted rerun of the newest stocktake storage
  change. The complete data-integrity file was rerun in isolation with wasm tier-up disabled and
  passed 4/4.
- Git alternate metadata is in the workspace because the linked-worktree index and original object
  store writes are denied. No #169 files were touched.
- The commit was created in the workspace `.audit-delivery.tmp` Git metadata because the original
  metadata was read-only. The push failed because Windows blocked the credential helper. The commit
  remains local.

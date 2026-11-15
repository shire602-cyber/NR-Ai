# server/ledger — the posting kernel (W2-A)

Every journal entry is written here. `server/ledger/index.ts` is the **frozen public API**; later
workstreams import from `../ledger` and nothing else. `storage.createJournalEntry` keeps its old
signature and delegates to the kernel (`legacy.ts`), so legacy callers are exact and guarded until
they move to `postJournal` (ratchet: `node scripts/check-ledger-writes.mjs`).

## Rules every write obeys

| Rule                | Behaviour                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money               | Integer fils via `shared/money.ts`. Balance is exact: total debit fils === total credit fils. No tolerance.                                                                                   |
| Precision           | More than 2 decimals is `422 INVALID_AMOUNT` (`details.reason = MONEY_TOO_PRECISE`); never rounded. NaN, Infinity, exponent strings, values outside `numeric(15,2)` are also 422.             |
| Lines               | Each line has exactly one strictly positive side (`ZERO_AMOUNT_LINE`, `LINE_HAS_BOTH_SIDES`, `NEGATIVE_JOURNAL_AMOUNT`). Foreign amounts sit on the base side (`FOREIGN_SIDE_MISMATCH`).      |
| Accounts            | Must belong to the company (`ACCOUNT_NOT_FOUND`), be active and not archived (`ACCOUNT_INACTIVE`). Cost centres must belong to the company (`COST_CENTER_NOT_FOUND`).                         |
| Same account        | An entry where every account nets to zero is `422 SAME_ACCOUNT_ENTRY` unless `allowSameAccount`.                                                                                              |
| Dates               | Real calendar dates 1900..9999 (`INVALID_DATE`); not after today (`FUTURE_DATE`) unless `allowFutureDate`. Locked periods: `403` from `services/period-lock.service.ts`.                      |
| Numbering           | `JE-YYYYMMDD-NNN` allocated inside the posting transaction under `pg_advisory_xact_lock` (R14-06). No session locks. Unique `(company_id, entry_number)` is the backstop; one retry on 23505. |
| Idempotency         | `idempotencyKey` is unique per company (partial unique index). A repeat returns the original entry with `replayed: true`.                                                                     |
| One reversal        | Unique partial index on `reversed_entry_id` for `entry_kind = 'reversal'` plus `reversed_by_entry_id` on the original, set in the same transaction. Losers get `409 ALREADY_REVERSED`.        |
| Ledger-effect state | `status` stays `draft` / `posted` (reports filter on it). A reversed or voided original is still `posted`; its lifecycle is derived (`journalLifecycle`).                                     |

All errors are `DomainError(code, status, details)` and render as `{ message, code, details }`.

## API

```ts
import {
  postJournal,
  postDraft,
  reverseEntry,
  voidEntry,
  reverseBySource,
  submitForApproval,
  updateDraftEntry,
  describeReversal,
  withLedgerTx,
  defineMachine,
  assertTransition,
  transitionRow,
  journalMachine,
  journalLifecycle,
  previewEntryNumber,
} from "../ledger";
```

### `postJournal(input, ctx) -> { entry, lines, replayed }`

```ts
await postJournal(
  {
    companyId,
    date: "2026-03-31", // or a Date
    memo: "March accrual",
    source: "bill",
    sourceId: bill.id, // default source "manual"
    idempotencyKey: `bill:${bill.id}:post`,
    status: "posted", // or "draft"
    kind: "standard", // reversal | closing | year_end_close | opening | revaluation
    autoReverseOn: "2026-04-01", // optional accrual auto-reversal
    lines: [
      { accountId: expense, debit: "1000.00", costCenterId },
      { accountId: vatInput, debitFils: 5000 },
      {
        accountId: ap,
        credit: "1050.00",
        foreignCurrency: "USD",
        foreignCredit: "285.91",
        exchangeRate: "3.6725",
      },
    ],
  },
  {
    actorId: userId,
    tx /* optional */,
    req /* audit ip/ua */,
    audit: true /* optional audit row */,
  }
);
```

Amounts: `debit` / `credit` are major units (decimal string, or a number with at most 2 decimals);
`debitFils` / `creditFils` are integer fils. Use one form per side.

### `postDraft(entryId, ctx, { approvalThresholdFils? })`

One conditional `UPDATE ... WHERE id = $1 AND status = 'draft' RETURNING`. Zero rows ->
`409 ENTRY_NOT_DRAFT`. Writes exactly one `journal.post` audit row in the same transaction.
Re-validates the stored lines (exact balance, active accounts), the period lock and the date.
Maker-checker: above the threshold and not approved, the creator gets `409 APPROVAL_REQUIRED`; a
different user posting stamps `approval_status = 'approved'`, `approved_by`, `approved_at`.

### `reverseEntry(entryId, { date?, reason? }, ctx)` / `voidEntry(entryId, { reason? }, ctx)`

Mirrors the ORIGINAL lines exactly — accounts, base amounts, foreign amounts, exchange rate, cost
centre — with sides swapped. Default date: the original date if its period is open, else today. A
caller-chosen date must not be before the original (`422 REVERSAL_BEFORE_ORIGINAL`). The original
gets `reversed_by_entry_id` and `reversal_kind` (`reversed` | `voided`) in the same transaction
(row locked `FOR UPDATE`). Void = reversal dated on the original date. A reversal cannot itself be
reversed (`409 ENTRY_IS_REVERSAL`); a non-posted entry is `409 ENTRY_NOT_POSTED`. Reversals may hit
accounts archived since the original was posted.

Scheduled reversals (integration W2): `ReverseOptions` also takes `allowFutureDate` (explicit
`date` after today, e.g. FX revaluation reversing on as-of + 1), `source`, `sourceId` and `memo`
for the reversal entry (defaults `reversal`, the original id, `Reversal of <number>`). The link and
the one-reversal rule are unchanged.

### `reverseBySource(companyId, source, sourceId, { date?, reason?, void? }, ctx)`

Reverses every unreversed posted entry of one document in one transaction (void, credit, unmatch,
revise flows). Returns `[]` when nothing is left to reverse, so it is safe to call twice.

### `updateDraftEntry(entryId, input, ctx)` / `submitForApproval(entryId, ctx)`

Replace a draft's header and lines with the same validation (conditional on `status = 'draft'`), and
mark a draft `approval_status = 'pending'`.

### `deleteDraft(entryId, ctx) -> boolean`

Deletes a draft entry and its lines in one transaction, conditional on `status = 'draft'` and the
company (`ctx.companyId`). Returns `false` when the entry is already gone and 409
`ENTRY_NOT_DRAFT` once it is posted (reverse it instead). Writes a `journal.delete_draft` audit row.
Used by bank unmatch to remove an unposted rule draft.

### State machines

```ts
const billMachine = defineMachine({
  states: ["draft", "approved", "paid", "void"],
  transitions: { draft: ["approved", "void"], approved: ["paid", "void"] },
});
assertTransition(billMachine, bill.status, "approved"); // 409 INVALID_TRANSITION
const row = await transitionRow(
  tx,
  vendorBills,
  id,
  "draft",
  "approved",
  { approvedBy: userId },
  { machine: billMachine, where: eq(vendorBills.companyId, companyId) }
);
if (!row) throw new DomainError("BILL_NOT_DRAFT", 409); // lost a race or wrong state
```

`transitionRow` is a single `UPDATE ... WHERE id = $id AND status IN ($from) RETURNING`; it returns
`null` when no row matched. `journalMachine`: `draft -> posted -> reversed | voided`.

### Transactions and events

`withLedgerTx(async (tx, { afterCommit }) => ...)` opens a transaction (or joins `outer`) and runs
`afterCommit` callbacks after the outermost commit. Emit domain events there, never inside the
transaction. The frozen domain-event catalogue (`server/platform/domain-events.ts`) has no journal
events yet, so the kernel itself emits none.

## Jobs (`templates.ts`, registered with `server/platform/job-registry.ts`)

- `ledger.recurringJournals` (daily 01:17 UTC): posts due `journal_templates` occurrences with
  idempotency key `template:<id>:<date>` and advances `next_run_on` by the frequency.
- `ledger.autoReverse` (daily 01:27 UTC): reverses posted entries whose `auto_reverse_on` has
  arrived (today when that period is locked).

## Legacy adapter (`legacy.ts`)

`storage.createJournalEntry(entry, lines)`: per-line ROUND_HALF_UP to 2dp of float amounts (what
`numeric(15,2)` did on insert), debit/credit netted onto one side, zero lines dropped, then the same
exact-balance, account and period rules. Future dates and same-account entries stay allowed. A
caller-supplied `entryNumber` is ignored. A legacy entry with `reversedEntryId` that exactly mirrors
the original becomes a kernel reversal (links the original, blocks a second one); a partial credit
keeps only the reference.

## Schema (migration 0090)

`journal_entries`: `idempotency_key`, `reversed_by_entry_id`, `reversal_kind`, `entry_kind`,
`is_duplicate_reversal`, `reference`, `approval_status`, `approved_by`, `approved_at`,
`auto_reverse_on`. New tables: `ledger_repair_findings` (duplicate reversals and unbalanced entries
found in existing books — posted data is never edited), `ledger_settings`
(`manual_approval_threshold`), `journal_templates`, `journal_attachments`.

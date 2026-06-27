# Credit-Note Consolidation Plan (A-B11)

> Implemented on `fix/p0-correctness-and-security` via migration
> `0081_credit_note_consolidation.sql` plus the guarded real-DB regression
> `RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... npm run
> test:credit-note-consolidation`.

## The problem

Two parallel credit-note systems exist:

1. **Invoice-embedded (canonical, recommended keeper).** `POST
   /api/companies/:id/invoices/:invoiceId/credit-note` creates an `invoices`
   row with `invoiceType = 'credit_note'`, negative amounts, an
   `originalInvoiceId` link, and posts a balanced reversing JE. These rows are
   already picked up by the invoice line query in `calculateVatReturn`
   (multiplying by `i.exchange_rate`, so FX-correct) and were hardened this pass
   (cap/dedup A-B3, fail-hard A-B2, balanced builder).

2. **Standalone `credit_notes` table** (`credit-notes.routes.ts`,
   `createCreditNote`). Separate table and lifecycle, **not linked to an
   invoice**, **no `exchange_rate` column**, and counted by a *separate*
   subtraction query in `calculateVatReturn` (`vat-autopilot.service.ts:679-689`)
   that does **not** apply FX (this is the real A-B15 gap).

Risks of the split: divergent lifecycles, the foreign-currency VAT gap (A-B15),
and potential double-counting if both are ever used for the same adjustment.

## Recommendation

Make the **invoice-embedded** path canonical; deprecate standalone
`credit_notes` writes; migrate existing standalone rows into the unified model.

## Migration steps (sequenced to avoid double-counting the VAT return)

1. **Backfill** each `credit_notes` row into `invoices` as
   `invoiceType = 'credit_note'` (negative subtotal/VAT/total, copy
   `currency`; set `exchangeRate` = 1 where unknown, or capture the real rate if
   recoverable), plus its lines into `invoice_lines`. Link via
   `originalInvoiceId` where derivable. Post the reversing JE if the standalone
   row never posted one (idempotent by source).
2. **Switch reads:** point `credit-notes.routes.ts` list/get at the unified
   invoice rows (`invoiceType = 'credit_note'`) so the UI shows one set.
3. **Switch writes:** route standalone creation through the invoice-embedded
   handler (or 410 the old create endpoint behind a feature flag).
4. **Remove the divergent VAT-return subtraction** (`vat-autopilot.service.ts`
   credit-note query) — once standalone CNs are migrated, they're already
   counted by the invoice line query, so leaving the subtraction would
   double-count. This step MUST come after the backfill, in the same release.
5. **Retire** the `credit_notes` / `credit_note_lines` tables (keep for the
   FTA 5-year retention window; stop writing to them).

## Why this isn't done in this pass

- It's a **data migration** over real rows — must be validated against a
  production-like DB, not the mocked-DB unit suite.
- Step 4's timing is load-bearing: removing the subtraction before the backfill
  would *under*-count credit notes (over-declare VAT); after, leaving it would
  *double*-count (under-declare). Either error is an FTA filing mistake.
- The primary path already works, so there's no correctness emergency forcing a
  rushed change.

## Suggested verification

- A real-DB integration test: create a standalone CN, run the backfill, assert
  the VAT return total is unchanged (no double/under count) before vs after, and
  that the trial balance still ties.

## Implementation notes

- `invoices.legacy_credit_note_id` is the durable idempotency marker for migrated
  standalone rows.
- Existing standalone CN journal entries are repointed from
  `source='credit_note'` to `source='invoice'` with the canonical credit-note
  invoice ID. The journal lines are not rewritten, so posted balances stay
  unchanged.
- Issued standalone rows without a source journal are posted only when the
  company has the default AR, revenue, VAT-output accounts and a company user to
  satisfy journal audit fields.
- The legacy `credit_notes` / `credit_note_lines` tables remain for retention,
  but live reads/PDFs now adapt canonical invoice credit notes and standalone
  writes return HTTP 410.

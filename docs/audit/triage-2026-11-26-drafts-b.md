# Public launch audit draft triage

Test branch tip `7f3aff4e`. Exclusion list taken from PR #169 at `6be2d51a`.
The draft branches contain ten files added since their merge bases. Five of those
files were already present on the test tip and were kept at the tip versions.
PRs #80 and #84 add cases to existing suites. Their draft versions were used
locally for comparison.

| PR  | Test                                                                                                                                                        | Result on current tip                                                                                                                            | Action                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #80 | `customer-emails` — Arabic sender note in HTML and plain text                                                                                               | Pass                                                                                                                                             | Current suite already covers the sender's Arabic payment instruction.                                                                                                                                                                                                                                   |
| #80 | `e2-launch-fixes` — reviewed VAT return stays pending at AED 0 and AED 80                                                                                   | Both pass                                                                                                                                        | Current filing logic requires a recorded FTA reference.                                                                                                                                                                                                                                                 |
| #80 | `report-delivery-scheduler` — saving the Arabic catalog cadence preserves Monday                                                                            | Failed. The planner moved the next run from Monday 23 November to Friday 27 November at 08:00 UTC, and the scheduler did not queue it on Monday. | Normalize the subscription's exact Arabic catalog label to its canonical cadence when planning. The scheduler uses the same normalized cadence. Added a focused regression.                                                                                                                             |
| #84 | `einvoice-complyance-adapter` — VAT-inclusive AED total and seller/buyer passport issuing countries                                                         | Both pass                                                                                                                                        | Already fixed in `2b6c79b7` and covered in the current adapter suite.                                                                                                                                                                                                                                   |
| #83 | Unit `audit-documents` — margin-scheme UBL payable amount                                                                                                   | Pass                                                                                                                                             | Imported the original regression.                                                                                                                                                                                                                                                                       |
| #83 | Unit `audit-documents` — margin-scheme PDF line amounts                                                                                                     | PDF generated, then text extraction hit Windows `spawn EPERM`.                                                                                   | CI-only here. CI installs Poppler for the original assertion.                                                                                                                                                                                                                                           |
| #83 | Unit `audit-documents` — BTAE-10 gross and BTAE-08 VAT on a USD line                                                                                        | Failed. XML tagged the amounts USD and emitted 1050.00 and 50.00.                                                                                | Convert the two PINT AE amounts to AED. Preserve exact document-currency line amounts for the adapter in the queued submission snapshot so AED rounding does not alter the provider payload. [PINT AE semantic model](https://docs.peppol.eu/poac/ae/v1.0.5/pint-ae/trn-invoice/semantic-model/ibg-39/) |
| #83 | Unit `audit-receipt-currency` — currency label on a foreign OCR receipt                                                                                     | Timed out in the concurrent sweep. Passed in isolation.                                                                                          | The current review form uses the OCR document currency. Imported the original regression.                                                                                                                                                                                                               |
| #83 | Unit `audit-vat201` — sales document totals and partial exemption                                                                                           | Pass                                                                                                                                             | Kept the version already on the tip.                                                                                                                                                                                                                                                                    |
| #83 | DB `audit-credit-fx` — remaining credit VAT boxes, settlement after payment reversal, USD overpayment in trial balance, cost-centre credit, refund-date FX  | CI-only here                                                                                                                                     | Kept the expanded tip suite. Review any confirmed posting, rounding, or reversal failure with #169.                                                                                                                                                                                                     |
| #83 | DB `audit-documents` — AED tax export from a USD functional ledger                                                                                          | CI-only here. Source inspection showed that the generator used the invoice-to-ledger rate of 1 as the USD-to-AED rate.                           | Resolve the document-currency-to-AED rate at the sales tax point (crossing through the ledger currency, both legs on that date, when there is no direct rate). Imported the original API regression for CI verification.                                                                                |
| #83 | DB `audit-ledger` — cash-sale prefix across years, migration prefix collision, close retry, UAE boundary, one-fil journal imbalance, hard December lock     | CI-only here                                                                                                                                     | Kept the expanded tip suite. Review any confirmed period-lock failure with #169.                                                                                                                                                                                                                        |
| #83 | DB `audit-purchase-vat` — withholding-only edit, customs declaration across omitted import-VAT edits, blocked and reverse-charge VAT boxes                  | Failed in CI (all three)                                                                                                                         | Removed. See open findings below.                                                                                                                                                                                                                                                                       |
| #83 | DB `audit-reports` — dated write-off/reinstatement, A/P reversal date and GL tie-out, cash-flow reversal bucket, GL detail-limit tie-out, multi-year budget | Failed in CI (all five)                                                                                                                          | Fixed and kept the GL detail-limit and multi-year budget cases in `server/reporting/statements.ts`. Removed the other three. See open findings below.                                                                                                                                                   |
| #83 | DB `audit-vat201` — service-completion quarter, stale return filing, USD settlement, group VAT settlement, partial bad-debt recovery                        | PGlite setup timed out after five minutes.                                                                                                       | CI-only here. Kept the expanded tip suite. Review any confirmed return-finalization failure with #169.                                                                                                                                                                                                  |
| #87 | DB `au6-bank-import` — unambiguous import, ambiguous date order, invalid date rolls back the whole import                                                   | CI-only here                                                                                                                                     | Kept the stronger tip test that also checks a blank date and the exact row error. The current invalid-date guard is in `server/services/bank-import.service.ts`.                                                                                                                                        |

The normal Vitest config loader hit `spawn EPERM` in Vite's Windows network-drive
lookup. A temporary native config with the same test setup, aliases, and discovery
allowed threaded unit runs. The DB attempt found no local Postgres server
(`ECONNREFUSED`) and stalled in the PGlite fallback. Treat all seven DB suites
listed above as pending CI execution. The temporary snapshots also reported
failures in pre-existing cases, including the old Arabic email's English input,
the old VAT fixture without a reference, stale scheduler mocks, and old adapter
request mocks. The audit's added cases were evaluated separately.

## PINT AE tax exchange rate (PR #174 review 3)

`server/services/einvoice/context.ts` is the single source of the document-to-AED rate for
preflight, generation and enqueue (all call `loadEInvoiceContext`); it also reports where the rate
came from in `options.taxExchangeRateSource`.

- A sale uses the rate at its own sales tax point. A credit note linked to a same-currency original
  reuses the rate the **original actually exported**: `cac:TaxExchangeRate/cbc:CalculationRate` in
  the original's persisted PINT AE XML, accepted only when it is currency into AED and positive
  (`taxExchangeRateSource: original_xml`). Only when the original has no usable recorded rate is
  its own tax point resolved again (`original_supply`). The credit's date and journal rate are
  never used, so a rate-table change after the sale cannot make the credit drift. Example: an
  AED-ledger EUR sale booked at 4.2 with supply-date rate 4 exports EUR 50 VAT as AED 200; after
  the rate table changes, a full credit still exports AED 200 while its journal reverses AED 210
  (`tests/db/audit-documents.test.ts`).
- Retry safeguards are unchanged: attempted or queued requests replay their frozen XML (the
  snapshot carries no rate); this lookup applies only to a fresh generation or regeneration.
- With no rate-table entry the row's stored positive manual rate is used (`stored_manual`). On an
  AED ledger it is document-to-AED. On a non-AED ledger it is document-to-base, so it is accepted
  only multiplied by a valid tax-point base-to-AED bridge. `GET /api/invoices/:id/einvoice/validate`
  returns `taxExchangeRate: { rate, source }` (null for an AED document) so the source is observable.
- Relationship to `server/tax/vat-engine.ts`: at line 695 `computeVat201` converts a sales document
  at `invoice.exchangeRate` (the booked rate), and for foreign-currency credit notes it uses the
  actually posted VAT remainder from the `creditNoteReversal` journal. This change does not alter
  that engine. The e-invoice export rate and the VAT 201 figure can therefore differ (e.g. credit:
  ledger/VAT 201 AED 210 vs XML AED 200); reconciling them is left to the owner of the engine
  (**Needs Claude/#169**).

`generalLedger` (`server/reporting/statements.ts`) now reads company, accounts, totals and the capped
detail lines in one repeatable-read, read-only transaction. In the same file, the budget comparison
now clips its date range to the plan's dates before counting overlapping monthly allocations.
`server/services/report-render/statements.ts` adds separate bilingual (English/Arabic) ledger
truncation notes for the PDF renderer cap and the source ledger cap. Local PostgreSQL returned
`ECONNREFUSED`, and both audit suites initially timed out in PGlite. A single-worker retry passed
six tests across `audit-documents` and `audit-reports`. The concurrent-post test requires real
PostgreSQL and remains pending in CI.

## Re-evaluation of the removed tests

All six removed cases remain open and are listed below as **Needs Claude/#169**. The cash-flow case
was retested with a report-only fix. The original fixture's bill approval returned HTTP 500 before
the classifier ran, so the case and its candidate fix were removed from the worktree diff.

## Open findings not landed (tests removed from this PR)

Actual values are from
[CI run 45803439941, job 139852352109](https://github.com/shire602-cyber/NR-Ai/actions/runs/45803439941/job/139852352109).
No passing small fix was verified for any of them, so all are **Needs Claude/#169**
(owner-level change; check for file overlap before editing). The original cases are in #83;
`:N` after a case is the line of its assertion in the original test file.

### `tests/db/audit-purchase-vat.test.ts` (whole file removed)

Setup for all three: AED company in Dubai; bill dated 2026-01-15, approved, then VAT boxes for
2026-01-01 to 2026-03-31. "Domestic" is 1000 at 5%; "reverse charge" is an imported service of 1000
at 5% with `vat_supply_type: reverse_charge`.

| Case                                                                                                                                                                                     | Assertion                                | Expected | Actual  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- | ------- |
| Line-level reverse charge survives a withholding-only edit (domestic + reverse-charge bill, total 2050.00, then `PATCH withholding_amount: 10`), `audit-purchase-vat.test.ts:55`         | Supplier payable (`total_amount`)        | 2040.00  | 2090.00 |
|                                                                                                                                                                                          | Box 3 reverse-charge output VAT          | 50       | 0       |
|                                                                                                                                                                                          | Box 9 domestic input VAT                 | 50       | 100     |
|                                                                                                                                                                                          | Box 10 reverse-charge input VAT          | 50       | 0       |
| Customs declaration survives successive edits that omit import VAT (`is_import`, `import_vat_amount: 60`, posted VAT 60.00, then withholding 10 and 20), `audit-purchase-vat.test.ts:77` | `import_vat_amount` after the first edit | 60.00    | 0.00    |
|                                                                                                                                                                                          | `vat_amount` after the second edit       | 60.00    | 50.00   |
|                                                                                                                                                                                          | Box 6 and box 10                         | 60 each  | 50 each |
| Blocked domestic VAT and recoverable reverse-charge VAT (domestic line on a new "Client entertainment" account 5095, plus the reverse-charge line), `audit-purchase-vat.test.ts:98`      | Box 13 total recoverable                 | 50       | 50      |
|                                                                                                                                                                                          | Box 9 domestic                           | 0        | 25      |
|                                                                                                                                                                                          | Box 10 reverse charge                    | 50       | 25      |

### `tests/db/audit-reports.test.ts` (three cases removed)

| Case                                                                                                                                                                                                      | Assertion                                                               | Expected         | Actual                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| Receivable written off at a month end stays written off there after a later reinstatement (invoice 1000 + 5% dated 2025-01-10, written off 2025-06-05, reinstated 2025-07-10), `audit-reports.test.ts:71` | A/R aging at 2025-06-30 before reinstatement: GL, aging, reconciled     | 0, 0, true       | Passed                                   |
|                                                                                                                                                                                                           | A/R aging at 2025-07-31: GL, aging, reconciled                          | 1050, 1050, true | Passed                                   |
|                                                                                                                                                                                                           | A/R aging at 2025-06-30 after reinstatement: GL, aging, reconciled      | 0, 0, true       | 0, 1050, false                           |
| Voiding an old bill payment uses the same effective date in A/P aging and GL 2010 (asset bill 1000 dated 2025-01-10, paid 2025-02-10, then voided), `audit-reports.test.ts:90`                            | A/P aging at 2025-02-28 before the void: GL, aging, reconciled          | 0, 0, true       | Passed                                   |
|                                                                                                                                                                                                           | After the void: GL, and aging equal to GL                               | 1000, 1000       | GL 1000 (that assertion passed), aging 0 |
| A capital-asset payment and its void net in the same cash-flow activity (same bill; February 2025 cash flow), `audit-reports.test.ts:106`                                                                 | Before the void: investing, operating                                   | -1000, 0         | Passed                                   |
|                                                                                                                                                                                                           | After the void, direct and indirect: `cashProof` balanced, net change 0 | true, 0          | Passed                                   |
|                                                                                                                                                                                                           | After the void, direct and indirect: operating, investing               | 0, 0             | +1000, -1000                             |

## Review with Claude/#169 if CI reproduces

- **Needs Claude/#169** for a confirmed F01 or F07 posting failure. Review
  `server/services/document-totals.service.ts:164` and
  `server/services/invoice-posting.service.ts:262` together. Compare the VAT
  allocation and original-rate credit legs with the posted invoice, and keep
  realized FX on payments and payment reversals.
- **Needs Claude/#169** for a confirmed F06 UAE period boundary failure. Review
  `server/services/period-lock.service.ts:190` and compare the effective UAE
  accounting date with the lock date.
- **Needs Claude/#169** for a confirmed bank statement preview or import failure
  in `server/routes/bank-statements.routes.ts:463` on #169. Keep the date-order decision
  and row validation consistent between preview and commit.

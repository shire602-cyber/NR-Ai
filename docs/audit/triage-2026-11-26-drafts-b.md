# Public launch audit draft triage

Test branch tip `7f3aff4e`. Exclusion list taken from PR #169 at `6be2d51a`.
The draft branches contain ten files added since their merge bases. Five of those
files were already present on the test tip and were kept at the tip versions.
PRs #80 and #84 add cases to existing suites. Their draft versions were used
locally for comparison.

| PR | Test | Result on current tip | Action |
| --- | --- | --- | --- |
| #80 | `customer-emails` — Arabic sender note in HTML and plain text | Pass | Current suite already covers the sender's Arabic payment instruction. |
| #80 | `e2-launch-fixes` — reviewed VAT return stays pending at AED 0 and AED 80 | Both pass | Current filing logic requires a recorded FTA reference. |
| #80 | `report-delivery-scheduler` — saving the Arabic catalog cadence preserves Monday | Failed. The planner moved the next run from Monday 23 November to Friday 27 November at 08:00 UTC, and the scheduler did not queue it on Monday. | Normalize the subscription's exact Arabic catalog label to its canonical cadence when planning. The scheduler uses the same normalized cadence. Added a focused regression. |
| #84 | `einvoice-complyance-adapter` — VAT-inclusive AED total and seller/buyer passport issuing countries | Both pass | Already fixed in `2b6c79b7` and covered in the current adapter suite. |
| #83 | Unit `audit-documents` — margin-scheme UBL payable amount | Pass | Imported the original regression. |
| #83 | Unit `audit-documents` — margin-scheme PDF line amounts | PDF generated, then text extraction hit Windows `spawn EPERM`. | CI-only here. CI installs Poppler for the original assertion. |
| #83 | Unit `audit-documents` — BTAE-10 gross and BTAE-08 VAT on a USD line | Failed. XML tagged the amounts USD and emitted 1050.00 and 50.00. | Convert the two PINT AE amounts to AED. Preserve exact document-currency line amounts for the adapter in the queued submission snapshot so AED rounding does not alter the provider payload. [PINT AE semantic model](https://docs.peppol.eu/poac/ae/v1.0.5/pint-ae/trn-invoice/semantic-model/ibg-39/) |
| #83 | Unit `audit-receipt-currency` — currency label on a foreign OCR receipt | Timed out in the concurrent sweep. Passed in isolation. | The current review form uses the OCR document currency. Imported the original regression. |
| #83 | Unit `audit-vat201` — sales document totals and partial exemption | Pass | Kept the version already on the tip. |
| #83 | DB `audit-credit-fx` — remaining credit VAT boxes, settlement after payment reversal, USD overpayment in trial balance, cost-centre credit, refund-date FX | CI-only here | Kept the expanded tip suite. Review any confirmed posting, rounding, or reversal failure with #169. |
| #83 | DB `audit-documents` — AED tax export from a USD functional ledger | CI-only here. Source inspection showed that the generator used the invoice-to-ledger rate of 1 as the USD-to-AED rate. | Resolve the tenant's ledger-currency-to-AED rate on the issue date and combine it with the invoice's stored rate. Imported the original API regression for CI verification. |
| #83 | DB `audit-ledger` — cash-sale prefix across years, migration prefix collision, close retry, UAE boundary, one-fil journal imbalance, hard December lock | CI-only here | Kept the expanded tip suite. Review any confirmed period-lock failure with #169. |
| #83 | DB `audit-purchase-vat` — withholding-only edit, customs declaration across omitted import-VAT edits, blocked and reverse-charge VAT boxes | CI-only here | Imported the suite. |
| #83 | DB `audit-reports` — dated write-off/reinstatement, A/P reversal date and GL tie-out, cash-flow reversal bucket, GL detail-limit tie-out, multi-year budget | CI-only here | Imported the suite. |
| #83 | DB `audit-vat201` — service-completion quarter, stale return filing, USD settlement, group VAT settlement, partial bad-debt recovery | PGlite setup timed out after five minutes. | CI-only here. Kept the expanded tip suite. Review any confirmed return-finalization failure with #169. |
| #87 | DB `au6-bank-import` — unambiguous import, ambiguous date order, invalid date rolls back the whole import | CI-only here | Kept the stronger tip test that also checks a blank date and the exact row error. The current invalid-date guard is in `server/services/bank-import.service.ts`. |

The normal Vitest config loader hit `spawn EPERM` in Vite's Windows network-drive
lookup. A temporary native config with the same test setup, aliases, and discovery
allowed threaded unit runs. The DB attempt found no local Postgres server
(`ECONNREFUSED`) and stalled in the PGlite fallback. Treat all seven DB suites
listed above as pending CI execution. The temporary snapshots also reported
failures in pre-existing cases, including the old Arabic email's English input,
the old VAT fixture without a reference, stale scheduler mocks, and old adapter
request mocks. The audit's added cases were evaluated separately.

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

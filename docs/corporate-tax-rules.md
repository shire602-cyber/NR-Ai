# UAE corporate tax and compliance rules (W4-A)

Every rule the corporate tax module and the compliance calendar apply, with its legal source.
The module shows **"adviser review pending"** in the UI (and `adviserReviewPending: true` from
`GET /api/companies/:companyId/corporate-tax/rules`) until an owner or accountant records an
adviser confirmation (`POST .../corporate-tax/profile/adviser-confirmation`). Changing the QFZP
status or the MNE group revenue clears the confirmation.

Muhasib does not submit anything to the FTA. "Filed" means the user recorded that the return was
filed in EmaraTax; the export is labelled "upload manually — no FTA API".

Code: `shared/ct-workpaper.ts` (pure computation), `server/services/corporate-tax/` (engine,
lifecycle, deadlines, data access), `server/services/compliance-obligations.service.ts`
(calendar), `shared/validators/corporate-tax.ts` (request schemas).

## Computation

| Rule                                       | Value in code                                                                                                                                                                                                  | Source                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Standard rate                              | 9% above the band, never client-set (`CT_STANDARD_RATE`)                                                                                                                                                       | FDL 47/2022 Art. 3(1)(b)                                         |
| 0% band                                    | First AED 375,000 (`CT_ZERO_RATE_BAND`)                                                                                                                                                                        | Cabinet Decision 116/2022                                        |
| Entertainment                              | 50% of the amount entered is added back (`entertainment_50`, rate 0.5)                                                                                                                                         | FDL 47/2022 Art. 32                                              |
| Fines and penalties                        | 100% added back                                                                                                                                                                                                | FDL 47/2022 Art. 33(4)                                           |
| Donations to non-qualifying entities       | 100% added back                                                                                                                                                                                                | FDL 47/2022 Art. 33(3)                                           |
| Owner drawings / non-business expenses     | 100% added back                                                                                                                                                                                                | FDL 47/2022 Art. 28                                              |
| Related-party payments above arm's length  | 100% added back (manual)                                                                                                                                                                                       | FDL 47/2022 Art. 34-36                                           |
| Exempt income (participation / foreign PE) | Deducted                                                                                                                                                                                                       | FDL 47/2022 Art. 22-24                                           |
| Unrealised gains (realisation basis)       | Deducted; listed in the deferred-tax note                                                                                                                                                                      | FDL 47/2022 Art. 20(3)                                           |
| Corporate tax expense                      | Excluded from the CT base (accounts tagged `corporate_tax_expense`)                                                                                                                                            | FDL 47/2022 Art. 33(9)                                           |
| Loss relief                                | Carried-forward losses offset at most 75% of taxable income                                                                                                                                                    | FDL 47/2022 Art. 37(2)                                           |
| Small Business Relief                      | Election; revenue ≤ AED 3,000,000 in the period and every prior period; only for tax periods ending on or before **31 Dec 2026**; not for a QFZP; losses neither used nor added while claimed                  | FDL 47/2022 Art. 21; Ministerial Decision 73/2023 (Art. 2, 4, 6) |
| Interest limitation                        | Net interest expense deductible up to the greater of 30% of tax-EBITDA and AED 12,000,000; the excess is added back and carried forward; spare capacity absorbs the carried-forward pool                       | FDL 47/2022 Art. 30; Ministerial Decision 126/2023               |
| Tax-EBITDA                                 | Taxable income before the limitation + net interest expense + depreciation and amortisation                                                                                                                    | Ministerial Decision 126/2023 Art. 4                             |
| QFZP de minimis                            | Non-qualifying revenue ≤ 5% of total revenue **and** ≤ AED 5,000,000                                                                                                                                           | Cabinet Decision 100/2023 Art. 3; Ministerial Decision 265/2023  |
| QFZP rates (test met)                      | 0% on qualifying income, 9% on non-qualifying income, no AED 375,000 band                                                                                                                                      | FDL 47/2022 Art. 3(2), Art. 18                                   |
| QFZP (test failed)                         | QFZP status lost for the period and the following four tax periods; all taxable income under the standard regime (0% band then 9%)                                                                             | FDL 47/2022 Art. 19                                              |
| QFZP income split                          | Revenue-proportional allocation of taxable income unless the preparer enters the non-qualifying taxable income (simplification; adviser review)                                                                | —                                                                |
| Transfer pricing disclosure form           | Required when related-party transactions exceed AED 40,000,000 in the period (register + accounts tagged `related_party`)                                                                                      | FDL 47/2022 Art. 55; Ministerial Decision 97/2023                |
| Master File / Local File                   | Revenue ≥ AED 200,000,000, or member of an MNE group with consolidated revenue ≥ AED 3,150,000,000                                                                                                             | Ministerial Decision 97/2023 Art. 3                              |
| Deferred tax                               | Note schedule in the workpaper, plus a manual deferred-tax adjustment journal (A4): closing DTA / DTL entered or computed from a temporary-difference schedule at 9%; the movement posts to 1270 / 2260 / 5210 | IAS 12.15-24, 12.58                                              |
| CT provision                               | Optional on filing: Dr Corporate Tax Expense (5200) / Cr Corporate Tax Payable (2060) through the ledger kernel; reversed when the return is amended                                                           | —                                                                |

Adjustment categories are a closed enum; each category fixes the sign and the share. Unknown
categories, non-numeric or negative amounts, and a client-supplied `direction` are rejected with 400.

### Account tags (`accounts.tax_tag`)

`entertainment`, `fines_penalties`, `donations_non_qualifying`, `related_party`,
`exempt_income`, `interest`, `qfzp_qualifying_income`, `qfzp_non_qualifying_income`,
`corporate_tax_expense`, `corporate_tax_payable`. `ensureCtTagAccounts(companyId)` creates a
tagged account per tag on demand (codes 5091, 5151-5154, 4095, 5200, 2060, or the next free
code); the default chart of accounts is unchanged. Pulling a workpaper from the books turns
tagged account activity into ledger adjustments; manual adjustments, losses and elections are
preserved and the full liability is recomputed.

## Return lifecycle

`draft → computed → reviewed → filed → paid`; `reviewed → computed` sends a return back for
changes; `draft | computed → void`; `filed | paid → amended` by copy (the new draft references the
original through `amends_return_id`). Filed, paid, amended and void returns are immutable (409).
The reviewer must differ from the preparer (a single-member company may self-review; the audit row
records it). Every transition writes an `audit_logs` row (`corporate_tax_return.*`).

### Year-end accrual, true-up and deferred tax (A4, IAS 12)

- `POST /api/corporate-tax/returns/:id/accrue` (computed or reviewed) posts the computed tax as
  the current-tax liability at the reporting date: Dr 5200 / Cr 2060, dated period end, source
  `corporate_tax_accrual` (IAS 12.12). Re-accruing after a recompute reverses the previous accrual
  first; an unchanged amount is a no-op. Voiding the return reverses the accrual.
- Filing with `postProvision` against an accrual posts only the true-up (filed tax - accrued tax,
  source `corporate_tax`): dated period end while that period is open, else on the filing date as
  a prior-period under/over-provision (IAS 8.36, change in estimate). Unfiling reverses only the
  true-up; an amendment keeps the accrual and posts its own true-up when filed. Without an accrual
  filing posts the full provision at period end (unchanged behaviour).
- Deferred tax: `POST /api/companies/:companyId/corporate-tax/deferred-tax` (and `/preview`) takes
  the closing deferred tax asset / liability, a temporary-difference schedule (`asset` / `liability`
  items with carrying amount and tax base, `tax_loss` / `interest` amounts) or `fromReturnId` (the
  workpaper note), and posts the movement against the ledger: 1270 Deferred Tax Asset and 2260
  Deferred Tax Liability (both non-current, IAS 1.56) against 5210 Deferred Tax Expense, which is
  tagged `corporate_tax_expense` (excluded from the CT base, presented with income tax). A full
  automatic schedule from the fixed-asset register and other sub-ledgers is a documented follow-up.
- Losses from returns filed outside Muhasib (before go-live):
  `/api/companies/:companyId/corporate-tax/external-returns` (period, revenue, loss and disallowed
  interest carried forward, filing reference). The latest prior period, Muhasib or external,
  supplies the next return's brought-forward pool (FDL 47/2022 Art. 37); a period already covered
  by a Muhasib return cannot also be entered.
- `GET /corporate-tax/calculate` reports revenue less expenses as `accountingProfit` (profit before
  tax); `grossProfit` is kept as a deprecated alias.

## Deadlines and the compliance calendar

| Obligation                       | Due date                                                                                                                                                      | Source                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Corporate tax return and payment | 9 months after the end of the tax period; a month-end period end gives the last day of the 9th month (31 Dec 2025 → 30 Sep 2026)                              | FDL 47/2022 Art. 48(1), 53(1)                                         |
| VAT return and payment           | 28 days after the end of the tax period, by the company's stagger and frequency                                                                               | FDL 8/2017 Art. 64; Executive Regulation Art. 59                      |
| Corporate tax registration       | 3 months after incorporation for persons incorporated on or after 1 Mar 2024; earlier licences by the FTA month table                                         | FDL 47/2022 Art. 51; FTA Decision 3/2024                              |
| UBO register confirmation        | Annually at the trade-licence renewal date (or 31 Dec)                                                                                                        | Cabinet Decision 58/2020                                              |
| Trade-licence renewal            | The licence expiry date in the CT / compliance profile                                                                                                        | Emirate or free-zone licensing authority                              |
| Excise tax return                | 15 days after the monthly tax period, when excise registered                                                                                                  | FDL 7/2017; Cabinet Decision 52/2019 as amended                       |
| E-invoicing milestones           | Revenue ≥ AED 50M: appoint an accredited service provider by 31 Jul 2026, mandatory from 1 Jan 2027. Below AED 50M: by 31 Mar 2027, mandatory from 1 Jul 2027 | Ministerial Decisions 243/2025 and 244/2025 (confirm with an adviser) |
| Payroll / WPS                    | Salaries through WPS by the 15th of the following month, when the company has active employees                                                                | FDL 33/2021 Art. 22; MoHRE Ministerial Resolution 43/2022             |

**ESR is not generated.** Economic Substance Regulations notifications and reports were withdrawn
for financial periods ending after 31 December 2022 (Cabinet Decision 98/2024), so the calendar
creates no ESR obligations.

Status of VAT, CT and registration rows derives from the actual return state (a filed return
completes its row and the overview rolls forward to the next period); other rows can be completed
or dismissed by an owner, admin or accountant. The daily job `compliance.deadlineScan` (01:10 UTC)
regenerates the current and next year and emits `compliance.deadline_due` 30, 14, 7 and 1 days
before each open obligation (once per offset). Other modules read upcoming obligations through the
service `compliance.listUpcoming`.

## Audit readiness score

| Check                                                                | Weight |
| -------------------------------------------------------------------- | ------ |
| Bank reconciliation completeness (last 90 days)                      | 25     |
| VAT returns filed for every due period                               | 25     |
| Last month locked                                                    | 15     |
| Documents posted (draft invoices, unposted receipts, draft journals) | 20     |
| Corporate tax returns filed when due                                 | 15     |

A check with nothing to measure (no bank transactions, no return due yet) scores full marks and
says so. Each check returns its explanation.

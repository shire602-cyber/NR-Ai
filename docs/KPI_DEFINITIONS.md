# Dashboard KPI definitions

The dashboard numbers come from one place, `server/reports/kpis.ts`, over the shared ledger layer
(`server/reports/ledger.ts`). The P&L report, the P&L and balance-sheet routes and the dashboard read the same SQL, so
dashboard revenue equals P&L revenue by construction. Each KPI below has an integration test in
`tests/integration/phase8-d4.test.mjs` (the K-numbers).

All amounts are AED. All days are Dubai calendar days (UTC+4, no DST). Only **posted** journal entries count.

## Endpoint

`GET /api/companies/:companyId/dashboard/stats?period=month|ytd|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`

- `period=month` (default): the first of the Dubai month to today.
- `period=ytd`: the start of the company's fiscal year (`fiscal_year_start_month`) to today.
- `period=custom`: needs `from` and `to`, at most five years.
- There is **no all-time option**. `period=all`, or anything else, answers `422 INVALID_PERIOD`.

The response carries `period: { kind, from, to }` so the page can say which period it shows.

## The KPIs

| Field | Definition |
|---|---|
| `revenue` | Sum of (credit - debit) over income accounts in the selected period. Leaves out year-end close entries and the corporate-tax accrual. Equals P&L revenue for the same range. |
| `expenses` | Sum of (debit - credit) over expense accounts in the period, leaving out year-end close entries and the corporate-tax accrual (`corporate_tax_filing`). |
| `netProfit` | `revenue - expenses`. |
| `cashPosition` | Debit minus credit of the cash and bank accounts now (account sub-type cash or bank, codes 1010-1039, or a name containing cash, bank or petty). |
| `outstanding` | Receivables: open balance of every issued, standing (not void) invoice that is not a credit note, as at the end of today, AED: `total - payments - live credit notes`, never below 0. A credit note is never counted as an unpaid invoice; it reduces the invoice it credits. Equals account 1040 for AED documents. |
| `arAging` | The open receivables in five buckets by whole days past due: `current` (due today or later), `days1to30`, `days31to60`, `days61to90`, `days90plus`. A missing due date is issue date + 30 days. The five add up to `outstanding`. |
| `overdueReceivables` | `days1to30 + days31to60 + days61to90 + days90plus`: due before today (Dubai). An invoice due today is not overdue until the day is over. |
| `receivablesMissingDueDate` | Count of open invoices with no due date (they are aged as issue date + 30 days; the page flags them). |
| `payablesOutstanding` | Accounts payable: open balance of **posted** vendor bills (status approved, partial, paid, overdue) plus unapplied approved vendor credits (negative), as at today. Pending and draft bills are not in the ledger and are left out. Equals minus the balance of account 2010. |
| `apAging` | The same five buckets for payables. A missing bill due date is bill date + 30 days. |
| `monthlyBurnRate` | Mean of the expense of the last three **completed** Dubai months, leaving out depreciation (account 5100) and corporate-tax expense (5150), and the year-end close and corporate-tax accrual entries. Irrecoverable VAT (5160) **stays in**: it is real cash that leaves the business. |
| `cashRunway` | `cashPosition / monthlyBurnRate`, in months; `null` when the burn is 0 or less. |
| `revenueGrowth` | `(this month's revenue - last month's) / last month's x 100`; `null` when last month's revenue is 0. Independent of the selected period (it always compares calendar months). |
| `expenseGrowth` | Same for expenses. |
| `topExpenseCategories` | The five largest expense accounts of the selected period (name and amount), positive balances only. |
| `vatDueNext` | `{ amount, periodEnd, dueDate }`: the net payable (box 14) of the VAT 201 for the period now due, computed from the books by the same engine as the return; due date = period end + 28 days. When that period's return is already filed or submitted, the next period. `{ amount: null, periodEnd: null, dueDate: null, reason }` with `NO_TRN` (company has no tax registration number), `EMIRATE_NOT_SET` (the return cannot attribute supplies to an emirate) or `UNAVAILABLE`. |
| `totalInvoices`, `totalEntries` | Counts of invoice rows and posted journal entries (kept for the existing pages). |

## Why these choices

- **Period, never all-time.** An all-time revenue figure beside a month's cash and a month's growth says nothing; the old
  all-time sums are gone.
- **Payables are vendor bills, not receipts.** Receipts are expenses already paid in cash; they are never payable. The old
  dashboard aged unposted receipts and showed numbers no ledger account held.
- **Ties to the ledger.** Receivables equal account 1040 and payables equal account 2010 (tests L1 and AC5), so the
  dashboard cannot drift from the books.
- **Dubai days.** "Overdue" flips at Dubai midnight, not at the server's UTC midnight.

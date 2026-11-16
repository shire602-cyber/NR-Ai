# server/reporting — the reporting kernel (W2-B)

One statement implementation for every report endpoint. Routes, exports, tax
and later workstreams import from `server/reporting` (`index.ts`); nothing else
should sum `journal_lines` for a financial statement.

## Policy (binding)

- **Correct by computation, not by closing entries.** Retained earnings brought
  forward = cumulative income − expenses before the fiscal year that contains
  the as-of date (company `fiscal_year_start_month`), plus any balance on the
  retained-earnings account (3020). Current year earnings = P&L from fiscal-year
  start to the as-of date.
- **Only posted entries.** Drafts and voids never reach a statement.
- **Closing entries are excluded everywhere** (`CLOSING_ENTRY_SQL`): the tagged
  year-end close (`source = 'year_end_close'`) and legacy month-end closings
  (`source = 'system'`, memo `Closing entries for …`). They would otherwise zero
  the P&L / corporate tax and be double counted by the roll-forward.
- **Dates are UAE calendar dates** (`YYYY-MM-DD`); an entry's date is compared as
  `(je.date + 4h)::date`.
- **Money is summed in SQL in integer fils** (`ROUND(x * 100)`) and converted to
  AED once at the edge (`aed()`), so results are exact to 2 dp.

## API

| Function | Notes |
| --- | --- |
| `trialBalance({ companyId, from?, to })` | BS accounts cumulative through `to`; P&L accounts `[from, to]`; synthetic `Retained earnings brought forward` row (id `retained-earnings-brought-forward`) when `from` is set. Gross and balance totals; `isBalanced`. |
| `profitAndLoss({ companyId, from?, to, compareTo?, budgetId?, columns? })` | Sections: revenue, cost of sales, gross profit, operating expenses, operating profit, other income (4030/4040/4080/4090 or sub_type), other expenses (5130/5140), net profit. `compareTo`: `prior_period` \| `prior_year` \| `budget` (needs `budgetId`). `columns`: `total` \| `monthly` \| `quarterly`. |
| `balanceSheet({ companyId, asOf, compareTo? })` | Current / non-current from `sub_type` (then chart code); abnormal balances reclassified; equity = capital + RE b/f + current year earnings; `isBalanced`, `difference` always returned. `compareTo`: `prior_year` \| `prior_period` (prior month end) \| `prior_year_end`. |
| `cashFlow({ companyId, from?, to, method })` | `indirect` (default: net income + balance changes) or `direct` (dominant counterpart). Opening / closing cash and a `cashProof` against cash/bank accounts. |
| `cashFlowBuckets({ companyId, from, to, granularity })` | Legacy bucketed inflow/outflow per activity. |
| `generalLedger({ companyId, from?, to, accountIds?, includeClosing? })` | All or selected accounts; BS accounts open cumulative, P&L accounts open fiscal-year-to-date. |
| `agedReceivables({ companyId, asOf })` / `agedPayables(...)` | Reconstructed as of a date from documents less settlements dated ≤ asOf under the one settlement rule (`settlement.ts`), rounded per document. `unappliedCredits` (unapplied debit notes / credit notes with no original) and `netTotal` = total − unapplied; the reconciliation line ties `netTotal` to GL 1040 / 2010. |
| `receivableOpenSql(alias, { asOf? })`, `payableOpenSql(...)`, `receivableSettlementPartsSql`, `unapplied*CreditsFilsSql` (`settlement.ts`) | The one "what is still owed" rule (D5c) as SQL fragments; every open-balance reader builds on them. |
| `cashAccounts(companyId, asOf?)` | Cash / bank accounts with balances. |
| `accountTotals`, `ledgerLines`, `loadAccounts`, `loadCompany` | Low-level, closing-excluded ledger reads for other modules (corporate tax, close). |
| `readRange`, `readAsOf`, `parseReportDate` | Unified params: `from/to`, `startDate/endDate`, `periodStart/periodEnd`; bad dates → 400 `INVALID_REPORT_DATE`. |

`http.ts` (not re-exported from the index) holds route helpers: access check,
`Deprecation` headers for legacy aliases, and xlsx/csv output with numeric cells.

## Canonical routes

`/api/companies/:companyId/reports/{profit-loss, balance-sheet, trial-balance,
cash-flow, general-ledger, general-ledger/export, aged-receivables,
aged-payables, comparison, cash-accounts}`. Legacy aliases
(`/reports/pl`, `/financial-statements/*`, `/api/reports/:companyId/{comparison,
aging, cash-flow, vat-summary}`) are served by the same kernel and send
`Deprecation: true` + a `Link` to the successor where they are superseded.

## Seams

- Year-end close posts through `ClosePostingPort` in
  `server/services/month-end.service.ts` (default: `storage.createJournalEntry`).
  When the ledger kernel lands, call `setClosePostingPort()` with it.
- If a journal `entry_kind` column is added, extend `CLOSING_ENTRY_SQL` in
  `ledger-query.ts`; it is the only place closing entries are recognised
  (`scripts/qa/find-bad-closing-entries.mjs` mirrors it).

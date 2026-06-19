# Report Quality Review - 2026-06-19

## Scope

Reviewed the current report catalog and report rendering code on
`codex/launch-hardening-main-sync` at `572e2f7`, with the synthetic production
report-audit fixture evidence from 2026-06-19. This is a qualitative
accountant/bookkeeper/CFO review of meaning, layout, and precision, not a
third-party accounting certification.

Production visual note: the observed Railway UI still showed the old Reports
sidebar submenu with clipped labels. The current branch has Reports as a direct
sidebar item and plain `/reports` defaults to the report picker workspace, so
deployment/version verification remains required before judging production UX.

## Overall Verdict

The report engine is broad and materially useful: 33 catalog reports are marked
live, the synthetic report-audit company populates sales, receipts, bills,
payroll, inventory, fixed assets, budget, bank, tax, FX, and cost-center data,
and the production authenticated route crawl passed after fixture creation.

The product is not yet QuickBooks-grade in report experience. The strongest
reports are the core financial statements, trial balance, balances, payroll, and
fixed-asset views. The biggest gaps are naming precision, older external report
centers, and a few reports whose title implies accountant-grade output but whose
source is currently an operational proxy.

Launch posture: controlled pilot-ready after latest deployment is verified; not
market-ready against QuickBooks/Wafeq until the P0/P1 report UX and semantic
fixes below are complete.

## Priority Fixes

| Priority | Area | Finding | Required fix |
| --- | --- | --- | --- |
| P0 | Deployment | Production still appeared to serve the old Reports sidebar. | Redeploy latest main/branch, verify `/api/version`, then rerun authenticated production route crawl. |
| P0 | Report discovery | Plain Reports must open the clean report picker, not the command-center/suite experience. | Keep `/reports` defaulting to the report workspace and keep suite/automation panels behind explicit workspace tabs. |
| P1 | Cash Flow Statement | Catalog opens `/advanced-reports?tab=cashflow`, which is analytics-style, not the clean statement page. | Route Cash Flow Statement to the Financial Statements cash-flow tab or add a clean dedicated report view. |
| P1 | Expenses by Vendor/Category | Current reports are receipt-spend summaries, not full accrual expense reports. | Rename to Receipt Spend by Vendor/Category or rebuild from posted ledger/vendor bills/receipts with clear basis. |
| P1 | General Ledger | UI renders `ledgerLines.slice(0, 50)` without a visible "first 50" warning or pagination. | Add pagination/virtualization or an explicit truncation warning plus export-all behavior. |
| P1 | Consolidated Statements | Current report is an accessible-company management roll-up with no eliminations. | Rename as Management Roll-up or add eliminations/ownership/FX translation before calling it consolidated statements. |
| P2 | External report centers | A/R Aging, A/P Aging, VAT Return, FX, Cost Center P&L open separate workspaces with inconsistent report UX. | Bring them into the same report picker shell or add consistent report header, period controls, export, and back navigation. |
| P2 | Report caveats | Several reports use current-status or proxy semantics. | Show basis/caveat inline: current snapshot, not historical as-of; estimate, not posted; readiness, not submission. |

## Report-by-Report Grade

Grade key: `Pass` means accountant-grade with current caveats; `Polish` means
meaning is mostly right but UX/caveat/source clarity needs work; `Fix` means the
current title or layout can mislead a professional user.

| Report | Grade | Meaning | Layout | Precision notes |
| --- | --- | --- | --- | --- |
| Profit & Loss | Pass | Revenue, expenses, net profit by account. | Clean statement table with totals. | Good; should stay aligned with Financial Statements page to avoid duplicate experiences. |
| Balance Sheet | Pass | Assets, liabilities, equity by account. | Clean statement table. | Good; as-of date language is correct. |
| VAT Summary | Polish | Output VAT, input VAT, net VAT payable/refund. | Clean and concise. | Needs visible tie-out path to VAT Return boxes and filing status. |
| Cash Flow Statement | Fix | Should be a formal cash-flow statement. | Catalog opens advanced analytics/charts. | Route to clean Financial Statements cash-flow report; do not market analytics as the statement. |
| A/R Aging | Polish | Open customer invoices after payments by aging bucket. | Advanced page combines AR/AP charts and detail. | Good operational aging; add as-of date and keep current-status caveat. |
| A/P Aging | Polish | Open vendor bills after payments. | Opens Bill Pay summary, not a dedicated report. | Needs dedicated report shell/export/back flow. |
| Trial Balance | Pass | Debit/credit totals by account with balance status. | Accountant-grade table. | Good; keep FX flags and balanced status. |
| VAT Return | Polish | Filing workspace, not just report. | Dedicated VAT page. | Good if draft/submission status remains explicit. |
| Period Comparison | Polish | Current vs previous metrics. | Advanced report table/charts. | Needs per-metric basis/caveat visible because many metrics are proxies. |
| FX Gains and Losses | Polish | Current open foreign-currency exposure. | Opens exchange-rate workspace. | Needs dedicated report output and clear unrealized/current-snapshot basis. |
| General Ledger | Fix | Posted journal lines with debit/credit/source. | Good table, but capped at 50 rows. | Must not silently truncate an accountant report. |
| Account Transactions | Polish | Account-level activity totals. | Good summary table. | Add drill-down filters/account selection for accountant use. |
| Corporate Tax Estimate | Pass | UAE CT estimate and bridge. | Strong report with clear estimate warning. | Good; not a filed liability or submission proof. |
| Customer Balance Summary | Pass | Current open receivables after payments. | Focused table is clean. | Add "current" basis/as-of timestamp to avoid historical aging confusion. |
| Vendor Balance Summary | Pass | Current open payables after payments. | Focused table is clean. | Same current-status caveat as customer balances. |
| Invoice Status | Polish | Invoice status mix, value, unpaid/overdue detail. | Useful but operational. | Good; title is accurate if "issued invoice status" basis remains clear. |
| Budget vs Actual | Polish | Selected budget vs actual totals. | Clean planning table. | Needs selected-budget/source label; not a historical budget trend. |
| Cash Flow Forecast | Polish | 90-day projected inflows/outflows/balance. | Clean forecast table. | Good forecast, not a cash-flow statement or bank-balance proof. |
| Revenue by Customer | Polish | Issued invoice value by customer. | Good focused table. | Rename/caveat as invoiced revenue unless revenue-recognition basis is added. |
| Sales by Product/Service | Pass | Invoice line sales mix, VAT, units, top share. | Good focused table. | Good; do not imply gross margin without COGS allocation. |
| Expenses by Vendor | Fix | Receipt spend by merchant. | Table is readable. | Misnamed if users expect full accrual expenses by vendor. |
| Expenses by Category | Fix | Receipt spend by category. | Table is readable. | Misnamed if users expect P&L expense categories from the ledger. |
| Cost Center P&L | Polish | Allocation-backed income/expense/profit by cost center. | Opens Cost Centers workspace. | Good after allocation preservation fix; needs report-shell presentation/export. |
| Inventory Valuation | Polish | Current stock quantity and cost value. | Good table. | Current inventory queue, not historical valuation; add as-of/costing caveat. |
| Inventory Movement | Pass | Stock movement log and type mix. | Good table. | Good operational inventory report. |
| Fixed Asset Register | Pass | Cost, depreciation, NBV, capitalization review. | Good table and category summary. | Good current register; keep capitalization-review language. |
| Depreciation Schedule | Polish | Estimated monthly depreciation from fixed assets. | Good table. | Label as estimate/ready-to-post, not posted depreciation proof. |
| Payroll Summary | Polish | Payroll run totals, statuses, employees. | Good table. | Run-level report, not GL/payroll-bank reconciliation. |
| WPS / SIF Summary | Polish | SIF readiness for payroll runs. | Good readiness cards. | Readiness only, not WPS bank submission or settlement. |
| Expense Claims | Polish | Claim workflow, approval, reimbursement queue. | Good operational table. | Not a payable/reimbursed liability report unless tied to ledger/payments. |
| Month-End Close Status | Pass | Checklist readiness by close item. | Good review table. | Snapshot/checklist report; not historical close trend. |
| Audit Trail | Polish | Activity logs with keyword risk triage. | Good event table. | Risk labels are triage, not formal audit risk/control findings. |
| Consolidated Statements | Fix | Accessible-company roll-up. | Good table. | No eliminations, ownership rules, or FX translation; rename or harden before market claim. |

## Recommended Next Fix Loop

1. Verify production is serving `572e2f7` or newer, then rerun authenticated
   smoke and route crawl.
2. Fix P1 semantic blockers: cash-flow route, receipt-spend naming/source,
   general-ledger truncation, consolidated-statement naming.
3. Standardize every report opened from the picker to the same report shell:
   title, period/as-of controls, source basis, export, back to reports.
4. Add accountant-grade source basis text to reports that are current snapshots,
   estimates, readiness views, or proxy metrics.
5. Re-run the report-audit fixture and produce screenshots for all 33 report
   views before marking the report suite market-ready.

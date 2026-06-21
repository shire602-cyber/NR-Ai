# Agent Notes

Scope: this file applies to the whole repository.

## Project Layout

- `client/` contains the React/Vite frontend. Vite aliases `@` to `client/src`.
- `client/src/lib/reportCatalog.ts` is the shared source for Reports catalog/workspace metadata,
  automation playbooks, roadmap prerequisites/priorities, automation-health scoring/history, persona
  preference storage, role setup checklists, report-suite/quick-access/saved-view/automation-impact profiles, and
  command-palette report shortcuts; avoid duplicating report labels or deep links elsewhere.
- Keep each report quick-access profile covering every live report for that persona; Dashboard and
  Reports render the first six as primary tiles plus overflow links for the rest. Onboarding
  completion should derive direct quick-access report buttons from the selected profile and open
  them with `reportPersonaHref`. Dashboard and Reports quick-access report cards should expose
  report-open plus API-context workflow automation, comparison, and delivery links.
- `Cost Center P&L` is a live connected report backed by `/cost-centers` and
  `/api/companies/:companyId/cost-centers/profitability`; keep its report-pack coverage mapped
  through `prepareCostCenterProfitabilityForExport`, `buildWorkspaceReportPack`, and the
  `cost-center-net-income` / `cost-center-expenses` comparison metrics before changing
  owner/accountant delivery subscriptions.
- Keep desktop sidebar Reports navigation as a single direct `/reports` item; do not add report
  dropdowns or report-specific links under Reports. Keep mobile report shortcuts catalog-driven
  from `reportPersonaWorkspaces`, `readyReportCatalog`, and `reportPersonaHref`; use stable
  persona/report item keys because multiple reports can share the same tab URL.
- Keep report-level favorites/pins persona-scoped through `getFavoriteReportIds`,
  `setFavoriteReportIds`, and `toggleFavoriteReportId`; sanitize stored IDs against
  `readyReportCatalog` rather than trusting localStorage values.
- Keep decision shortcuts as persona-scoped business-question entry points with stable IDs,
  question-copy ending in `?`, valid report coverage, a same-persona comparison preset, and a
  same-persona automation starter; Dashboard, Onboarding, Mobile Nav, Command Palette, Reports
  workflow finder, workbook exports, and the catalog API consume them directly.
- Keep the five-header product-depth coverage model (`reportProductDepthAreas`) catalog-driven:
  report discovery, role workflows, report automation, advisory/management, and accounting/data
  depth subgoals should link to valid reports and matching persona workflow artifacts, and
  data-depth gaps should name the missing source dependency rather than claiming completion.
  Accounting/data-depth subgoals should keep `evidenceCheckpoints` covering current proxy, missing
  source, and guardrail status plus `requiredSourceRecords` for the concrete records needed to
  unlock the stronger accounting claim.
  Source-drilldown discovery subgoals should keep `sourceDrilldownTargets` persona-scoped to valid
  reports and concrete app routes while documenting the remaining universal row-link gap.
- Keep role workflow checklists catalog-driven through `reportPersonaWorkspaces.workflowSteps`;
  every step should use stable same-persona references for reports, comparison preset, automation
  starter, delivery subscription, decision shortcut, saved view, and report suite, and Reports/API
  surfaces should use `reportRoleWorkflowStepHref` for step anchors. Role workflow API/UI surfaces
  should expose default saved-view links plus delivery handoff recipients and guardrails from the
  linked saved view and delivery subscription.
- Keep automation runbooks derived with `buildReportAutomationRunbookSteps`; each workspace
  playbook should resolve signal, review, and delivery phases from same-persona starters, trigger
  rules, role workflow steps, delivery subscriptions, decision shortcuts, saved views, and suites.
- Keep automation impact outcome signals on `reportAutomationImpactProfiles` honest: describe the
  current report proxy, the missing durable counter, and the guardrail before treating documents
  chased, payments recovered, anomalies resolved, or items auto-posted as real outcomes.
- Keep advisory/management briefs catalog-driven through `reportManagementBriefProfiles`; each
  brief should keep same-persona suite, pack, comparison, starter, delivery, decision, and saved-view
  references plus valid report, KPI widget/metric, narrative, and dimensional links, and use
  `reportManagementBriefHref` for anchors.
- Use `readyReportCatalog` for "open from anywhere" report shortcuts; reserve
  `liveReportCatalog` for invariants that require workbook/report-pack coverage.
- Keep `reportHref` and `reportPersonaHref` opening exact focused reports with stable `report=`
  IDs when a report has a shared Reports tab; tab-only links should be reserved for broad workspace
  navigation so `/reports` remains a compact Report Center instead of rendering every report in a
  tab.
- Keep report catalog API `reportActionContexts` derived from catalog relationships so each
  live report/persona pair exposes persona-scoped report-open, workflow, quick-access, impact,
  starter, delivery, comparison, and related action links without hard-coded client mappings. Client report-action surfaces should
  prefer these API contexts and only fall back to local catalog relationships while sync data loads;
  global and persona summaries should expose `readyReportCount`, `liveReportCount`,
  `apiReportCount`, and `plannedReportCount` so API-ready reports count as ready without being
  treated as workbook-live;
  local report-open fallbacks on Dashboard/Reports surfaces should use `reportPersonaHref` with the
  active workspace/persona rather than generic report tab links;
  this includes quick-access report cards, saved-view automation links, decision-shortcut
  report/automation actions, command-palette report-open plus per-report automation/comparison/delivery/suite
  actions, and Reports workflow-finder/report-library report, automation, comparison, and delivery
  actions.
- Keep Reports workspace pack exports mapped to every live report through `buildWorkspaceReportPack`
  `addSheets(...)` coverage; shared export helpers belong in `client/src/lib/export.ts`.
- Revenue by Customer and Sales by Product/Service comparisons use percentage-share metrics
  (`top-customer-share`, `top-product-service-share`); keep these on `formatComparisonValue` /
  `formatComparisonExportValue` rather than currency formatting.
- Invoice count (`invoice-count`) follows the existing active-invoice document behavior used by
  `invoice-value`: non-void/non-cancelled invoices grouped by document date. Treat it as invoice
  volume/workload, not recognized revenue or collection completion.
- Average invoice value (`average-invoice-value`) uses non-draft, non-void, non-cancelled invoice
  rows grouped by document date; keep it separate from `invoice-value`, which follows the existing
  active-invoice value behavior.
- P&L break-even comparisons (`net-margin`, `expense-ratio`, `revenue-expense-coverage`,
  `break-even-gap`) use P&L total revenue, total expenses, and net profit. `break-even-gap` is
  expenses less revenue floored at zero; do not treat these as product/customer gross margin
  without COGS allocation support.
- Receipt count, average receipt value, and unposted expense/share metrics (`receipt-count`,
  `average-receipt-value`, `unposted-expense-share`, `unposted-receipt-count`,
  `unposted-receipt-value`) use receipts in the comparison range; receipt count is total receipt
  rows, average value is receipt subtotal plus VAT divided by receipt rows, the share is
  value-weighted by receipt subtotal plus VAT, unposted count is unposted receipt rows, and
  unposted value is subtotal plus VAT for those unposted rows. They measure receipt
  workload/posting backlog, not full accrual close completeness.
- Expense claim review value/count (`expense-claim-review-value`, `expense-claim-review-count`)
  use submitted and approved expense claims by claim creation date in the comparison range; value
  sums claim amounts and count tracks claim rows. Submitted expense claim count
  (`submitted-expense-claim-count`) is the submitted-status approval subset from the same claim
  date range; submitted expense claim value (`submitted-expense-claim-value`) sums that submitted
  subset. Approved expense claim count (`approved-expense-claim-count`) is the approved-status
  reimbursement follow-up subset from that range. Approved expense claim value
  (`approved-expense-claim-value`) sums that approved-status subset. Do not treat them as reimbursed
  value, historical payable aging, or payroll-linked reimbursement liability.
- Receipt automation metrics (`auto-posted-receipt-count`, `auto-posted-receipt-value`,
  `receipt-automation-coverage`, `receipt-automation-value-coverage`) use receipts in the
  comparison range. Count/value metrics expose auto-posted receipt rows and their subtotal plus VAT;
  coverage divides those same auto-posted rows/value by total receipt rows/value. Do not present
  them as full GL automation coverage.
- Bank reconciliation coverage/count/value and suggestion metrics (`bank-reconciliation-coverage`,
  `reconciled-bank-count`, `reconciled-bank-value`, `unreconciled-bank-count`,
  `unreconciled-bank-value`, `bank-match-suggestion-coverage`,
  `bank-match-suggestion-value-coverage`, `suggested-bank-match-count`,
  `bank-assisted-transaction-count`, `bank-assisted-transaction-value`,
  `bank-assisted-transaction-coverage`, `bank-assisted-transaction-value-coverage`) use
  `/api/companies/:companyId/bank-statements/transactions`, grouped by bank transaction date,
  current `isReconciled` status, and current `matchStatus === "suggested"` for suggestion metrics;
  assisted bank count/value metrics use reconciled rows plus unreconciled suggested-match rows,
  assisted count coverage divides those rows by total bank transactions, and assisted value
  coverage divides their absolute value by total absolute bank transaction value.
  Reconciled, unreconciled, suggested-match, and assisted bank values sum absolute transaction
  amounts, not net cash movement. Suggested-match value coverage divides suggested-match value by
  unreconciled bank value; assisted value coverage divides reconciled-plus-suggested value by total
  bank transaction value.
  Do not treat them as historical as-of bank reconciliation, accepted/posted matches,
  bank-statement completeness, or cash balance proof.
- Automation work queue metrics (`automation-work-queue-count`, `automation-work-queue-value`)
  aggregate overdue and due-soon invoice/bill counts and values, unposted receipt count/value,
  submitted or approved expense claim count/value, and suggested bank match count/absolute value
  for the comparison range. Due-soon invoice/bill rows are the next-7-day queues after the
  comparison period end and are distinct from overdue rows. Treat them as a finance-reporting action
  queue proxy, not a full workflow SLA, time-saved estimate, future cash schedule, or complete
  automation-health score.
- Ledger automation share (`ledger-automation-share`) is the non-manual-source share of posted
  journal activity; manual ledger activity (`manual-ledger-activity`) is posted journal activity
  from entries with an empty or `manual` source; automated ledger activity
  (`automated-ledger-activity`) is posted journal activity from entries whose source is neither
  empty nor `manual`, measured as total posted activity less manual/no-source activity for the
  comparison range. Automation adoption indexes (`automation-adoption-index`,
  `automation-value-adoption-index`) average available percentage components from receipt
  auto-posting, bank transactions that are already reconciled or have suggested matches, and posted
  ledger activity from non-manual sources. The value index uses receipt subtotal plus VAT, absolute
  bank transaction value, and ledger activity value; components with no source rows/value are
  omitted from the average. Do not present these as complete automation-health scores, formal audit
  classifications, or proof of end-to-end hands-free accounting.
- Balance leverage comparisons (`liability-asset-ratio`, `debt-to-equity-ratio`) use point-in-time
  Balance Sheet snapshots; `startDate` only affects the current-period net-income row returned by
  the endpoint.
- Inventory review items/share/value (`inventory-review-items`, `inventory-review-share`,
  `inventory-review-value`) are current inventory-valuation queue signals for active products that
  are low stock, negative stock, or missing cost, compared against a clear baseline of zero. The
  share divides review rows by active products, the value uses absolute current stock value for
  those review rows, and missing-cost rows may contribute zero until costing exists; do not treat
  these metrics as historical stock-state comparisons, impairment, or COGS measures until inventory
  snapshots exist.
- Fixed asset review items/share/value (`fixed-asset-review-items`,
  `fixed-asset-review-share`, `fixed-asset-review-value`) are current fixed-asset register queue
  signals for active assets needing capitalization journal review or depreciation setup review,
  compared against a clear baseline of zero. The share divides review rows by active assets, and
  the value sums current non-negative net book value for unique review rows; do not treat these
  metrics as historical asset-aging, impairment, or posted depreciation status comparisons.
- Depreciation review items/value, ready items/share, and estimate
  (`depreciation-review-items`, `depreciation-review-value`, `depreciation-ready-items`,
  `depreciation-ready-share`, `depreciation-estimate`) use the current depreciation schedule
  generated from active fixed assets for the selected period. Review items count schedule rows
  requiring setup/date/cost review against a clear baseline of zero; review value sums remaining
  depreciable value for those review rows, so missing-cost rows may contribute zero until setup is
  complete; ready items count ready-to-post suggestion rows against a clear baseline of zero; ready
  share divides ready-to-post rows by ready-to-post plus review rows against a 100% baseline; the
  estimate sums ready-to-post monthly depreciation suggestions. Do not treat these metrics as proof
  of posted depreciation journals or historical fixed-asset close completion.
- Month-end close metrics (`month-end-open-checks`, `month-end-readiness`) use the selected
  month-end checklist snapshot. Open checks is the incomplete item count against a zero baseline;
  readiness is completed items divided by total checklist items against a 100% baseline. Do not
  present either as a historical close trend until month-end checklist snapshots are persisted.
- Audit high-risk events/share (`audit-high-risk-event-count`, `audit-high-risk-event-share`) use
  activity-log rows in the comparison range classified as `High` by the current
  `activityLogRiskLevel` keyword matcher. The share divides high-risk rows by total activity-log
  rows in the same range; treat both as reviewer triage signals, not a formal audit-risk model,
  prior-period-change detector, or complete control assessment.
- Audit review events/share (`audit-review-event-count`, `audit-review-event-share`) use
  activity-log rows in the comparison range classified as Medium or High by the same
  `activityLogRiskLevel` keyword matcher. The share divides Medium-or-High rows by total
  activity-log rows in the same range; treat both as audit review workload signals, not formal
  control finding counts or complete audit coverage measures.
- FX unrealized exposure (`fx-unrealized-exposure`) uses the current FX gains/losses report as an
  as-of snapshot, summing absolute unrealized gains and absolute unrealized losses against a clear
  baseline of zero. Do not treat it as a historical FX movement comparison until FX exposure
  snapshots are persisted.
- Consolidated revenue/expenses/profit/margin (`consolidated-revenue`,
  `consolidated-expenses`, `consolidated-net-profit`, and `consolidated-margin`) use the
  accessible-company consolidated statements roll-up and include only loaded entities with no
  eliminations applied. Consolidated margin is net profit divided by revenue for that roll-up.
  Treat them as management-pack comparison signals, not statutory consolidation, until eliminations,
  ownership rules, and FX translation adjustments are modeled.
- Consolidation review items (`consolidation-review-items`) uses the current consolidated
  statements review count, including failed entities, unbalanced entities, multi-currency entities,
  and single-entity roll-up prompts, against a clear baseline of zero. Treat it as a current pack
  readiness queue, not a historical consolidation trend, until consolidation review snapshots are
  persisted.
- Manual ledger share (`manual-ledger-share`) is value-weighted posted journal activity from entries
  with empty source or `manual` source divided by total posted journal activity in the comparison
  range; keep it aligned with `ledger-automation-share`, `manual-ledger-activity`, and
  `automated-ledger-activity`, and do not treat these as formal audit classifications or complete
  automation-coverage scores.
- Open receivables/payables, paid-invoice share, and DSO/DPO proxy comparison metrics
  (`open-receivables`, `overdue-receivables`, `overdue-receivable-share`,
  `overdue-invoice-count`, `average-overdue-invoice-value`, `average-overdue-invoice-days`,
  `open-invoice-count`, `average-open-invoice-value`, `open-invoice-value-share`,
  `due-soon-invoice-count`, `due-soon-invoice-value`, `average-due-soon-invoice-value`,
  `due-soon-invoice-share`, `open-invoice-share`, `vendor-bill-value`,
  `overdue-invoice-share`, `vendor-bill-count`, `average-bill-value`, `open-payables`,
  `open-bill-value-share`, `open-cash-gap`, `open-cash-coverage`, `open-workload-gap`,
  `open-bill-count`, `average-open-bill-value`,
  `due-soon-bill-count`, `due-soon-bill-value`, `average-due-soon-bill-value`,
  `due-soon-bill-share`, `due-soon-cash-gap`, `due-soon-cash-coverage`,
  `due-soon-workload-gap`, `open-bill-share`, `top-vendor-share`, `paid-bill-share`,
  `overdue-payables`, `overdue-payable-share`, `overdue-bill-count`,
  `overdue-cash-gap`, `overdue-cash-coverage`, `overdue-workload-gap`,
  `average-overdue-bill-value`, `average-overdue-bill-days`, `overdue-bill-share`,
  `paid-invoice-share`, `working-capital-proxy`, `collection-days`, `payable-days`,
  `cash-conversion-gap`) use current invoice/vendor-bill statuses grouped by document date;
  `overdue-receivables` uses unpaid non-draft invoices due by the comparison period end,
  `overdue-payables` uses unpaid bills due by the comparison period end, and
  overdue share/count metrics reuse those overdue document sets, with shares dividing overdue
  balances by open balances for the same period.
  Open invoice count uses the same unpaid, non-draft invoice rows as open receivables; average open
  invoice value (`average-open-invoice-value`) divides open receivable value by that count; and open
  invoice share divides that count by non-draft active invoices in the window. Due-soon invoice
  metrics (`due-soon-invoice-count`, `due-soon-invoice-value`) use those open rows with due dates in
  the seven days after the comparison period end. Treat them as collections workload
  volume/size/mix and next-7-day queue signals, not customer count, value-weighted collections,
  collection-rate history, or a full future cash schedule.
  Open invoice value share (`open-invoice-value-share`) divides open receivable value by revenue
  invoice value for the same window. Treat it as a value-weighted collections mix signal, not a
  collectability rate or cash receipt forecast.
  Due-soon invoice share (`due-soon-invoice-share`) divides due-soon invoice count by open invoice
  count for the same window. Treat it as next-7-day collections queue mix, not a collections
  probability, value-weighted due-soon exposure, or cash receipt forecast.
  Average due-soon invoice value (`average-due-soon-invoice-value`) divides due-soon invoice value
  by due-soon invoice count. Treat it as next-7-day invoice queue size, not expected cash receipt,
  collection priority, or customer value.
  Average overdue invoice value (`average-overdue-invoice-value`) divides overdue receivable value
  by overdue invoice count. Average overdue invoice days (`average-overdue-invoice-days`) averages
  whole days from invoice due date to that comparison period end. Overdue invoice share divides
  overdue invoice count by open invoice count; treat them as overdue collections workload
  age/size/mix signals, separate from value-weighted `overdue-receivable-share`.
  Open bill count uses the same unpaid bill rows as open payables; average open bill value
  (`average-open-bill-value`) divides open payable value by that count; and open bill share divides
  that count by non-void/non-cancelled vendor bill rows in the window. Due-soon bill metrics
  (`due-soon-bill-count`, `due-soon-bill-value`) use those open rows with due dates in the seven
  days after the comparison period end. Treat them as bill-pay workload volume/size/mix and
  next-7-day queue signals, not vendor count, payment-history analytics, or a full future cash
  schedule.
  Due-soon bill share (`due-soon-bill-share`) divides due-soon bill count by open bill count for the
  same window. Treat it as next-7-day bill-pay queue mix, not payment urgency, cash availability, or
  supplier-priority scoring.
  Average due-soon bill value (`average-due-soon-bill-value`) divides due-soon bill value by
  due-soon bill count. Treat it as next-7-day bill-pay queue size, not payment urgency, supplier
  priority, or available-cash proof.
  Due-soon cash gap (`due-soon-cash-gap`) is due-soon bill value less due-soon invoice value;
  negative values mean next-7-day receivables exceed next-7-day bills. Treat it as a net queue
  pressure proxy, not bank-balance forecasting or proof of available cash.
  Due-soon cash coverage (`due-soon-cash-coverage`) divides due-soon invoice value by due-soon bill
  value. Treat it as a next-7-day A/R-vs-A/P coverage proxy, not proof invoices will be collected,
  bills will be paid, or cash is available; when due-soon bill value is zero, the ratio helper
  reports 0 by convention.
  Due-soon workload gap (`due-soon-workload-gap`) is due-soon bill count minus due-soon invoice
  count; positive values mean the next seven days have more bill-pay items than collection items,
  while negative values mean the collections queue is larger. Treat it as seven-day queue-sizing
  context, not effort, urgency, or cash-timing proof.
  Open cash gap (`open-cash-gap`) is open payable value less open receivable value; negative values
  mean open receivables exceed open bills. Treat it as an unpaid A/P-vs-A/R pressure proxy, not a
  bank-balance forecast, working-capital proof, or payment/collection timing model.
  Open cash coverage (`open-cash-coverage`) divides open receivable value by open payable value.
  Treat it as an unpaid A/R-vs-A/P coverage proxy, not proof receivables will be collected, bills
  will be paid, or cash is available; when open payable value is zero, the ratio helper reports 0 by
  convention.
  Open bill value share (`open-bill-value-share`) divides open payable value by vendor bill value
  for the same window. Treat it as a value-weighted bill-pay mix signal, not payment urgency,
  supplier priority, or available-cash proof.
  Open workload gap (`open-workload-gap`) is open bill count minus open invoice count; positive
  values mean more unpaid bill documents than unpaid invoice documents, while negative values mean
  the collections queue is larger. Treat it as queue-sizing context, not effort, complexity, or
  document-priority scoring.
  Overdue cash gap (`overdue-cash-gap`) is overdue payable value less overdue receivable value;
  negative values mean overdue receivables exceed overdue bills. Treat it as a net overdue pressure
  proxy, not a collections recoverability forecast or available-cash proof.
  Overdue cash coverage (`overdue-cash-coverage`) divides overdue receivable value by overdue
  payable value. Treat it as an overdue A/R-vs-A/P coverage proxy, not proof overdue invoices are
  recoverable, bills will be paid, or available cash exists; when overdue payable value is zero, the
  ratio helper reports 0 by convention.
  Overdue workload gap (`overdue-workload-gap`) is overdue bill count minus overdue invoice count;
  positive values mean the overdue bill queue has more documents, while negative values mean the
  overdue collections queue is larger. Treat it as overdue queue-sizing context, not effort,
  recoverability, urgency, or document-priority scoring.
  Average overdue bill value (`average-overdue-bill-value`) divides overdue payable value by overdue
  bill count. Average overdue bill days (`average-overdue-bill-days`) averages whole days from bill
  due date to that comparison period end. Overdue bill share divides overdue bill count by open bill
  count; treat them as overdue bill workload age/size/mix signals, separate from value-weighted
  `overdue-payable-share`.
  Vendor bill value, vendor bill count, average bill value, and top vendor share use
  non-void/non-cancelled vendor bills by `bill_date`, converted with each bill exchange rate where
  value is needed. Top vendor share groups by `vendor_name` with an unknown-vendor fallback. Paid
  bill share uses the current `amount_paid` value capped to bill total, divided by bill value. Do
  not treat them as paid cash spend, P&L expense recognition, historical payment timing,
  procurement-contract concentration, or supplier-master analytics.
  `cash-conversion-gap` is DSO proxy less DPO proxy without inventory days. Do not treat them as
  historical as-of aging, true collection-rate history, or full current-asset/current-liability
  working capital unless a dedicated as-of balance source is added.
- Cash runway/burn comparison metrics (`burn-rate`, `cash-runway-days`) are P&L/current-cash
  proxies capped to the 90-day cash-forecast horizon; do not present them as a full cash-flow model
  or historical cash position comparison.
- Cash forecast risk metrics (`projected-cash-shortfall`, `cash-risk-week-count`) use the current
  90-day cash forecast projections only. They compare projected negative-cash exposure against a
  zero-risk baseline, not against a historical forecast snapshot or bank-balance ledger proof.
- Tax funding metrics (`tax-reserve-coverage`, `tax-funding-gap`,
  `tax-adjusted-runway-days`) compare current positive cash forecast balance against current VAT
  plus corporate-tax exposure; tax-adjusted runway reuses the current burn-rate proxy after
  reserving cash for positive tax exposure. They are cash-readiness proxies, not filed
  liability/payment status, deadline proximity, historical reserve trend, or restricted
  reserve-account proof.
- Budget actual variance (`budget-actual-variance`) compares selected-budget actual totals against
  selected-budget totals from `/api/budget-plans/:id/variance`; the baseline is Budget, not the
  previous period. Do not treat it as historical budget-trend analysis until period-specific budget
  history exists.
- Payroll run count (`payroll-run-count`) counts payroll-run rows in the comparison range. Average
  payroll run value (`average-payroll-run-value`) divides payroll-run net totals by payroll-run
  count. Payroll deduction share (`payroll-deduction-share`) divides payroll-run `total_deductions`
  by `total_basic + total_allowances` for the same comparison range. Payroll covered employees
  (`payroll-covered-employees`) sums `employee_count` across payroll runs in the comparison range;
  payroll cost per covered employee
  (`payroll-cost-per-covered-employee`) divides payroll-run net totals by that summed coverage.
  Treat these as payroll-run coverage/unit-cost/gross-to-net mix signals, not deduplicated HR
  headcount or compensation benchmarking when multiple runs fall in the same range. Payroll
  approval queue (`payroll-approval-queue-count`) counts calculated payroll runs awaiting approval;
  payroll approval queue value (`payroll-approval-queue-value`) sums `total_net` for the same
  calculated-run subset. Payroll readiness queue (`payroll-readiness-queue-count`) counts payroll
  approval tasks for calculated
  runs plus SIF generation tasks for calculated/approved runs missing SIF content;
  `payroll-readiness-queue-value` sums approval queue value plus WPS missing run value. These are
  readiness-task signals, not unique payroll-run counts or values, so calculated runs missing SIF
  content can contribute to both components. WPS missing run count (`wps-missing-run-count`) is the
  calculated/approved-run subset missing `sif_file_content`; WPS missing run value
  (`wps-missing-run-value`) sums `total_net` for that same subset. Payroll expense share
  (`payroll-expense-share`) uses payroll-run net totals divided by P&L total expenses for the
  comparison range; do not treat it as payroll GL reconciliation, bank submission, or settlement
  status until payroll journals and WPS bank files are explicitly mapped into the report model.
- WPS ready share (`wps-ready-share`) is the share of calculated or approved payroll runs with
  generated `sif_file_content`; do not present it as bank submission, WPS settlement, or employee
  payment completion.
- Operating cash-flow comparison (`operating-cash-flow`) uses the latest two quarterly buckets from
  `/api/reports/:companyId/cash-flow/quarter`; do not treat it as a custom date-range cash-flow
  statement until that endpoint supports arbitrary comparison ranges.
- Corporate tax comparison (`corporate-tax-payable`) uses `/corporate-tax/calculate` for the
  current and previous comparison periods; keep it in tax-exposure presets alongside `vat-due` and
  `total-tax-exposure`.
- Total tax exposure (`total-tax-exposure`) is `vat-due` plus `corporate-tax-payable`;
  `tax-exposure-rate` divides that exposure by P&L revenue. Do not treat either as filed tax
  liability, statutory effective tax rate, payment status, or tax-reserve coverage without
  dedicated payment and filing data.
- `client/src/components/reports/ReportLaunchPicker.tsx` is the shared catalog launcher for
  dashboard/report surfaces; keep delivery mutations owned by the page and pass queue handlers and
  preview data in. Derive report-row report-open, automation, delivery, comparison, and suite
  links from API contexts/catalog relationships instead of hard-coding them. Launcher report rows
  should use ready reports (`status !== "planned"`) so API-ready connected reports are searchable.
- Report delivery queue flows can return a `handoffReview` 409 after failed or blocked runs; clients
  should surface the handoff gap and only resend with `acknowledgeHandoffGaps: true` after explicit
  user acknowledgement.
- `server/` contains the Express API, middleware, routes, services, and startup code.
- `shared/` contains the Drizzle schema and shared validators. The alias `@shared` points here.
- `migrations/` contains Drizzle migrations. Treat `migrations/meta/` as Drizzle-managed output.
- `tests/` contains Vitest unit tests plus smoke/E2E scripts.
- Do not edit generated or dependency output such as `dist/` and `node_modules/`.

## Commands

- Install dependencies with `npm ci`.
- Start local development with `npm run dev`. The server validates env on startup; copy
  `.env.example` to `.env` and provide at least `DATABASE_URL`, `SESSION_SECRET`, and
  `JWT_SECRET`.
- Build production assets and the server bundle with `npm run build`; run the built app with
  `npm start`.
- Use `npm run build:analyze` when inspecting production bundle size; it writes the Vite
  visualizer report to `dist/bundle-stats.html`.
- Type-check with `npm run check`.
- Run unit tests with `npm test`; use `npm run test:watch` for watch mode and
  `npm run test:coverage` for the baseline coverage ratchet.
- Run the broader readiness sweep with `npm run audit:campaign`; it chains type/contract checks,
  audit inventory, frontend API coverage, production dependency audit, unit tests, and build.
- Populate a dedicated synthetic report-audit company with `BASE_URL=... npm run
  e2e:report-fixture`; it writes ignored evidence to `tests/e2e/.artifacts/` and should not be
  pointed at real client books.
- Run the competitor-grade benchmark audit with `BASE_URL=http://localhost:5000 npm run
  e2e:benchmark-audit`; it uses the report fixture by default, refuses production writes unless
  `BENCHMARK_ALLOW_PROD_WRITES=true` is explicitly set, and writes review evidence under
  `docs/qa/<date>-benchmark-audit/`.
- Treat `BENCHMARK_RUN_FIXTURE=false` production runs as read-only deployment crawls only. They can
  verify Railway routes and report shells, but accountant-grade scorecard evidence needs local
  Postgres fixture probes from `scripts/qa/bootstrap-e2e.sh` plus `npm run e2e:benchmark-audit`.
  The bootstrap starts Docker Postgres by default, or uses `E2E_DATABASE_URL`/`DATABASE_URL` when
  pointed at an existing disposable Postgres database.
- Run `npm run e2e:benchmark-preflight -- <base-url>` before local synthetic benchmark work; it
  checks Docker or `E2E_DATABASE_URL`, production write guards, bootstrap shell prerequisites, and
  Chromium availability before the write fixture runs.
- Use `npm run e2e:benchmark-local` for the no-Docker full local benchmark path; it starts a
  disposable PGlite socket database, runs migrations, starts the app, runs the fixture-backed
  benchmark audit, and writes evidence to `docs/qa/<date>-benchmark-audit-local/` unless
  `BENCHMARK_OUTPUT_DIR` is set.
- For a focused API contract gate, run `npm run check:api-contract`; `npm run check` and
  `npm run audit:campaign` already include it.
- Use `npm run audit:api-coverage:strict` when frontend API-reference drift should fail the gate.
- Generate audit evidence with `npm run audit:matrix > docs/audit/audit-matrix.generated.md` and
  `npm run audit:inventory -- --markdown > docs/audit/audit-inventory.generated.md`.
- Lint with `npm run lint`; use `npm run lint:fix` only when you intend to modify files.
- Check formatting with `npm run format:check`; use `npm run format` only when you intend to
  modify files. `migrations/meta/` is generated Drizzle metadata and is ignored by Prettier.
- The full-tree Prettier baseline is not clean yet; for launch-hardening changes, prefer
  `npx prettier --check <changed-files>` plus `npx prettier --write <changed-files>` over
  repo-wide formatting unless a format-only cleanup is intentional.

## Database And Migrations

- Drizzle config reads `shared/schema.ts`, writes migrations to `migrations/`, and requires
  `DATABASE_URL`.
- Use `npm run db:generate`, `npm run db:migrate`, `npm run db:push`, and
  `npm run db:studio` for schema work.
- `AUTO_MIGRATE_ON_BOOT` defaults to `false`. Keep production migrations in the deploy/release
  phase with `npm run db:migrate`; boot-time migration is only for dev/test or single-instance
  setups.
- Before committing migration or auth/test-account changes, run `npm run check:migrations`. It
  blocks bcrypt hash literals and `INSERT INTO users` seed patterns outside the explicit allowlist.

## Testing And Runtime Notes

- Vitest uses `tests/setup.ts`, which sets `NODE_ENV=test`, `PORT=5001`, and a test
  `DATABASE_URL`.
- Vitest and ESLint intentionally exclude `.claude/` and `.claire/` worktrees. Do not use those as
  source-of-truth unless the task explicitly targets them.
- In development, `npm run dev` starts Express on `PORT` (default `5000`) and mounts
  Vite in middleware mode; there is no separate client dev script.
- For cookie/session-based state-changing API requests, fetch `/api/csrf-token` and send
  the returned value as `X-CSRF-Token`; Bearer-auth requests are CSRF-exempt.
- The Docker/Railway runtime expects a Node 20.19+ production build because the Vite/Rolldown
  toolchain requires at least Node 20.19. Keep the production Docker base on Debian slim/glibc
  rather than Alpine/musl for the Vite 8/Rolldown native bindings. `/health/live` is the cheap
  liveness probe; `/health` is DB-backed readiness/full health.
- After dependency changes, validate the Railway install path with
  `npx -p node@20.19.0 -p npm@10.8.2 -c "npm ci --omit=dev --ignore-scripts"` so npm 10
  lockfile/platform issues are caught before deployment.
- For a containerized local stack, `docker compose up --build` starts the app plus Postgres 16
  using `.env` and persists `pgdata`/`uploads` volumes.
- For authenticated endpoint smoke testing, run `bash tests/test-firm-endpoints.sh` with
  `TEST_BASE`, `TEST_EMAIL`, and `TEST_PASS` set explicitly. The script deliberately has no
  production URL or password defaults.
- For read-only production smoke testing, run
  `SMOKE_READ_ONLY=true SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod -- <url>`.
- Railway production deploys from `origin/main`; pushing only a feature/Codex branch will not update
  production until `main` is fast-forwarded or otherwise deployed, and `/api/version` reports the
  expected commit.
- For authenticated staging/firm smoke testing, run
  `SMOKE_BASE_URL=<url> SMOKE_EMAIL=<email> SMOKE_PASSWORD=<password> npm run smoke:prod`.
  Set `SMOKE_REQUIRE_OAUTH_CONFIG=true` when OAuth providers must be configured, and use
  `SMOKE_WORKSPACE_MUTATIONS=true` only on disposable staging targets because it writes VAT
  workpaper rows and refreshes growth-opportunity data.
- For authenticated read-only browser route crawl of a deployed target, run
  `SMOKE_BASE_URL=<url> SMOKE_EMAIL=<email> SMOKE_PASSWORD=<password> SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod:routes`.
  It logs in with the existing smoke user and crawls protected routes without creating accounting
  records. Use `AUTH_CRAWL_PROFILE=firm|customer|all` or `AUTH_CRAWL_ROUTES=/dashboard,/reports`
  to scope the route set.
- `npm run security:verify-prod` requires `DATABASE_URL`; Railway production uses a private
  `postgres.railway.internal` URL, so run this inside the Railway network or through Railway SSH
  after an SSH key is registered. Set `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true` after rotating
  production JWT secrets so the verification run records that acknowledgement.
- `npm run e2e` requires a running app plus `BASE_URL` and `DATABASE_URL`; it registers a
  fresh user, promotes it through Postgres, crawls workspace routes, and posts a balanced journal.
- `npm run e2e:customer` requires a running app and optional `BASE_URL`; it registers a fresh
  SaaS customer without Postgres role promotion, crawls public/launch-critical customer routes,
  reruns mobile checks for invoices, receipts, banking, reports, and VAT, exercises
  journal/invoice/bank-import flows, and verifies NR-only WhatsApp/document-chasing, firm, and
  admin surfaces stay blocked. Full mode refuses non-local `BASE_URL` unless
  `CUSTOMER_E2E_ALLOW_REMOTE_MUTATION=true` is set and either cleanup admin credentials are present
  or `CUSTOMER_E2E_ALLOW_REMOTE_WITHOUT_CLEANUP=true` is explicitly set for an already-disposable
  target. For remote cleanup, set `CUSTOMER_E2E_CLEANUP_ADMIN_EMAIL` and
  `CUSTOMER_E2E_CLEANUP_ADMIN_PASS`; add `CUSTOMER_E2E_CLEANUP_DELETE_USER=true` only when the
  generated user should be deleted too. The runner writes the created user/company IDs to
  `tests/e2e/.artifacts/customer-launch-last-run.json`.
- For read-only production/ad-route customer launch QA, run
  `BASE_URL=<url> npm run e2e:customer:public`; it crawls only public launch routes and does not
  register users or create accounting records. The crawl includes public ad, auth, and legal routes
  such as `/services`, `/register`, and `/privacy`, and fails rendered unsupported launch claims.
  If Playwright cannot find Chromium, install the project browser once with
  `npx playwright-core install chromium` or set `CHROMIUM_PATH` to an existing browser binary.
- Use `npx vitest run tests/unit/public-launch-surface.test.ts` after public marketing, SEO,
  trust, help, migration, or public-route changes to catch unsupported compliance/security claims.
- Use `npx vitest run tests/unit/command-palette-a11y.test.ts` after command palette dialog or
  shortcut shell changes.
- Keep the public sample-data demo workspace routed at `/demo`; after demo, onboarding, or
  claim-copy changes, include `tests/unit/public-launch-surface.test.ts` in the focused run.
- Use `npx vitest run tests/unit/vat201-export.test.ts` after VAT 201 export mapping or workbook
  copy changes.
- Use `npx vitest run tests/unit/bank-import-ux.test.ts` after bank statement import or
  reconciliation UX changes, especially sample CSV and duplicate-import messaging.
- Use `npx vitest run tests/unit/bank-statement-import.test.ts` after bank CSV parser/header
  detection changes, especially Arabic headers or amount-plus-Dr/Cr statement formats.
- Use `npx vitest run tests/unit/mobile-launch-ux.test.ts` after mobile layout changes on invoices,
  receipts, banking, VAT, or other launch-critical SaaS screens.
- Use `npx vitest run tests/unit/report-discovery.test.ts` after report tabs, report command
  palette shortcuts/direct delivery queue or retry actions, persona workspaces, report operations
  navigation, report decision-question metadata, decision shortcut paths, automation starter paths,
  report trigger-rule paths, persona report coverage, automation-signal persona scope, automation starter/rule/impact report coverage, role setup paths, report-suite delivery/trigger-rule links/readiness/queue actions, quick-access/saved-view/automation-impact
  profiles/surfaces/navigation/onboarding, delivery subscription paths/settings controls, suite-aware delivery previews/run-history
  timeline filters, delivery recovery summaries, persona command strips/pinned command preferences, workflow finder saved search/gap
  context/share links, command-palette suite queue actions/per-report automation actions, dashboard/command-palette/backend handoff acknowledgements, accountant handoff
  panels/workbook sheets/delivery previews, comparison presets/coverage, scheduled pack/delivery report coverage, report coverage maps, report pack
  templates/exports, or report deep-link behavior changes.
- Use `npx vitest run tests/unit/report-catalog-routes.test.ts` after the authenticated report
  catalog discovery API, typed client, contract guard,
  report-suite/quick-access/saved-view/automation-impact catalog payload, report-suite delivery or
  trigger-rule links, or persona catalog filtering changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts` after shared report launcher/picker
  changes, dashboard next-action ranking, queue/retry actions, delivery-run feedback, or
  dashboard/report-surface integrations that consume the catalog API.
- Use `npx vitest run tests/unit/report-export-helpers.test.ts` after report workbook sheets,
  persona pack workbook sheets, or export-helper mapping changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts tests/unit/report-catalog-routes.test.ts tests/unit/report-export-helpers.test.ts`
  after Cost Center P&L catalog status, profitability API, comparison metrics, report-pack, or
  delivery coverage changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts tests/unit/report-catalog-routes.test.ts tests/unit/report-delivery-routes.test.ts tests/unit/report-delivery-scheduler.test.ts tests/unit/report-export-helpers.test.ts`
  after cross-surface report catalog, API context, launcher/dashboard queue action, delivery
  handoff, scheduler handoff-skip, and workbook export changes land together.
- Use `npx vitest run tests/unit/report-delivery-routes.test.ts` after report delivery
  subscription service, route, persisted settings, persisted automation-command preferences, run
  history/snapshots, suite-aware notification queueing, or failure-retry API/scheduling-plan changes.
- Use `npx vitest run tests/unit/report-delivery-scheduler.test.ts` after report delivery cadence,
  due-scan, handoff-review skips, guardrail, failure recovery, scheduler telemetry, or scheduler
  cron changes.
- Use `npx vitest run tests/unit/whatsapp-boundary.test.ts` after WhatsApp-related changes. The
  WhatsApp surface is NR firm-management-only and must not appear in public or customer SaaS UI.
- Document chasing is also an NR firm-management-only feature. Keep its UI under
  `/firm/document-chasing` and verify with
  `npx vitest run tests/unit/document-chasing-boundary.test.ts` after related route/nav/API changes.
- `npm run test:coverage` is a baseline ratchet, not proof of broad route coverage; raise the
  thresholds as integration and route-level tests land.

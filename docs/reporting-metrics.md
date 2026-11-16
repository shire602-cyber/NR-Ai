# Reporting, metrics and domain-engine notes

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- `client/` contains the React/Vite frontend. Vite aliases `@` to `client/src`.
- `client/src/lib/reportCatalog.ts` is the shared source for Reports catalog/workspace metadata,
  automation playbooks, roadmap prerequisites/priorities, automation-health scoring/history, persona
  preference storage, role setup checklists, report-suite/quick-access/saved-view/automation-impact profiles, and
  command-palette report shortcuts; avoid duplicating report labels or deep links elsewhere.
  Every catalog report carries `dataBasis` (`ledger` | `documents` | `snapshot_proxy`) and every
  comparison metric resolves one through `reportComparisonMetricBasis`; the catalog API exposes
  `dataBasis`/`indicator`, `ledgerReportCount`/`indicatorReportCount` and preset `metricBases`, and
  the Report Center badges every non-ledger report or metric as "Indicator" (`DataBasisBadge`).
- The Reports page is a thin shell (`client/src/pages/Reports.tsx`, < 500 lines) over
  `client/src/pages/reports/`: `useReportsPage` (state; composes the ordered stage hooks in
  `hooks/`, comparison rows come from the pure `comparisons/buildComparisonRows`), `context.ts`,
  `shared.ts` (barrel over `model/` helpers/types), lazily loaded workspace panels in `panels/`
  (only the active workspace panel is mounted; large sections in `panels/sections/`) and
  focused-report tabs in `tabs/`. No module there exceeds 1,500 lines
  (`tests/unit/report-page-split.test.ts`). `server/routes/ai.routes.ts` and `firm.routes.ts` keep
  every registration (path, middleware order) and import handlers from `server/routes/ai/` and
  `server/routes/firm/` (`tests/unit/route-module-split.test.ts` pins the route tables). UI copy
  is in the `reportCenter` i18n namespace
  (`client/src/locales/{en,ar}/reportCenter.json`). The default Report Center leads with
  statements and tax (`StatementsQuickPanel`: server PDF/Excel, accountant pack, FTA Audit File);
  persona/automation/delivery tooling sits behind "Advanced tools" (the workspace tabs). The
  always-hidden discovery sections (quick access, saved views, workflow finder, catalog readiness,
  recommendations, report library/pins) were removed in W5-A because nothing rendered them.
- Server-rendered report outputs live in `server/services/report-render/` (W5-A): `statements.ts`
  builds a render model from `server/reporting` (P&L, balance sheet, trial balance, cash flow,
  general ledger, aged receivables/payables as of a date, statement of changes in equity, executive
  summary, VAT 201 summary), `pdf.ts` (PDFKit + `pdf-fonts`, Arabic-first for ar-locale
  companies) and `xlsx.ts` (exceljs, numeric cells, formula-injection guard) lay it out, and
  `pack.ts` builds delivery packs (ledger reports rendered; document/snapshot indicator reports
  listed on a Coverage sheet with an open-in-app link) and the accountant share-pack zip. Routes:
  `/api/companies/:companyId/reports/statements/:kind?format=pdf|xlsx|json`,
  `/reports/changes-in-equity`, `/reports/executive-summary`, `/reports/share-pack`, and
  `/reports/faf` (FTA Audit File, `server/services/faf-export.service.ts`, layout in
  `docs/faf-export.md`; generated for upload/inspection, never transmitted). The changes-in-equity
  closing column ties to the balance sheet by construction; verify with
  `tests/db/report-statements-render.test.ts` and `tests/db/faf-export.test.ts`.
- Keep each report quick-access profile covering every live report for that persona; Dashboard
  renders the first six as primary tiles plus overflow links for the rest. Onboarding
  completion should derive direct quick-access report buttons from the selected profile and open
  them with `reportPersonaHref`. Dashboard quick-access report cards should expose
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
  `readyReportCatalog` rather than trusting localStorage values. (Since W5-A no Reports UI renders
  pins — the report library was an always-hidden section — so a new consumer must render them.)
- Keep decision shortcuts as persona-scoped business-question entry points with stable IDs,
  question-copy ending in `?`, valid report coverage, a same-persona comparison preset, and a
  same-persona automation starter; Dashboard, Onboarding, Mobile Nav, Command Palette, workbook
  exports, and the catalog API consume them directly.
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
  report/automation actions, and command-palette report-open plus per-report
  automation/comparison/delivery/suite actions.
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
  Balance Sheet snapshots; `startDate` only affects `currentPeriodNetIncome`. Equity always carries
  capital + retained earnings brought forward + current-year earnings, so the snapshot balances for
  every range.
- Financial statements come from ONE implementation, the reporting kernel in `server/reporting/`
  (see its README): `/reports/pl`, `/reports/balance-sheet`, `/reports/trial-balance`,
  `/financial-statements/*`, the comparison endpoints, aging, cash flow, general ledger and
  corporate-tax calculate / pull-from-books all read it. Statements are correct by computation:
  retained earnings brought forward = income − expenses before the fiscal year containing the as-of
  date plus any 3020 balance; current-year earnings = fiscal-year-to-date P&L. Only posted entries
  count, and closing / year-end entries (`source = 'year_end_close'`, legacy `system` "Closing
  entries for …") are excluded from every statement, P&L, comparison and corporate-tax query. Monthly
  close posts nothing; locking is lock-through (soft or hard) and needs the checklist or an audited
  override. `/reports/pl` keeps `totalRevenue` = total income (revenue + other income) for existing
  metrics; the split (revenue vs other income such as 4090 FX gain, cost of sales, gross profit) is
  in `sections` and on the canonical `/reports/profit-loss`.
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
  baseline of zero. The report comes from `computeFxExposure` (`server/services/fx/exposure.ts`),
  the same function the period-end revaluation posts from: outstanding balances (total less
  payments dated on/before as-of) of posted foreign-currency invoices and vendor bills plus
  GL-linked foreign bank accounts, remeasured at the company's closing rate (spot fallback);
  drafts, voids, credit notes and unposted receipts are excluded. Do not treat it as a historical
  FX movement comparison until FX exposure snapshots are persisted.
- Exchange rates are tenant-scoped (`exchange_rates.company_id`, NULL = admin-only system row).
  A row (X, Y, r) means 1 X = r Y; company rates are stored as (foreign, base). Resolve rates with
  the `fx.getRate` / `fx.convert` services (`server/services/fx/README.md`) and a `companyId`;
  the legacy `getLatestRate` helper reads system rows only.
- Consolidated revenue/expenses/profit/margin (`consolidated-revenue`,
  `consolidated-expenses`, `consolidated-net-profit`, and `consolidated-margin`) read the server
  management consolidation from `GET /api/company-groups/:groupId/consolidated-statements`
  (`server/services/consolidation`) for the comparison current and previous ranges when the caller
  has a company group: member statements come from `server/reporting` with closing entries
  excluded, FX translation uses closing/average/historical rates with CTA in equity, NCI is split
  out, and intercompany eliminations (rule maps plus manual group-level elimination journals) are
  applied; unmatched differences are reported as warnings. The Reports close card is then titled
  "Management consolidation" and the per-entity rows below it are labelled as before
  eliminations (`client/src/pages/reports/GroupConsolidation.tsx`, `useReportsPage.tsx`).
  Only when no group exists, or the endpoint fails, do these metrics fall back to the client
  accessible-company roll-up (loaded entities only, no eliminations) labelled "Roll-up" and
  "Combined view (unconsolidated, no eliminations)", with a link to `/company-groups`.
  Consolidated margin is net profit divided by revenue for the same source. Treat all of these as
  management consolidation, not statutory IFRS 10 consolidation; corporate tax stays per entity.
- Consolidation review items (`consolidation-review-items`) uses the current consolidated
  statements review count, including failed entities, unbalanced entities, multi-currency entities,
  and single-entity roll-up prompts, plus server consolidation warnings when a group is
  consolidated, against a clear baseline of zero. Treat it as a current pack readiness queue, not a
  historical consolidation trend, until consolidation review snapshots are persisted (consolidation
  runs record audited snapshots but are not yet read back as history).
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
  or historical cash position comparison. The Dashboard `monthlyBurnRate`/`cashRunway` (months) come
  from `getDashboardStats` in `server/services/dashboard-stats.service.ts`: average expenses of the
  last three completed UAE months from the posted ledger, divided into the GL cash/bank balance.
- Dashboard stats (`GET /api/companies/:companyId/dashboard/stats`) are SQL-aggregated through
  `server/reporting` and `agedReceivables`/`agedPayables`; never load all journal lines into Node.
  `revenue`/`expenses`/`netProfit` are scoped to the selected period (`preset=month|quarter|ytd|custom`,
  default this month) with `prior` and `priorYear` comparison blocks; `outstanding` is the remaining
  balance of sent/partial invoices (total less payments) and equals the GL receivable; AR aging has a
  `current` bucket by due date and AP aging uses approved vendor bills. Cash is cash/bank accounts
  only. VAT and corporate-tax widgets are ledger-based (`vat`, `corporateTax`; the CT figure is
  `computeCtLiability` over fiscal-year-to-date ledger P&L, an estimate and not a filed return).
  Dashboard UI modules live in `client/src/pages/dashboard/`; tiles must keep their `links`.
- Cash forecast (`server/services/cashflow-forecast.service.ts`) is document driven: opening cash is
  the kernel cash/bank balance, inflows are remaining balances of sent/partial invoices on their due
  date (overdue on an assumed recovery date), outflows are approved vendor bills on their due date
  plus payroll, VAT/CT due dates (`compliance_calendar`, else latest draft VAT return) and manual
  `cash_forecast_items` (loan repayments, one-offs). It never extrapolates historical averages: with
  no dated items it returns `insufficientData: true` and an "Insufficient data" insight.
- Cash forecast risk metrics (`projected-cash-shortfall`, `cash-risk-week-count`) use the current
  90-day cash forecast projections only (the document-driven forecast above). They compare projected
  negative-cash exposure against a zero-risk baseline, not against a historical forecast snapshot or
  bank-balance ledger proof.
- Tax funding metrics (`tax-reserve-coverage`, `tax-funding-gap`,
  `tax-adjusted-runway-days`) compare current positive cash forecast balance against current VAT
  plus corporate-tax exposure; tax-adjusted runway reuses the current burn-rate proxy after
  reserving cash for positive tax exposure. They are cash-readiness proxies, not filed
  liability/payment status, deadline proximity, historical reserve trend, or restricted
  reserve-account proof.
- Budget actual variance (`budget-actual-variance`) compares selected-budget actual totals against
  selected-budget totals from `/api/budget-plans/:id/variance`; the baseline is Budget, not the
  previous period. Actuals come from the posted ledger (closing entries excluded) keyed by
  year-month, a plan spans at most 12 months, and `variance`/`favourable` are signed by account type
  (income above budget and expense below budget are favourable; `variance` positive = favourable).
  Approved plans are frozen (lines 409 `BUDGET_FROZEN`; use `/new-version`), approval needs
  `documents.approve` from a different user than the creator, and
  `/api/analytics/budget-vs-actual` reads the approved plan. Do not treat it as historical
  budget-trend analysis until period-specific budget history exists.
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
  `/api/reports/:companyId/cash-flow/quarter` (the endpoint also accepts `from`/`to` now; the
  canonical statement with opening/closing cash is `/api/companies/:id/reports/cash-flow`).
- VAT 201 figures come from ONE engine, `computeVat201` in `server/tax/vat-engine.ts` (W4-E):
  `vat-returns/generate`, VAT autopilot, `/reports/vat-return`, `/reports/vat-summary` (from/to or
  startDate/endDate) and the firm workpaper books pull all call it. Boxes are integer fils per
  document (classifySupply on `invoice_lines.net_amount` / `vat_supply_type`; Box 1a-1g by the
  invoice's place-of-supply emirate, missing emirate is 422 `EMIRATE_MISSING`, never a default);
  bills (reverse charge, imports Box 6, partial recovery), vendor debit notes, posted receipts
  (blocked input VAT via `receipt_vat_treatments`), bad-debt relief, return adjustments (Box 2,
  Box 7, corrections) and manual VAT journal lines (adjustment columns) are included; out-of-scope
  is in no box. Returns cover exactly one stagger period (422 `PERIOD_NOT_ALIGNED`) and carry a
  VAT-to-GL reconciliation (`server/tax/vat-reconciliation.ts`); "ready"/submit is 409
  `VAT_RECONCILIATION_DIFFERENCE` on an unexplained difference unless an audited override reason is
  given. `vat-due` reads the engine-backed vat-summary. Nothing is transmitted to the FTA. Firm VAT
  workpapers run draft -> prepared -> reviewed -> filed -> locked with preparer != reviewer.
  Fixed-asset disposals (journal source `fixed_asset`, `fixed_assets.disposal_vat_treatment`) are
  supplies: standard-rated in the company emirate's Box 1, zero-rated Box 4, exempt Box 5, and
  reconcile under `fixed_asset_disposals` (never as a manual adjustment).
  Verify with `tests/db/vat-engine.test.ts` and `tests/db/vat-firm-workpaper.test.ts`.
- Corporate tax (W4-A) lives in `server/services/corporate-tax/` (engine, repository, deadlines,
  lifecycle). Returns run draft -> computed -> reviewed -> filed -> paid (amend copies into a new
  draft; filed/paid/amended/void are immutable 409; reviewer != preparer; filing may post the CT
  provision through `server/ledger`). Deadlines are period end + 9 months with month-end clamping;
  rules are documented in `docs/corporate-tax-rules.md` (QFZP, interest limitation, TP flags need
  adviser review). The compliance calendar is generated by
  `server/services/compliance-obligations.service.ts` (job `compliance.deadlineScan`, no ESR) and
  feeds the Task Centre. Nothing is transmitted to EmaraTax. Verify with
  `tests/db/corporate-tax-lifecycle.test.ts` and `tests/db/compliance-calendar.test.ts`.
- Inventory and COGS (W4-B) live in `server/services/inventory/` (weighted average default or FIFO
  layers in `costing.ts`); every stock change posts through `server/ledger` in the document's own
  transaction: bill approval Dr 1070, invoice issue stock out + COGS (`invoice_cogs`), void/credit
  mirror, PO receipt via `inventory.onGoodsReceived` into GRNI 2015. Other modules call it only
  through the service registry (`inventory.on*`); do not reintroduce storage-level stock writes.
  Fixed assets are in `server/services/fixed-assets/` (source `fixed_asset`, one `isCapitalised`
  guard). Verify with `tests/db/inventory-ledger.test.ts`, `tests/db/fixed-assets-register.test.ts`
  and `tests/db/cost-centers-pnl.test.ts`.
- E-invoicing (W4-C): PINT AE UBL is generated and validated in three layers (UBL 2.1 XSD, the
  OpenPeppol PINT AE 2026.5 schematron SEF, `server/services/einvoice/pint-ae-rules.ts`). The
  vendored artefacts and their NOTICE live in `server/assets/einvoice/` (shipped in the Docker image
  with `server/assets`; override with `EINVOICE_ARTEFACTS_DIR`; startup logs when missing); test
  fixtures and ASP recordings stay in `tests/fixtures/pint-ae/`. Transmission stops at the ASP
  boundary (`server/services/einvoice-provider-http.ts`, mapping file + recorded contract tests):
  no contracted ASP means 503 `EINVOICE_PROVIDER_NOT_CONFIGURED`, and ZATCA is 503
  `ZATCA_NOT_CONFIGURED` without `ZATCA_ENV`. UAE debit notes are type 380 with a BillingReference
  to the original (PINT AE rejects 383); 383 is used only on the ZATCA path. Run
  `node scripts/validate-ubl.mjs --fixtures` and `npx vitest run tests/unit/einvoice-pint-ae.test.ts`
  after UBL changes.
- E-invoicing through A-Cube (E1, MoF accreditation 188961; `EINVOICE_PROVIDER=acube`,
  `server/services/einvoice/providers/acube.ts`, full notes in
  [einvoicing-acube.md](einvoicing-acube.md)): every invoice carries two tracks on
  `einvoice_documents` (delivery: draft/validated/queued/sending/delivered/delivery_failed/rejected;
  FTA reporting: not_required/pending/reported/report_failed, reported = TDD present) with history in
  `einvoice_document_events`; the legacy `einvoice_status` is derived (`tracks.ts`). Sending needs an
  active `einvoice_legal_entities` row (409 `EINVOICE_LEGAL_ENTITY_NOT_ACTIVE` / `_DELINKED`) and the
  supplier endpoint `0235:<linked TIN>` (422 `EINVOICE_SUPPLIER_ENDPOINT_MISMATCH`); submissions are
  claimed (`submit_claimed_at`) so they are never sent twice, and an ambiguous transport failure is
  looked up before re-posting. Webhooks (`/api/webhooks/einvoice/acube/:environment`, Ed25519 HTTP
  Message Signatures + optional token) are stored in `einvoice_provider_events` and processed by the
  `einvoice.providerEvents` job; `einvoice.acubePoll` is the fallback. Contract fixtures in
  `tests/fixtures/pint-ae/asp/acube/` are doc-derived and must be re-recorded in sandbox. Verify with
  `tests/db/einvoice-acube.test.ts` and `tests/unit/einvoice-acube-*.test.ts`.
- Customer communications (W4-D): every email goes through the durable outbox in `server/outbox/`
  (job `email.outboxDelivery`; with no provider rows stay `blocked_no_provider`, never "sent");
  bounces arrive on `/api/webhooks/email-events/*`. Portal access is bound to one contact via
  hashed, revocable 90-day tokens (`server/services/portal-access.service.ts`); drafts are never
  shared. Online invoice payment goes through `server/services/payments/` (Stripe adapter;
  Telr/N-Genius report `requires_external`); payment webhooks are `/api/webhooks/invoice-payments/*`.
  Notifications run on domain events plus `notifications.overdueScan` / `notifications.dailyDigest`.
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
- Report delivery really delivers (W5-A, R12-01): queue/retry/scheduler create a run, then
  `executeReportDeliveryRun` (`server/services/report-render/delivery.ts`) renders the PDF + XLSX
  pack, stores it on `company_report_delivery_artifacts`, and sends one outbox email per recipient
  with both attachments. Run status is truthful: `queued` -> `rendering` -> `sent`, or `failed`
  (reason; `retry_scheduled_at` from the outbox backoff), or `blocked` (`no_email_provider` |
  `no_recipients`); a
  failed run whose outbox messages later send is reconciled to `sent` on read, and a manual retry
  cancels the old run's pending outbox rows. Recipients are the emails in the recipients setting,
  else company members whose role matches the persona. The in-app notification only reports the
  outcome. Channel labels come from `resolveReportDeliveryChannel`: email with PDF and Excel, plus a
  Google Sheets copy only while the `google_sheets` capability is live; a Sheets channel setting is
  422 `GOOGLE_SHEETS_NOT_CONFIGURED` otherwise. Delivery log files:
  `/api/companies/:companyId/report-delivery/runs/:runId/artifacts[/:artifactId]`; channels:
  `/report-delivery/channels`. Verify with `tests/db/report-delivery-outbox.test.ts`.

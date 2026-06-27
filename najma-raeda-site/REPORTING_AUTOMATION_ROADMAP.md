# Reporting and Automation Roadmap

Date: 2026-06-15

## Goal

Make NR-Ai feel like a serious QuickBooks/Wafeq-level finance platform: broad
financial reporting, easy access from anywhere in the product, and automation
that reduces the work needed from solo entrepreneurs, freelancers, and
accountants.

The product target is 20+ high-level accounting and business reports with
comparisons, drill-downs, exports, and automated report packs.

## Evidence From The Current App

Current visible report surfaces:

- `client/src/pages/Reports.tsx`: Profit & Loss, Balance Sheet, VAT Summary,
  Excel export, Google Sheets export, date filtering.
- `client/src/pages/AdvancedReports.tsx`: Cash Flow, Aging Report, Period
  Comparison, charts, period selector, basic PDF export.
- `client/src/components/layout/AppSidebar.tsx`: Reports group already includes
  reports, VAT filing, VAT autopilot, corporate tax, budgets, and cash flow
  forecast.

Current server report APIs:

- `server/routes/dashboard.routes.ts`: P&L, Balance Sheet, VAT Summary.
- `server/routes/reports.routes.ts`: Cash Flow, Aging, Trial Balance, VAT
  Return, Period Comparison.
- `server/routes/exchange-rates.routes.ts`: FX gains/losses report.
- `server/routes/bill-pay.routes.ts`: AP aging data for bills.
- `server/routes/analytics.routes.ts` and `server/routes/cashflow.routes.ts`:
  cash forecast and trend data.

Current automation foundation:

- Receipt autopilot and OCR: `server/services/receipt-autopilot.service.ts`.
- VAT autopilot: `server/services/vat-autopilot.service.ts`.
- Auto-reconcile: `server/services/auto-reconcile.service.ts`.
- Cash flow forecast: `server/services/cashflow-forecast.service.ts`.
- Anomaly detection: `server/services/anomaly-detection.service.ts`.
- Payment chasing: `server/services/payment-chasing.service.ts`.
- Document chasing: `server/services/document-chasing.service.ts`.
- Month-end close: `server/services/month-end.service.ts`.
- Autonomous GL: `server/services/autonomous-gl.service.ts`.
- Firm command center: `server/services/firm-command-center.service.ts`.

External benchmark checked:

- QuickBooks financial reporting page, checked 2026-06-15:
  `https://quickbooks.intuit.com/accounting/reporting/`
- Wafeq homepage, checked 2026-06-15:
  `https://www.wafeq.com/en/`

Benchmark takeaways:

- QuickBooks positions reporting by maturity: basic reports, enhanced A/R and
  A/P reports, comprehensive inventory/sales/profitability reports, custom KPIs,
  dashboards, workflow automation, and cash/profit forecasting.
- Wafeq advertises invoices, purchase orders, inventory, payroll, tax
  compliance, consolidated reporting, project/cost center profitability, cash
  forecasts, inventory movements, VAT, corporate tax, and over 40 financial
  reports.
- NR-Ai should not only match report breadth. The differentiator should be that
  reports trigger automation: chase payments, request documents, resolve
  anomalies, forecast cash, prepare VAT/corporate tax, and close the month.

## Report Catalog Target

Tier 1 should make the product feel complete for most businesses:

1. Profit & Loss
2. Balance Sheet
3. Cash Flow Statement
4. Trial Balance
5. General Ledger
6. Account Transactions / Account Ledger
7. VAT Summary
8. VAT Return
9. Corporate Tax Estimate
10. A/R Aging
11. A/P Aging
12. Customer Balance Summary
13. Vendor Balance Summary
14. Invoice Status and Collections
15. Period Comparison
16. Budget vs Actual
17. Cash Flow Forecast
18. Revenue by Customer
19. Sales by Product or Service
20. Expenses by Vendor
21. Expenses by Category
22. FX Gains and Losses
23. Inventory Valuation
24. Inventory Movement
25. Fixed Asset Register
26. Depreciation Schedule
27. Payroll Summary
28. WPS / SIF Payroll Export Summary
29. Expense Claims and Reimbursements
30. Month-End Close Status
31. Audit Trail / Activity Report
32. Consolidated Financial Statements

Tier 2 should add stronger management reporting:

- Profitability by project, branch, class, location, or cost center.
- Cost Center P&L / departmental profitability. Current status: live connected
  report through `/cost-centers`, with workbook data from
  `/api/companies/:companyId/cost-centers/profitability` and current-vs-prior
  net-income/expense comparison metrics.
- Persona decision shortcuts now include owner automation readiness, freelancer
  monthly tax readiness, and accountant pack-send readiness prompts, giving each
  role one more business-question entry point into reports, comparisons, and
  automation starters.
- Product-depth coverage is now a catalog-backed Reports/API surface across
  five headers: discovery, role workflows, report automation,
  advisory/management, and accounting/data depth. Each subgoal links to concrete
  reports/workflows, while statutory consolidation, COGS margin, historical
  snapshots, tax payment status, WPS settlement, and deduplicated payroll
  headcount remain explicit data-dependency work rather than implied completion.
- Report discovery now includes persona-scoped report favorites/pins in the
  Reports library, persisted through sanitized catalog helpers so pinned reports
  appear first without duplicating report metadata or trusting stale local
  storage IDs.
- Source transaction discovery now exposes persona-scoped drilldown targets for
  journal lines, invoice documents, expense receipts, and audit activity, with
  each target linking to a concrete app route while universal row-level deep
  links remain dependent on stable source entity IDs.
- Role workflows now have catalog-backed operating checklists for owner,
  freelancer, and accountant routines. Each step links the relevant reports,
  comparison preset, automation starter, delivery subscription, decision
  shortcut, saved view, and report suite, and the Reports page/API expose those
  step anchors for recurring role-specific work.
- Role workflow steps now also surface their default saved view, handoff
  recipients, and delivery guardrail directly in the Reports checklist and
  catalog API, making role defaults and blocked-send behavior visible before
  queueing.
- Report automation now exposes derived runbook phases for every workspace
  playbook: detect the report signal, review the linked role workflow, and open
  the guarded delivery path. The Reports page and catalog API use the same
  runbook helper so automation cards show how a signal becomes review and
  delivery without duplicating catalog relationships.
- Automation impact profiles now show outcome signals for payments, documents,
  posting, close exceptions, anomaly review, and client pack delivery as
  proxy-vs-missing-counter rows, keeping estimated impact separate from
  persisted outcome facts.
- Management pack briefs now cover owner, freelancer, and accountant modes with
  catalog-backed narrative sections, KPI metric sets/widgets, dimensional
  lenses, report suite/pack/comparison/delivery links, and an accountant
  batch-ready advisory path that still waits on multi-client queue selection.
- Accounting/data-depth gaps now expose structured evidence checkpoints for
  current proxy signals, missing source records, and guardrail language across
  historical snapshots, statutory consolidation, COGS allocation, and
  tax/WPS/payroll settlement depth, plus required source-record lists that name
  the records needed to unlock each stronger accounting claim.
- Revenue by Customer and Sales by Product/Service now feed current-vs-prior
  concentration comparisons through top customer share and top product/service
  share, so owner/freelancer/accountant packs can flag concentration movement.
- DSO/DPO proxy metrics are now visible in current-vs-prior comparisons through
  collection days and payable days, using current invoice/vendor-bill statuses
  grouped by document date until historical as-of balances exist.
- Cash conversion gap is now visible as collection-days less payable-days, giving
  cash/collections packs one operating-cycle pressure metric while inventory-day
  coverage remains future work.
- Collections effectiveness is now visible as a paid-invoice-share comparison
  using current invoice statuses grouped by document date until paid-amount
  history exists.
- Invoice count is now visible in current-vs-prior comparisons from active
  non-void/non-cancelled invoice documents, giving sales and collections packs
  a volume/workload signal alongside invoice value and average invoice value.
- Open invoice count is now visible from the same unpaid, non-draft invoice rows
  as open receivables, giving collections packs workload volume beside open
  receivable value.
- Average open invoice value is now visible as open receivable value divided by
  open invoice count, giving collections queues an unpaid invoice size signal.
- Open invoice value share is now visible as open receivable value divided by
  revenue invoice value, giving collections automation a value-weighted unpaid
  mix signal beside open invoice share.
- Due-soon invoice count and value are now visible for open invoices due in the
  seven days after the comparison period end, giving collections automation a
  next-action queue before invoices become overdue.
- Average due-soon invoice value is now visible as due-soon invoice value
  divided by due-soon invoice count, giving collections queues a next-7-day
  invoice size signal.
- Due-soon invoice share is now visible as due-soon invoice count divided by
  open invoice count, giving collections automation a next-7-day workload mix
  signal beside open invoice share.
- Open invoice share is now visible as open invoice count divided by non-draft
  active invoice count, giving collections packs a count-based workload mix
  beside value-weighted paid-invoice share.
- Average overdue invoice value is now visible as overdue receivable value
  divided by overdue invoice count, giving collections queues a late-item size
  signal.
- Average overdue invoice days is now visible as whole days from invoice due
  date to the comparison period end, giving collections queues a practical
  aging signal for escalation automation.
- Overdue invoice share is now visible as overdue invoice count divided by open
  invoice count, giving collections packs count-based overdue workload mix
  beside value-weighted overdue receivable share.
- Receipt count is now visible in current-vs-prior comparisons from receipt
  rows by receipt date, giving expense and automation packs a workload signal
  beside expense spend and unposted receipt count.
- Average receipt value is now visible from receipt subtotal plus VAT divided
  by receipt rows, helping users separate higher expense spend from a larger
  receipt workload.
- Overdue receivables are now visible in current-vs-prior comparisons from
  unpaid non-draft invoices due by each comparison period end, giving cash and
  collections packs a direct A/R-at-risk signal.
- Overdue payables are now visible in current-vs-prior comparisons from unpaid
  bills due by each comparison period end, giving operations and advisory packs
  a direct A/P-at-risk signal.
- Overdue receivable and payable share are now visible as overdue balance
  divided by open balance for the same comparison window, giving cash,
  collections, payables, and advisory packs high-level overdue-mix signals.
- Open cash gap is now visible as open payable value less open receivable
  value, giving owners and advisors a broad unpaid A/P-vs-A/R pressure signal
  before narrowing into due-soon or overdue queues.
- Open cash coverage is now visible as open receivable value divided by open
  payable value, giving owners and advisors a broad unpaid A/R-vs-A/P coverage
  ratio beside the open cash gap.
- Open workload gap is now visible as open bill count minus open invoice count,
  giving automation queues a count-based view of whether unpaid work is heavier
  on bill-pay routing or collections follow-up.
- Overdue cash gap is now visible as overdue payable value less overdue
  receivable value, giving owners and advisors a net overdue pressure signal
  for collections-vs-payment triage.
- Overdue cash coverage is now visible as overdue receivable value divided by
  overdue payable value, giving owners and advisors an overdue A/R-vs-A/P
  coverage ratio beside the overdue cash gap.
- Overdue workload gap is now visible as overdue bill count minus overdue
  invoice count, giving automation queues a count-balance view of whether
  late-work follow-up is heavier on vendor bills or customer collections.
- Overdue invoice and bill counts are now visible beside overdue values and
  shares, giving collections, bill-pay, and advisory packs clear follow-up
  workload signals for automation queues.
- Overdue bill share is now visible as overdue bills divided by open bills,
  giving payables packs a count-based overdue workload mix separate from
  value-weighted overdue payable share.
- Average overdue bill value is now visible as overdue payable value divided by
  overdue bill count, giving bill-pay queues a late-item size signal.
- Average overdue bill days is now visible as whole days from bill due date to
  the comparison period end, giving payables queues a practical aging signal
  for payment-priority automation.
- Open bill count is now visible beside open payable value, giving payables
  packs a full unpaid bill workload signal before the queue becomes overdue.
- Average open bill value is now visible as open payable value divided by open
  bill count, giving bill-pay queues an unpaid bill size signal.
- Open bill value share is now visible as open payable value divided by vendor
  bill value, giving bill-pay automation a value-weighted unpaid mix signal
  beside open bill share.
- Due-soon bill count and value are now visible for open bills due in the seven
  days after the comparison period end, giving payment-priority automation a
  next-action queue before bills become overdue.
- Average due-soon bill value is now visible as due-soon bill value divided by
  due-soon bill count, giving bill-pay queues a next-7-day bill size signal.
- Due-soon bill share is now visible as due-soon bill count divided by open
  bill count, giving payment-priority automation a next-7-day workload mix
  signal beside open bill share.
- Due-soon cash gap is now visible as due-soon bill value less due-soon invoice
  value, giving owners and advisors a net 7-day pressure signal before deciding
  which collections or payments to automate first.
- Due-soon cash coverage is now visible as due-soon invoice value divided by
  due-soon bill value, giving owners and advisors a next-7-day coverage ratio
  beside the net due-soon cash gap.
- Due-soon workload gap is now visible as due-soon bill count minus due-soon
  invoice count, giving automation queues a seven-day count-balance signal
  beside the due-soon cash gap.
- Open bill share is now visible as open bills divided by active vendor bill
  documents in the comparison window, giving payables packs a count-based
  unpaid workload mix beside value-weighted payables.
- Vendor bill value and average bill value are now visible in current-vs-prior
  comparisons from non-void/non-cancelled vendor bills by bill date, giving
  owner, freelancer, and accountant payables packs supplier-spend movement
  without treating bill documents as cash payments or P&L expense recognition.
- Vendor bill count is now visible beside vendor bill value and average bill
  value, giving payables packs a supplier workload/volume signal for automation
  routing.
- Top vendor share is now visible from the same vendor bill document set,
  grouping bill value by vendor name to flag supplier concentration in
  payables/spend packs while procurement-contract concentration and
  supplier-master analytics remain future work.
- Paid bill share is now visible as current paid amount capped to vendor bill
  value divided by vendor bill value, giving payables packs a payment-coverage
  signal while historical payment timing and cash-disbursement analytics remain
  future work.
- Average invoice value is now visible in current-vs-prior comparisons from
  non-draft invoice rows, giving sales/client-income packs a deal-size signal.
- Cash runway and burn-rate proxies are now visible in current-vs-prior
  comparisons through monthly burn rate and 90-day runway coverage, using P&L
  movement plus the current cash forecast balance.
- Projected cash shortfall and cash risk week count are now visible from the
  current 90-day cash forecast projections, giving cash/runway packs a direct
  negative-cash alert signal while historical forecast snapshots remain future
  work.
- Operating cash-flow movement is now visible from the latest two quarterly
  cash-flow statement buckets, giving profit/cash/runway packs a direct cash
  movement signal while arbitrary cash-flow date ranges remain future work.
- Budget actual variance is now visible as Actual vs Budget from the selected
  Budget vs Actual plan, giving planning and advisory packs a direct budget
  guardrail signal while historical budget-trend comparisons remain future
  work.
- Corporate tax payable is now visible in current-vs-prior comparisons through
  the Corporate Tax calculator endpoint, paired with VAT due in tax-exposure
  presets.
- Total tax exposure is now visible as VAT due plus corporate tax payable,
  giving tax and close packs one combined tax cash-flow signal while filed
  liability and payment-status tracking remain future work.
- Tax exposure rate is now visible as total tax exposure divided by P&L
  revenue, giving owner, freelancer, and accountant tax packs a normalized tax
  pressure signal while statutory effective-tax-rate analysis remains future
  work.
- Tax reserve coverage, tax funding gap, and tax-adjusted runway are now
  visible by comparing current positive cash forecast balance against VAT plus
  corporate-tax exposure, giving tax packs a cash-readiness signal while actual
  payment status, deadline proximity, and historical reserve trends remain
  future work.
- Net margin is now visible in current-vs-prior comparisons from P&L net profit
  divided by total revenue.
- Expense ratio is now visible in current-vs-prior comparisons from P&L total
  expenses divided by total revenue, giving owner/freelancer/accountant packs a
  simple cost-efficiency signal.
- Revenue expense coverage and break-even gap are now visible from P&L totals,
  giving owner, freelancer, and accountant packs a clear break-even health
  signal while product/customer gross margin remains future work until COGS
  allocation exists.
- Expense claim review value is now visible from submitted and approved claims,
  giving operations, freelancer close, and accountant review packs a claims
  approval/reimbursement queue signal.
- Expense claim review count is now visible beside review value, giving owner,
  freelancer, and accountant packs a concrete claims-review workload signal for
  approval automation queues.
- Submitted expense claim count is now visible as the submitted-status subset,
  giving owner, freelancer, and accountant packs a direct approval backlog
  signal separate from approved reimbursement follow-up.
- Submitted expense claim value is now visible beside that submitted-status
  count, giving approval queues an AED priority signal before claims move to
  reimbursement follow-up.
- Approved expense claim count is now visible as the approved-status subset,
  giving owner, freelancer, and accountant packs a direct reimbursement
  follow-up signal separate from submitted approval work.
- Approved expense claim value is now visible beside that approved-status
  count, giving reimbursement follow-up queues an AED priority signal.
- Payroll expense share is now visible in current-vs-prior comparisons from
  payroll-run net totals divided by P&L total expenses, giving owner/accountant
  operations packs a payroll-burden signal.
- Payroll run count is now visible from payroll-run rows in the comparison
  range, giving owner/accountant operations packs a payroll workload signal
  beside payroll cost and readiness.
- Payroll deduction share is now visible as total deductions divided by basic
  pay plus allowances, giving owner/accountant payroll packs a gross-to-net mix
  signal for variance review.
- Average payroll run value is now visible as payroll-run net totals divided by
  payroll-run count, giving owner/accountant operations packs a normalized run
  size signal beside total payroll cost.
- Payroll covered employees is now visible from payroll-run `employee_count`
  totals in the comparison range, giving owner/accountant operations packs a
  payroll coverage signal while deduplicated HR headcount remains future work.
- Payroll cost per covered employee is now visible as payroll-run net totals
  divided by summed covered employees, giving owner/accountant operations packs
  a normalized payroll unit-cost signal.
- Payroll approval queue count is now visible from calculated payroll runs
  awaiting approval, giving owner/accountant operations packs the approval
  backlog separately from WPS file generation.
- Payroll approval queue value is now visible from those calculated payroll
  runs, giving payroll approval automation an AED priority signal beside the
  approval backlog count.
- Payroll readiness queue count is now visible from calculated runs awaiting
  approval plus calculated/approved runs missing SIF generation, giving
  owner/accountant operations packs a direct payroll automation task count while
  bank submission and settlement tracking remain future work.
- Payroll readiness queue value is now visible as payroll approval queue value
  plus WPS missing run value, giving payroll automation a task-value proxy
  beside the readiness task count.
- WPS missing run count is now visible for calculated/approved payroll runs
  missing SIF content, giving owner/accountant payroll automation packs a direct
  file-generation backlog signal.
- WPS missing run value is now visible for the same calculated/approved payroll
  runs missing SIF content, giving payroll automation an AED priority signal
  beside the file-generation backlog count.
- WPS ready share is now visible from eligible payroll runs with generated SIF
  files, giving owner and accountant payroll packs a payroll-file readiness
  signal while bank submission and settlement tracking remain future work.
- Inventory review items and value are now visible as current
  inventory-valuation queue signals for low-stock, negative-stock, and
  missing-cost products, giving owner/accountant operations packs both a
  stock-review count and absolute current stock value while historical
  inventory snapshots remain future work.
- Inventory review share is now visible as review products divided by active
  products, giving stock automation a normalized review-mix signal beside the
  raw review queue count.
- Fixed asset review items and value are now visible as current fixed-asset
  register queue signals for capitalization and depreciation setup review,
  giving asset and close packs both an asset-readiness count and net-book-value
  prioritization signal while historical asset queue comparisons remain future
  work.
- Fixed asset review share is now visible as review assets divided by active
  assets, giving asset and close automation a normalized readiness-mix signal
  beside the raw review queue count.
- Depreciation review items are now visible from current depreciation schedule
  review rows, giving freelancer/accountant tax-close packs a setup queue
  before depreciation suggestions are posted.
- Depreciation review value is now visible as remaining depreciable value for
  depreciation schedule review rows, giving tax-close automation an AED
  priority signal beside the setup queue.
- Depreciation ready items are now visible from ready-to-post depreciation
  schedule rows, giving tax-close automation a concrete posting queue count
  beside the review queue.
- Depreciation ready share is now visible as ready-to-post depreciation rows
  divided by ready-to-post plus review rows, giving tax-close automation a
  percent readiness signal beside the setup queue.
- Month-end open checks are now visible as a current close-checklist queue
  count for accountant close packs, giving reviewers a direct close-blocker
  signal while historical close trend snapshots remain future work.
- Month-end readiness is now visible as completed checklist items divided by
  total checklist items, giving accountant close packs a percentage status
  alongside the open-check queue while historical close trend snapshots remain
  future work.
- Audit high-risk event count is now visible in current-vs-prior comparisons
  from activity-log rows classified by the existing high-risk keyword matcher,
  giving accountant close packs a reviewer triage signal while formal audit
  risk modeling and prior-period-change detection remain future work.
- Audit high-risk event share is now visible as high-risk activity divided by
  total activity-log rows in each comparison period, giving accountant close
  packs a risk-mix signal when total audit activity volume changes.
- Audit review event count is now visible as Medium-or-High activity-log rows
  in each comparison period, giving accountant close automation a broader
  reviewer-workload signal beside the high-risk subset.
- Audit review event share is now visible as Medium-or-High activity divided
  by total activity-log rows, giving accountant close packs a workload-mix
  signal when total audit activity changes.
- FX unrealized exposure is now visible from the current FX gains/losses report
  as absolute unrealized gains plus absolute unrealized losses against a clear
  baseline, giving accountant close packs a currency-exposure review signal
  while historical FX exposure snapshots remain future work.
- Consolidated revenue and consolidated expenses are now visible beside
  consolidated net profit from the accessible-company roll-up, giving
  accountant close packs group-level P&L movement while eliminations,
  ownership rules, and FX translation remain future work.
- Consolidated margin is now visible as consolidated net profit divided by
  consolidated revenue from the same accessible-company roll-up, giving
  accountant close packs a group profitability ratio while statutory
  consolidation remains future work.
- Consolidation review items are now visible from the current consolidated
  statements report as failed entities, unbalanced entities, multi-currency
  entities, and single-entity roll-up prompts against a clear baseline, giving
  accountant close packs a consolidation readiness queue while historical
  consolidation review snapshots remain future work.
- Manual ledger share is now visible as posted journal activity from manual or
  no-source entries divided by total posted journal activity, giving accountant
  close packs a source-coverage signal tied directly to automation adoption.
- Unposted expense share is now visible in current-vs-prior comparisons from
  unposted receipt value divided by total receipt value, giving spend/tax packs
  a bookkeeping-backlog signal tied to automation coverage.
- Unposted receipt count is now visible beside unposted expense share, giving
  owner, freelancer, and accountant packs a concrete posting-queue workload
  signal for receipt automation.
- Unposted receipt value is now visible beside unposted receipt count, giving
  owner, freelancer, and accountant packs an AED backlog amount for receipt
  posting automation.
- Receipt automation coverage is now visible in current-vs-prior comparisons as
  auto-posted receipts divided by total receipts, giving owner, freelancer, and
  accountant packs a direct automation-adoption signal.
- Auto-posted receipt count and value are now visible beside receipt automation
  coverage, showing the concrete workload and expense value handled by
  automation.
- Receipt automation value coverage is now visible as auto-posted receipt value
  divided by total receipt value, showing whether automation is handling the
  high-value expense workload rather than only high-volume low-value rows.
- Bank reconciliation coverage and unreconciled bank count are now visible from
  imported bank transactions, giving cash, close, and advisory packs a bank
  automation/readiness signal while historical as-of bank rec reports remain
  future work.
- Reconciled bank count and value are now visible from imported bank
  transactions, showing the workload and absolute transaction value already
  cleared by the current reconciliation state.
- Unreconciled bank value is now visible as absolute transaction value for the
  unreconciled bank queue, helping bank automation and close packs prioritize
  high-value reconciliation work.
- Bank match suggestion coverage and suggested-match count are now visible for
  unreconciled bank transactions with suggested matches, giving bank automation
  queues a review-ready signal before users accept or post matches.
- Bank-assisted transaction count and value are now visible from reconciled
  transactions plus unreconciled suggested matches, showing the concrete bank
  workload and absolute transaction value already cleared or prepared by
  automation.
- Bank-assisted transaction coverage and value coverage are now visible from
  reconciled transactions plus unreconciled suggested matches divided by total
  bank activity, showing whether bank automation is handling the broad workload
  and the high-value workload.
- Bank match suggestion value coverage is now visible as suggested-match value
  divided by unreconciled bank value, helping bank automation queues prioritize
  high-value review-ready matches.
- Automation work queue count and value are now visible as a cross-report
  comparison proxy, combining overdue invoices/bills, due-soon invoices/bills,
  unposted receipts, expense claims awaiting review, and suggested bank matches
  into one action queue for owner, freelancer, and accountant packs.
- Automation adoption index is now visible as an available-component percentage
  across receipt auto-posting, bank reconciliation or suggestions, and
  non-manual ledger activity, giving each persona a single trendable automation
  adoption signal.
- Ledger automation share is now visible as the non-manual-source share of
  posted journal activity, exposing the ledger component behind the broader
  automation adoption index.
- Manual ledger activity is now visible as posted journal activity from
  manual/no-source entries, giving automation packs a concrete ledger value
  signal for work still handled manually.
- Automated ledger activity is now visible as total posted journal activity
  less manual/no-source activity, giving automation packs a concrete ledger
  value signal behind the adoption indexes.
- Automation value adoption index is now visible beside the count-style
  adoption signal, using receipt value, assisted bank transaction value, and
  non-manual ledger activity value to show whether automation is handling
  meaningful finance volume.
- Balance leverage is now visible in current-vs-prior comparisons through a
  liability-to-asset ratio from point-in-time Balance Sheet snapshots.
- Debt-to-equity is now visible in current-vs-prior comparisons from the same
  point-in-time Balance Sheet snapshots, giving balance-sheet-heavy owner,
  freelancer, and accountant packs a capital-structure signal.
- A working-capital proxy is now visible in current-vs-prior comparisons as
  open receivables less open payables, bounded to the current invoice/vendor-bill
  status model.
- Gross margin by product/service/customer once COGS allocation support exists.
- Full cash runway and burn-rate history beyond the current proxy metrics.
- Working capital summary once current-asset/current-liability classification is
  available in the report model.
- Historical DSO, DPO, and paid-amount collections effectiveness.
- Upcoming tax obligation deadlines beyond the current VAT/corporate-tax
  exposure comparison metrics.
- Client portfolio health for accounting firms.

Dimensional schema check, 2026-06-17:

- Cost centers are first-class today: `shared/schema.ts` defines
  `costCenters`, and journal lines carry an optional `costCenterId`.
- Branch, class, location, and project dimensions are not first-class in the
  current schema. Keep those reports in the management/advisory roadmap until
  the allocation model exists.
- Cost Center P&L is now workbook-live through `buildWorkspaceReportPack` and
  `prepareCostCenterProfitabilityForExport`; keep future project, branch,
  class, and location profitability in the roadmap until those allocation
  dimensions exist.

## Persona Experiences

Solo entrepreneur:

- Default home: cash position, invoices to chase, tax due, profit this month,
  and simple recommendations.
- Reports should use plain labels, short explanations, and one-click actions.
- Best automations: receipt autopilot, invoice reminders, VAT/corporate tax
  readiness, cash forecast alerts, anomaly review.

Freelancer:

- Default home: unpaid invoices, income by client, expenses by category,
  monthly profit, tax set-aside, and recurring work.
- Reports should focus on client profitability, collections, expenses, and
  simple tax readiness.
- Best automations: recurring invoices, payment chasing, receipt capture,
  client statements, monthly report pack.

Accountant:

- Default home: client portfolio health, unreconciled banks, missing documents,
  anomalies, month-end status, tax deadlines, and staff workload.
- Reports should expose drill-down detail, auditability, period locks, exports,
  and comparison views.
- Best automations: autonomous GL review queue, document chasing, payment
  chasing, month-end checklist, VAT autopilot, bulk report packs.

## Reporting UX Direction

Reports should be accessible from one unified report center instead of split
between "Reports" and "Advanced Reports" long term.

Required UX primitives:

- Report library grouped by Financial Statements, Sales, Purchases, Tax,
  Inventory, Payroll, Management, and Accountant Tools.
- Search and pinned favorites.
- Saved report views with date range, basis, comparison period, currency, and
  dimensions.
- Drill-down from summary line to source transactions.
- Compare to previous period, previous year, and budget.
- Export to Excel, PDF, Google Sheets, and scheduled email/WhatsApp packs.
- Role-aware defaults for solo entrepreneur, freelancer, and accountant.

## Automation Advantage

Every major report should answer: "What can NR-Ai do next for me?"

Automation hooks:

- A/R Aging -> generate chasing queue, WhatsApp/email reminders, escalation
  suggestions, promise-to-pay tracking.
- A/P Aging -> payment schedule suggestions and cash impact forecast.
- Cash Flow Forecast -> warn before cash dips, suggest invoices to chase or
  bills to delay.
- VAT Return -> autopilot calculation, adjustments, evidence checklist, filing
  readiness.
- Corporate Tax -> estimate liability, flag missing inputs, generate filing
  checklist.
- Trial Balance -> flag unbalanced, suspense, unusual, or unmapped accounts.
- General Ledger -> explain transaction history and suggest reclassification.
- Inventory Reports -> reorder alerts, slow-moving stock, margin issues.
- Fixed Asset Reports -> depreciation posting suggestions.
- Payroll Reports -> WPS readiness, gratuity exposure, variance checks.
- Month-End Close -> generate checklist, lock period, produce report pack.
- Audit Trail -> summarize risky edits and changed prior-period transactions.
- Consolidated Statements -> produce owner/accountant/investor report packs.

## Phased Build Path

Phase 1: unify and expose what already exists.

- Add a report library/index with existing reports and clear status labels.
- Surface server-only reports already available: Trial Balance, VAT Return,
  FX Gains/Losses, and AP Aging.
- Merge or cross-link Reports and Advanced Reports.
- Standardize date parameters, export controls, and loading/empty states.

Phase 2: complete the QuickBooks/Wafeq baseline.

- Add General Ledger and Account Transactions report views.
- Add Customer Balance, Vendor Balance, Invoice Status, Revenue by Customer,
  Sales by Product/Service, Expenses by Vendor, Expenses by Category.
- Add Inventory Valuation, Inventory Movement, Fixed Asset Register,
  Depreciation Schedule, Payroll Summary, Expense Claims, and Month-End Status.
- Add comparison modes to every report that can support them.

Phase 3: make automation the differentiator.

- Add scheduled report packs by persona.
- Add "next best action" panels on report pages.
- Add accountant bulk report generation across clients.
- Add automation health metrics beyond the current work-queue and adoption
  proxies: time saved, items auto-posted, documents chased, payments recovered,
  anomalies resolved.

Phase 4: management and advisory layer.

- Add dimensional reporting where schema support exists.
- Add consolidated statements and multi-company packs.
- Add AI narrative summaries for report packs.
- Add custom KPIs and dashboard widgets for accountant/freelancer/owner modes.

## Near-Term Implementation Recommendation

Build the unified report center first. The app already has enough report APIs
and automation modules to make the product feel more complete without inventing
new accounting logic immediately.

Initial report center MVP:

- One page at `/reports` with a report catalog.
- Keep existing P&L, Balance Sheet, VAT Summary views.
- Link current advanced reports from the catalog.
- Add catalog entries for API-backed but hidden reports.
- Mark not-yet-built report types as "Planned" so the direction is visible.
- Include persona filters: Owner, Freelancer, Accountant.

This creates a visible product direction now while reducing risk before deeper
report calculations are added.

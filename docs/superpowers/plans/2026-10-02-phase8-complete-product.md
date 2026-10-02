# Phase 8 — Complete product: better than Zoho Books, FreshBooks, Wafeq and Watin (2026-10-02)

Branch `launch/phase-8-complete-product`, stacked on `launch/phase-6-parity` (#64). One PR per wave.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## Team

| Role | Model | Count | Does |
|---|---|---|---|
| CTO (this session) | Fable 5.1 | 1 | Program plan, sequencing, gates, merges, PRs, owner reporting |
| VP Finance Product / VP Platform | Fable 5.1 | 2 | Competitor bar and acceptance criteria per stream up front; end-of-wave sign-off walkthrough in the browser |
| Domain leads | Opus 5.5 | 5 | Design doc per domain (schema, API, posting rules, acceptance tests); adversarial review with live requests |
| Implementers | Sonnet 5.5 | 10 | One backend and one frontend per domain, TDD, integration suites |

Every agent gets its own port (5070-5099; never 5000, 5060, 5061) and database (`muhasib_p8_<id>`) on the embedded
Postgres at localhost:5499. Migrations do not run at boot: `DATABASE_URL=... SESSION_SECRET=x JWT_SECRET=x npx tsx server/migrate.ts`.
Shared files (shared/schema.ts, server/routes.ts, client/src/App.tsx, nav-config.ts, i18n tables) are edited with
anchored Edits only, never rewritten. Migration numbers are reserved per domain below.

## Where we stand (inventory, 2026-10-02)

Real today: ledger with VAT 201/CT filing and evidence, FAF export, e-invoice XML (no live provider), opening balances,
year-end close, invoices/quotes/credit notes/recurring, payment chasing (4-level, email/WhatsApp), customer portal
(view-only), bills/PO→bill/expense claims, vendor credits, inventory with COGS, fixed assets with depreciation, budgets,
cash-flow forecast, bank CSV import + rules + reconciliation, payroll with WPS SIF and payslips, 33 live reports with
Arabic PDFs, scheduled report delivery, audit log, webhooks (7 events), document vault, OCR autopilot (OpenAI/Anthropic),
AI CFO, firm workspace, full Arabic.

Missing or partial: sales orders; online payment; quote acceptance online; customer prepayments/retainers; discounts,
shipping, price lists; custom fields; recurring auto-send; late fees; projects/time tracking/billable expenses;
approval workflows; leave/end-of-service/loans; vendor statements; live bank feeds and OFX/MT940/CAMT import; asset
disposal; 2FA; public API v1 (keys disabled); company data export/deletion; Zoho/QuickBooks/Xero import; help centre;
report count 33 vs Zoho's 50+; dashboard KPI honesty (credit notes counted as unpaid invoices).

## The bar

| Competitor | What they have that we must match or beat |
|---|---|
| Zoho Books | 50+ reports, sales orders, retainers, projects and timesheets, price lists, custom fields, approvals, bank feeds, online payments, client portal with pay/accept, public API, Zoho-style automations, UAE e-invoicing (accredited) |
| FreshBooks | Time tracking and projects, proposals/estimate acceptance, retainers, expense capture, online payments, simplicity |
| Wafeq | Accredited e-invoicing, inventory, payroll, 40+ reports, AED 69/99/249 |
| Watin | Positioning, residency claim, free accountant seat |

Where we win: VAT/CT filing depth with evidence and locks, ledger-tied inventory, Arabic end to end, AI bookkeeping,
firm workspace, honest pricing. E-invoicing accreditation stays "ready (PINT-AE)" until the owner signs a provider.

## Domains, streams and reserved migrations

### D1 Sales and getting paid — lead L1; S1 backend, S2 frontend; migrations 0102-0105
- Sales orders: quote → sales order → (partial) invoice and delivery note; stock reservation when costing is on.
- Online payment: provider interface + Stripe Checkout adapter (test keys from owner; works without keys = "not configured"), "Pay now" on the public invoice view and in the customer portal, webhook posts the payment and the gateway fee (expense) in one journal, partial payments, refunds through Stripe reflected as customer refunds. Adapter contract written so PayTabs/Telr can be added.
- Quote acceptance online: public token page, accept/decline with name, email, IP, timestamp recorded (signature record), auto-expiry job.
- Customer prepayments/retainer invoices: advance received to a customer-deposits liability (2040), applied to invoices with VAT treatment per UAE rules (VAT due on receipt of advance for taxable supplies), unapplied balances on statements.
- Line discounts (percent/amount), document-level discount, shipping line with VAT, price lists per customer, late-fee setting applied by the chasing job, recurring invoices auto-send by email.
- Custom fields: company-defined fields (text/number/date/select) on contacts, invoices, quotes, bills; shown on PDFs when flagged.

### D2 Purchases, projects and people — lead L2; S3 backend, S4 frontend; migrations 0106-0109
- Projects and time: projects (customer, budget, rate), tasks, time entries (timer + manual), billable expenses (from expense claims and bills), invoice from unbilled time/expenses, project profitability.
- Approval workflows: rules per document type (bill, expense claim, PO, journal, payroll run) by amount and role; multi-step; approval queue page; email/in-app notifications; audit-logged; applies to posting (nothing posts unapproved when a rule exists).
- Payroll: leave types and balances (UAE Labour Law defaults: 30 days annual), leave requests, end-of-service provision accrued monthly against 2036, employee loans/advances with scheduled deductions, payroll register report, WPS already done.
- Vendor statements (mirror of customer statements) and a vendor ageing detail.

### D3 Banking, automation and assets — lead L3; S5 backend, S6 frontend; migrations 0110-0113
- Bank feeds: provider interface + Lean Technologies (UAE) adapter against their sandbox, behind env keys; connection flow, scheduled sync, dedupe against imported statements; "manual" stays the default and nothing claims live feeds in the UI unless a connection exists.
- Statement import: OFX, MT940, CAMT.053 parsers; PDF statements through the existing OCR pipeline with a review grid.
- Reconciliation: suggested matches (amount/date/reference scoring), bulk accept, reconciliation report (statement balance vs ledger with unreconciled items), bank rules with split lines.
- Fixed assets: verify depreciation posts to an accumulated-depreciation contra account (inventory says Cr 1040, which is receivables — fix if true), disposal with gain/loss, asset register and depreciation schedule reports.
- Cash-flow forecast driven by real AR/AP due dates, recurring templates and payroll runs; scenarios.

### D4 Reports, compliance and insight — lead L4; S7 backend, S8 frontend; migrations 0114-0117
- Reports to 55+: general ledger detail, journal report, account transactions, sales by customer/item/salesperson, purchases by vendor/item, expenses by category/vendor, receivables/payables summary and detail, payments received/made, credit notes and refunds, inventory valuation/summary/movements, project profitability and time summary, VAT audit (sales and purchases detail), CT computation, comparative trial balance, FX gains/losses, fixed asset register and depreciation schedule, customer deposits, cash flow (direct and indirect), equity movement, bank reconciliation statement, audit log. Every report: date range or as-of, comparison period, drill-down to documents, Arabic PDF, CSV/XLSX, scheduled delivery.
- Dashboard honesty: KPI definitions documented and tested (credit notes never counted as unpaid invoices; overdue in AED).
- Firm: consolidated P&L and balance sheet across client companies; client health scorecard from real data.
- Corporate tax: small-business relief election and 0%/9% bands reflected in the computation and the return workpaper.

### D5 Platform, security and experience — lead L5; S9 backend, S10 frontend; migrations 0118-0121
- 2FA (TOTP + recovery codes), session list and revoke, password policy, new-device login email.
- Public API v1: API keys enabled with scopes and per-key rate limits; REST over contacts, items, invoices, bills, payments, journals, reports; OpenAPI 3 served at /api/v1/openapi.json with a docs page; idempotency keys on writes.
- Company data export (ZIP of CSVs + documents) and company deletion (soft, 30-day, owner-only, audit-logged).
- Migration wizard: import contacts, items, invoices, bills and chart from Zoho Books, QuickBooks and Xero CSV exports; preview, mapping, dry run.
- Mobile and accessibility: 375 px audit of the 25 most used screens, camera receipt capture, keyboard and screen-reader basics; performance: pagination on every list, indexes, N+1 removal, a load script.
- Help centre: markdown articles in-app (en/ar), contextual links from each page, searchable.

## Sequence per wave

1. VPs: competitor bar and acceptance criteria per stream (this plan reviewed and corrected).
2. Leads: design doc per domain with schema, API contract, posting rules, acceptance tests.
3. Backend implementers (wave 1) → frontend implementers (wave 2), TDD, integration suite per domain.
4. Leads: adversarial review with live requests; Sonnet fix round.
5. VPs: sign-off walkthrough in the browser against the bar; CTO runs all gates; one push; PR stacked on #64.

## Rules
- Nothing claims a feature in the UI or on the public pages unless it is real and tested.
- Money posting only through the existing journal services; balanced; period and filing locks respected; system sources read-only.
- No new paid services; provider adapters build against sandboxes and stay off without keys.
- Every string through the page i18n tables with Arabic; `node scripts/check-i18n.mjs` must pass.

## CTO decisions after the VP reviews (2026-10-02)

Both VP documents (`2026-10-02-phase8-bar-finance.md`, `2026-10-02-phase8-bar-platform.md`) are binding on the leads
where they correct this plan. Cross-domain names are fixed here so no lead has to negotiate them:

| Decision | Detail | Owner |
|---|---|---|
| One contacts table | `customer_contacts.contact_type text not null default 'customer'` (customer / vendor / both); `vendor_bills.vendor_id`, `purchase_orders.vendor_id`, `vendor_credit_notes.vendor_id` → customer_contacts(id), nullable, backfilled by exact name match per company. API v1 exposes "contacts" with `type`. | D2 backend, migration 0106, built first |
| New system accounts | 2055 Customer Advances (liability), 1025 Payment Gateway Clearing (asset, bank-type), 4035 Shipping Income (revenue) in 0102 (D1); 1080 Employee Loans (asset) in 0106 (D2). Added to the default chart and ensured on demand like 5200. 2040 stays Accrued Expenses. | D1, D2 |
| Advances | `customer_advances`, `customer_advance_applications`; advance tax invoice (VAT in period of receipt), deducted on the final invoice; unapplied balance on statements and the deposits report. | D1, 0102 |
| Custom fields | `custom_field_definitions` (company, entity, key, label en/ar, type, options, show_on_pdf), `custom_field_values` (entity, record_id, definition_id, value). Entities: contact, invoice, quote, bill, sales_order. | D1, 0103 |
| Sales orders | `sales_orders`, `sales_order_lines`; quote → SO → invoice(s) with available-to-promise check (no reservation). | D1, 0104 |
| Online payment | `payment_links`, `gateway_payments`; provider interface in `server/services/payment-gateway/`; Stripe adapter extends the existing `/api/webhooks/stripe` handler; settlement only through `storage.recordInvoicePayment`; fee posted via 1025. | D1, 0105 |
| Projects | `projects`, `project_tasks`, `time_entries`, `project_expenses` (links to expense claim lines or bill lines). | D2, 0107 |
| Approvals | `approval_rules`, `approval_requests`, `approval_steps`; gates the existing approve transitions on bills, expense claims, POs, payroll runs and manual journals. | D2, 0108 |
| Leave and loans | `leave_types`, `leave_balances`, `leave_requests`, `employee_loans`, `employee_loan_installments`; gratuity accrual already exists (5028/2036), do not rebuild. | D2, 0109 |
| Banking | Finish the existing `BankProvider` (Lean sandbox) rather than a new interface; wire `parseOFXStatement`, add MT940 and CAMT.053; rules get `split_lines jsonb` (0110); reconciliation report = statement balance vs ledger; cash-flow forecast reads vendor_bills, recurring templates, payroll runs (0111). Fixed-asset work is reports only (depreciation and disposal already exist). | D3 |
| Reports | D4 builds over existing tables first; reports on advances, projects, approvals, leave and bank feeds start only when 0102-0113 are in the tree. The frozen catalog count test moves with the catalog. Report PDFs are server-side with the Arabic font (the pdf-*.ts helpers), not jsPDF. | D4 |
| Platform | TOTP + recovery codes (0118 `user_totp`, `user_recovery_codes`), session list/revoke over `refresh_sessions`, API keys enabled with scopes and `idempotency_keys` (0119), company export as a ZIP built on `backups.routes.ts` plus documents, company deletion request (0120, soft, 30 days, owner-only), migration wizard jobs (0121). Retention stays 5 years in code; 7 years for CT is an owner/legal item. Audit Trail report and PDPL export read `activity_logs`. | D5 |
| Drizzle definitions | Streams that touch raw-SQL tables (vendor_bills, employees, payroll_*, expense_claims, fixed_assets, vendor_credit_notes) add Drizzle definitions for the columns they read, so D4 and D5 can query typed. | each |
| Scope cuts | Stock reservation on sales orders; late fees (off by default, setting only); native apps; Hijri calendar; PayTabs/Telr adapters (interface only). | — |
| Owner items | Stripe test keys; Lean sandbox token and a production decision before any "bank feeds" claim; gateway-fee VAT treatment (accountant); 7-year CT retention. Nothing claims these features in the UI until configured. | owner |

Build order inside wave 1 (backends): D2's 0106 contacts/vendor id lands first (S3 starts with it and reports when it is
in the tree); D1 and D3 start in parallel on their own tables; D5 starts immediately (independent); D4 starts on
existing-table reports immediately and takes new-table reports after wave 1.

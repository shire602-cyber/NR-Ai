# Phase 8 design D4: reports, compliance and insight (lead L4, 2026-10-02)

Implementers: S7 backend, S8 frontend. Migrations 0114-0116 (0117 unused). Cost first: cheapest correct route, no
paid services, batch your work, consult before spending. Every file:line below was read on `launch/phase-8-complete-product`.

## 1. Scope

**What the code shows (it changes the plan):**
- 33 live entries (`reportCatalog.ts:1562-2003`), most computed **in the browser** from whole lists (GL loads the full
  journal; `Reports.tsx:3712-4343`); Audit Trail capped at 100 with an unbounded `limit` (`portal.routes.ts:19`).
  Server PDF/CSV/XLSX/scheduling need server math, so the core of D4 is a **server report engine**.
- Delivery today = in-app notifications for persona packs, no file, no email (`report-delivery.service.ts:380-430`).
  Per-report scheduled delivery is new.
- Dashboard revenue/expenses are all-time (`dashboard.routes.ts:139-147`); AP reads **unposted receipts** (`:200-221`),
  which are paid cash expenses (`schema.ts:1835`), not payables. **VP correction:** payables come from `vendor_bills`.
- **Finding:** AP ageing counts *pending* bills (`aging-as-of.service.ts:154,186`; `reports.routes.ts:358`), but only
  approved bills post to 2010 (`bill-posting.service.ts:131-137`), so ageing does not tie to the ledger. Fixed below.
- **Finding:** SBR has no sunset; MD 73/2023 allows it only for tax periods ending ≤ 31 Dec 2026, but
  `shared/ct-workpaper.ts:334-339` checks only the revenue cap. Fixed below.
- **VP count:** eight rows are marked dep (27, 28, 51-53, 57, 58, 61), so the floor is 55, not 56. Row 61 is *not*
  dependent (`fixed_assets.disposal_date/disposal_amount` exist); 58 is (needs D2's gratuity function).
- **Names (CTO table wins):** `customer_advances`/`customer_advance_applications` + 2055 (not `customer_deposits`/2040);
  `project_expenses`; `employee_loan_installments`; no `eos_provisions` table.

**Streams:** (1) report engine: shared ledger layer, registry of thin definitions, one run route (JSON/CSV/XLSX/PDF),
one generic Arabic PDF renderer; (2) reports: the 33 existing get server definitions plus `params`/`drillTarget`, wave 1
adds 23 over existing tables (**56 live**), wave 2 adds 10 on D1-D3 (**66**); (3) per-report scheduled email delivery
with a run log; (4) dashboard KPIs exactly as the VP wrote them, plus `docs/KPI_DEFINITIONS.md`; (5) server-side
consolidated P&L/BS with intercompany eliminations; (6) Audit Trail over `activity_logs`, paginated, sensitive roles only;
(7) compliance fixes: AP posted-only with a due-date fallback, SBR sunset, VAT purchases extraction (rows = box 9).

**Wave 1 new (23):** cash-flow-direct, comparative-trial-balance, journal-report, equity-movement, receivables-detail,
payments-received, credit-notes-refunds, quotes-conversion, recurring-schedule, payables-detail, purchases-vendor,
purchases-item, payments-made, purchase-orders-status, vendor-credits, vat-audit-sales, vat-audit-purchases,
ct-workpaper, unreconciled-bank-items, inventory-summary, payroll-register, asset-disposals, and
**vat-control-reconciliation** (extra: GL 2020/1050 movement vs the return per period, for headroom).
**Wave 2 (10):** bank-reconciliation-statement (D3 computation), sales-orders-status, customer-advances (D1),
project-profitability, time-summary, unbilled-time-expenses, leave-balances, eos-provision, employee-loans and
approval-history (D2).

**Cuts:** sales by salesperson (no field); consolidation FX translation (mixed base currencies → 422); materialised
views (staleness, no gain at launch volume); a DB VIEW for the ledger (it would block other domains' `ALTER COLUMN TYPE`
on `journal_lines`; the layer is a TS SQL fragment); client health scorecard (exists, `firm-analytics.routes.ts:231`);
rewriting the 22,120-line `Reports.tsx` (browser-computed reports are repointed to the server viewer instead).

## 2. Data

**0114_report_schedules.sql** (idempotent; tenant: `company_id`, every query filters it):
```sql
CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,        -- {rangePreset|asOfPreset, compare, filters}
  format text NOT NULL CHECK (format IN ('pdf','csv','xlsx')),
  lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en','ar')),
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month smallint CHECK (day_of_month BETWEEN 1 AND 28),
  hour_dubai smallint NOT NULL DEFAULT 7 CHECK (hour_dubai BETWEEN 0 AND 23),
  recipient_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,  -- company members only, emails resolved at send
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamp NOT NULL, last_run_at timestamp,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_report_schedules_company ON report_schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules(next_run_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS report_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slot_key text NOT NULL,                              -- '2026-10-05T07' or 'manual:<uuid>'
  trigger text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule','manual')),
  status text NOT NULL CHECK (status IN ('running','sent','skipped','failed')),
  reason text, resolved_params jsonb NOT NULL, row_count integer, byte_size integer, sha256 text,
  recipients_sent integer NOT NULL DEFAULT 0,
  started_at timestamp NOT NULL DEFAULT now(), finished_at timestamp,
  CONSTRAINT report_schedule_runs_slot_unique UNIQUE (schedule_id, slot_key));
CREATE INDEX IF NOT EXISTS idx_report_schedule_runs_company ON report_schedule_runs(company_id, started_at DESC);
```
This is a separate run table, not `company_report_delivery_runs`. That table's `subscription_id` points to the static
persona packs, and the existing UI resolves those ids.

**0115_report_indexes.sql:** `activity_logs(company_id, created_at DESC)`, `vendor_bills(company_id, bill_date)`,
`invoice_payments(company_id, date)`. No index is needed on `journal_lines(account_id)`: it already exists (`0027:197`),
as does `journal_entries(company_id, date)` (`schema.ts:889`).

**0116_intercompany_accounts.sql:** `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS intercompany_company_id uuid
REFERENCES companies(id) ON DELETE SET NULL;` The column is optional and names the counterparty entity. On write it must
differ from the account's own company, and the user must have `hasCompanyAccess` to it (422 `INVALID_INTERCOMPANY`).

**Drizzle (anchored edits in `shared/schema.ts`):** `reportSchedules` and `reportScheduleRuns` after
`companyReportDeliveryRuns` (:625), and `intercompanyCompanyId` on `accounts` (:799). Raw-SQL tables (`vendor_bills`,
`payroll_*`, `fixed_assets` and so on) are read with parameterised `pool.query`, the pattern `aging-as-of.service.ts`
already uses. D4 does not wait for their Drizzle definitions. Journal: S7 appends 0114-0116 to
`migrations/meta/_journal.json` after 0102-0113; the CTO resolves ordering at merge. There are no backfills
(`next_run_at` is computed on insert).

## 3. Posting rules

**D4 creates no journals.** Reports, schedules and the dashboard are read-only and post nothing, so locks are not
relevant. Rules the readers must respect:
- Posted entries only; AED from `journal_lines.debit/credit` (`numeric(15,2)`), summed in SQL, rounded once (`round2`).
- P&L-type reads exclude `year_end_close(_reversal)` (as `storage.ts:1842-1846`); KPI reads also exclude
  `corporate_tax_filing`; balance reads include everything.
- Dubai days via `uaeDayStart/uaeDayEnd` (`utils/date.ts:14,23`); fiscal year from `companies.fiscal_year_start_month`
  (`schema.ts:314`).
- Voids by the date-based rule (`aging-as-of.service.ts:56-66`); credit notes are `invoices(invoice_type='credit_note')`
  (`0081`), the legacy `credit_notes` table is never read.
- **AP fix:** bills count only with status in (`approved`,`partial`,`paid`,`overdue`), and the due date is
  `COALESCE(due_date, bill_date + 30)` in all three AP paths (as-of SQL, the default ageing path, and the dashboard). The
  default `/aging` path becomes the as-of SQL with asOf = today in Dubai, leaving one code path. Pending bills are shown
  in Payables Detail as an "awaiting approval" section that is left out of totals.
- FX: document reports show document currency plus AED at the document rate. Ledger reports show AED only. The FX
  Gains and Losses report reads `fx_revaluation*` sources.

## 4. State machines and invariants

**Report schedule:** `enabled ⇄ paused` (PATCH `enabled`), then `deleted` (hard delete, cascading runs). On create and on
any cadence edit, `next_run_at = nextSlot(now, cadence, day, hour_dubai)`.

**Run:** `running → sent | skipped | failed`, driven from the existing `20 * * * *` tick (`scheduler.service.ts:232`;
no new cron, no recurring cost): (1) one transaction does `SELECT … WHERE enabled AND next_run_at <= now() FOR UPDATE
SKIP LOCKED LIMIT 50`, inserts the run `ON CONFLICT (schedule_id, slot_key) DO NOTHING` and advances `next_run_at`, so
one run per slot across instances; (2) outside it, `runReport()` resolves presets in Dubai time, renders and calls
`sendEmail` with the attachment (`email.service.ts:115,602`); (3) no provider → `skipped EMAIL_NOT_CONFIGURED`
(`:127`) plus an in-app notification; departed members are dropped with a reason; render errors → `failed`; (4) runs
still `running` after 30 min → `failed STALE_RUN`.

**Read consistency:** each `runReport` executes in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, so
rows, totals and comparison columns come from one snapshot even while invoices are posting.

**Invariants (all tested):** TB Σ Dr = Σ Cr; BS balances with current-year earnings = P&L net YTD; AR ageing = 1040
(AED documents); AP ageing = −2010; VAT Audit Sales Σ standard VAT = box 1, Purchases Σ recoverable = box 9; dashboard
revenue = P&L revenue; consolidated = Σ entities + eliminations, eliminations net to zero (else `UNMATCHED_INTERCOMPANY`).

## 5. API contract

**Shared types** (`shared/report-result.ts`, created first by S7):
`ReportResult {reportId, title{en,ar}, companyId, currency:'AED', params{from?,to?,asOf?,compare?{mode,from?,to?,asOf?}},
columns: {key,label{en,ar},type:'text'|'money'|'date'|'number'|'percent',comparable?}[], rows:{key,kind:'detail'|'section'|'subtotal',
depth?,cells:Record<string,string|number|null>,drill?:{target,id}}[], totals?, page?{offset,limit,total}, warnings?:string[], generatedAt}`.
Comparison adds `<key>__cmp`, `<key>__delta` (current minus prior) and `<key>__pct` (null when the prior value is 0),
with rows matched on `key`.

| Method / path | Middleware | Input (zod) | Response / errors |
|---|---|---|---|
| GET `/api/companies/:companyId/reports/run/:reportId` (new `report-run.routes.ts`) | `authMiddleware`, `requireCompanyAccess("params")`, definition role check, `buildLimiter` 30/min/user for non-JSON formats | `from,to,asOf,compareFrom,compareTo,compareAsOf` (YYYY-MM-DD); `compare` none/priorPeriod/priorYear/budget/custom; `format` json/csv/xlsx/pdf; `lang` en/ar; `limit` ≤1000 (default 500); `offset`; plus per-definition filters (`accountId, contactId, bankAccountId, source, userId, entityType, action, budgetPlanId, costCenterId, taxYear, payrollRunId, companyIds`). Unknown keys are refused. | 200 JSON `ReportResult`. Files: `text/csv; charset=utf-8` with BOM, the xlsx MIME, or `application/pdf`, with `Content-Disposition` set. 400 `INVALID_PARAMS`; 404 `REPORT_NOT_FOUND`; 409 `REPORT_NOT_AVAILABLE` (dependent table absent); 403 `ROLE_FORBIDDEN`; 422 `INVALID_RANGE`, `RANGE_TOO_LONG` (>5 y), `COMPARISON_NOT_SUPPORTED`, `AS_OF_IN_FUTURE` (ageing), `REPORT_TOO_LARGE` (PDF >5,000 rows, CSV/XLSX >50,000), `MIXED_BASE_CURRENCY`, `TOO_MANY_COMPANIES` (>25) |
| GET `/api/reports/catalog` (`reports.routes.ts:55`, `report-catalog.service.ts:263,293`) | unchanged | unchanged | Each report gains `href`, `params ⊆ {range, asOf, comparison}`, `drillTarget`, `formats`, `schedulable` |
| GET / POST `/api/companies/:companyId/report-schedules`; PATCH / DELETE `…/:id`; POST `…/:id/run-now`; GET `…/:id/runs` (new `report-schedules.routes.ts`) | auth, company access; writes need role owner/accountant/cfo | `{reportId, params, format, lang, cadence, dayOfWeek?, dayOfMonth?, hourDubai, recipientUserIds[1..20]}` | 201 schedule; 422 `RECIPIENT_NOT_MEMBER`, `REPORT_NOT_SCHEDULABLE`, `INVALID_CADENCE`; 404 when the id belongs to another company; run-now 202 `{runId}` |
| GET `/api/companies/:companyId/dashboard/stats` (`dashboard.routes.ts:242-252`) | unchanged | `period` month (default)/ytd/custom; `from`,`to` for custom | Adds `period{from,to}`, period `revenue/expenses/netProfit`, `arAging` and `apAging` as `{current,days1to30,days31to60,days61to90,days90plus}`, `overdueReceivables`, `receivablesMissingDueDate`, `payablesOutstanding`, `vatDueNext{amount,periodEnd,dueDate}` or `{null, reason:'NO_TRN'|'EMIRATE_NOT_SET'}`. 422 `INVALID_PERIOD`. There is no all-time option. |
| GET `/api/companies/:companyId/reports/pl`, `/balance-sheet` (`dashboard.routes.ts:362,438`) | unchanged | unchanged | Response shape unchanged; reimplemented on `ledger.ts` |
| GET `/api/reports/:companyId/aging` (`reports.routes.ts:301`) | unchanged | unchanged | Default path = as-of today; posted-bills fix |
| GET `/api/companies/:companyId/activity-logs` (`portal.routes.ts:14`) | unchanged | `limit` capped at 1000 | unchanged |
| PUT account (`accounts.routes.ts`) | unchanged | `intercompanyCompanyId` uuid or null | 422 `INVALID_INTERCOMPANY` |

**Engine** (`server/reports/`): `ledger.ts` (the shared layer: `ledgerLinesSql` CTE fragment, `accountBalances`,
`openingMovementClosing`, `ledgerDetail` with opening row and window running balance, `periodProfit` used by both the
dashboard and the P&L so AC6 holds by construction); `params.ts` (zod, Dubai presets `thisMonth…asOfLastMonthEnd`,
`comparisonWindow`: priorPeriod = same length immediately before, priorYear = −1 year with 29 Feb → 28 Feb);
`registry.ts` (`{id, roles?, filters, columns, run(ctx)}`; `params`/`drillTarget` read from the catalog entry, the single
source, and registration throws if missing); `run.ts` (transaction, comparison merge, pagination with totals over the
full set); `render/csv.ts` (`'` before text cells starting `= + - @`); `render/xlsx.ts` (`buildGenericWorkbook`,
`excel-export.service.ts:184`, extended with `rightToLeft` and `numFmt`); `render/pdf.ts`, the one generic renderer on
`createPdfDocument` (`pdf-fonts.ts:223`), `fitFontSize` (`pdf-layout.ts:13`), `formatMoney/formatPdfDate`: A4,
landscape above 6 columns, company + title (en, or `reportNameAr` from `reportCatalogI18n.ts`) + params + Dubai time,
repeated column header, totals, page x/y, mirrored columns and right alignment for `ar`, Western digits; `labels.ts`
(column labels en/ar, shown by the client); `definitions/*.ts` by family.

**Roles:** payroll register, payroll summary, WPS, EOS, leave, loans and the Audit Trail need owner/accountant/cfo, or
firm staff via `hasFullNraScope` or `firm_admin` access (`rbac.ts:15-60`, `storage.ts:1442-1467`). All other reports are
open to any member, as today.

**Wrapping existing logic:**
- VAT audit sales uses `loadPeriodSalesDocuments` (`vat-period-documents.service.ts:109`).
- VAT audit purchases uses the new `vat-period-purchases.service.ts`. Its loaders are lifted unchanged out of
  `computeVatReturnForPeriod` (`vat-return-compute.service.ts:104-250`), which then calls them.
- CT workpaper uses `buildCtReturnWorkbook` (`ct-workpaper-export.service.ts:363`).
- Ageing uses the `aging-as-of.service.ts` SQL.
- The dashboard's VAT due figure uses `currentVatPeriodForCompany` (`firm-clients.service.ts:389`) and
  `computeVatReturnForPeriod`, with due date = the 28th of the month after the period end.

## 6. UI

S8, all strings through per-page `*.i18n.ts` tables with Arabic:
- **`/reports/run/:reportId`**, `pages/ReportRun.tsx`. It has a parameter bar (range or as-of presets, comparison
  selector shown only for C reports, filters from the definition), a table showing the server labels for the locale,
  drill links via `client/src/lib/report-drill.ts`, totals, server "Load more" pagination, an export menu (PDF, CSV,
  XLSX via `downloadAuthenticatedFile`, `client/src/lib/file-upload.ts:75`, with `lang` set to the UI locale) and a
  "Schedule" dialog. Drill targets map to hrefs: account goes to the ledger, journal_entry to the journal, then invoice,
  bill, payment, credit_note, refund, quote, PO, vendor_credit, bank_txn, product, asset, employee, payslip,
  expense_claim and activity entity.
- **`/reports/schedules`**, `pages/ReportSchedules.tsx`. It lists schedules and their run history, with pause, delete
  and run-now.
- **Consolidated view:** `components/reports/ConsolidationCompanyPicker.tsx` inside ReportRun for
  `consolidated-statements`. It shows a P&L/BS toggle and per-entity, eliminations and consolidated columns. The account
  edit form gets the "Intercompany counterparty" select.
- **Catalog repointing:** catalog `href` goes to the viewer for every browser-computed report and every new one.
  Server-backed tab views (P&L, BS, TB, VAT, ageing, cash flow) keep their tab, and `ReportExportMenu` is mounted in the
  focused-report header of `Reports.tsx` with an anchored edit.
- **Dashboard:** MTD/YTD toggle, the five buckets for AR and AP, an "overdue" figure, a "no due date (assumed +30)"
  flag, and a VAT-due-next card. Every consumer of `arAging`/`apAging` is updated: `Dashboard.tsx`, `AICFO.tsx`,
  `SmartAssistant.tsx`.
- **Navigation:** no new sidebar item. Reports stays one entry (`nav-config.ts:111-117`), and schedules are linked from
  the Reports header, so the nav-config test is untouched. App routes are added to `App.tsx` with anchored edits next to
  `:609`.

## 7. Tests

Suite: `tests/integration/phase8-d4.test.mjs`, chained into `test:integration`. S7 writes it. It covers VP-Platform
ACs 1-10 plus the D4 checks below.

| AC | Test |
|---|---|
| 1 | Catalog `liveReportCount ≥ 55` (56 after wave 1). Every live entry has `href`, `params ⊆ {range,asOf,comparison}` and `drillTarget`. Every live id runs with 200 on a seeded company. |
| 2 | P&L Jan with `compare=priorYear`: three money columns, delta = current − prior, and a year-end close posted in December changes nothing. |
| 3 | Comparative TB 31 Mar vs 31 Dec: opening, movement and closing per account; Σ Dr = Σ Cr in both. |
| 4 | Invoice 1,050, credit note 525, payment 525: Receivables Detail 0 open, Credit Notes 525, Payments Received 525, dashboard outstanding 0. |
| 5 | Bill 2,100 dated 40 days ago and approved, paid 1,000: Payables Detail 1,100, AP 1-30 = 1,100, dashboard `apAging.days1to30` = 1,100. A pending bill of 500 is not in any total. AP total = −2010. |
| 6 | Dashboard `period=month` revenue = P&L revenue for the same range; `period=all` gives 422. |
| 7 | VAT Audit Sales for one quarter with standard, zero-rated and exempt lines: row count = lines, Σ VAT = box 1 of `/vat-returns/generate`. A purchases twin checks Σ recoverable = box 9. |
| 8 | Bank account with 3 unreconciled transactions: ledger + unreconciled = statement (wave 2, with D3). Wave 1 tests Unreconciled Bank Items count 3. |
| 9 | For every live report, `format=csv` and `format=xlsx` return 200 with the right MIME, Arabic headers when `lang=ar`, and the same row count and totals as JSON; `format=pdf` returns 200 starting with `%PDF`. |
| 10 | Weekly schedule with run-now: a run row exists; with no email provider, `skipped EMAIL_NOT_CONFIGURED` and a notification. Calling the scheduler tick twice for one slot leaves one run. |

**D4 extra checks:** K1-K11, one per KPI (period P&L excluding a CT accrual and a year-end close; overdue at 23:30
Dubai on the due day; five buckets; burn excluding 5100, CT expense, 5160; runway/growth nulls; VAT due null `NO_TRN`).
L1-L3 tie-outs (AR = 1040, P&L net = BS current-year earnings, TB balanced after FX revaluation). T1-T4 tenant isolation
(foreign `:companyId` on run/schedules/runs → 403; foreign id in `companyIds` → 403; non-member recipient → 422; foreign
`accountId` filter → no rows). R1-R2 (employee 403 on payroll-register and audit-trail; unassigned firm_admin 403).
C1-C4 CT (2.9M + SBR → 0; 3.1M → (taxable − 375,000) × 9%; prior breach carries forward; period ending 2027-12-31 not
eligible). F1-F2 consolidation (IC 1,000/1,000 eliminates to 0; 1,000/900 → `UNMATCHED_INTERCOMPANY` 100). A1 Audit
Trail 1,200 rows paginated, `limit=5000` → 400.

**Unit tests (S7):** comparison windows and presets (fiscal year, leap day, Dubai midnight); CSV escaping and
formula guard; PDF smoke (Noto embedded for Arabic, header repeats, ar mirrors columns); registry/catalog parity;
`report-catalog-routes.test.ts:124-126` moved to 56 then 66 in the catalog commit; scheduler slot maths.

**Unit tests (S8):** `tests/unit/report-drill.test.ts` (every drill target maps to a route defined in `App.tsx`) and
`tests/unit/report-params-ui.test.ts` (preset to query string).

## 8. Work split

**S7 (backend; only S7 writes migrations):** `migrations/0114-0116`, `migrations/meta/_journal.json` (append);
`shared/schema.ts` (anchored), `shared/report-result.ts`, `shared/ct-workpaper.ts`; `server/reports/**`;
`server/routes/{report-run,report-schedules}.routes.ts` (new), `server/routes.ts` (anchored, `:159-161`),
`dashboard.routes.ts`, `reports.routes.ts`, `portal.routes.ts`, `accounts.routes.ts`, `corporate-tax.routes.ts`;
`server/services/{aging-as-of,report-catalog,vat-period-purchases (new),vat-return-compute,excel-export}.service.ts`,
`scheduler.service.ts` (anchored); `client/src/lib/reportCatalog.ts` and `reportCatalogI18n.ts` (the server imports
them and the parity/frozen-count tests depend on them); `tests/unit/report-catalog-routes.test.ts`,
`tests/unit/reports-*.test.ts`, `tests/integration/phase8-d4.test.mjs`, `package.json` (anchored); `docs/KPI_DEFINITIONS.md`.

**S8 (frontend):** `client/src/pages/{ReportRun,ReportSchedules}.tsx` + `.i18n.ts`;
`client/src/components/reports/{ReportParamsBar,ReportTable,ReportExportMenu,ReportScheduleDialog,ConsolidationCompanyPicker}.tsx`
+ `.i18n.ts`; `client/src/lib/{report-drill,reportRunApi}.ts`; `client/src/App.tsx` (anchored); `Reports.tsx` and
`Reports.i18n.ts` (anchored: export menu and schedules link only); `Dashboard.tsx` + i18n, `AICFO.tsx`,
`SmartAssistant.tsx`; the chart-of-accounts edit form; `tests/unit/report-drill.test.ts`, `report-params-ui.test.ts`.

**Order:**
- S7 day 1: `shared/report-result.ts`, then the registry and run route with P&L and General Ledger in JSON and CSV. S8
  starts the viewer against it, using fixtures typed by `ReportResult` until then.
- S7: `ledger.ts` with P&L, BS and TB parity (existing suites green), then the wave-1 definitions in batches of about 6,
  then PDF and XLSX, then dashboard KPIs, then AP and SBR fixes, then schedules (0114), then consolidation (0116), then
  the catalog flip and count.
- S8: viewer, export menu, dashboard, schedules UI (stubbed against the zod contract until the routes land), then
  consolidation picker.
- Wave 2: dependent definitions once 0102-0113 are in the tree.

## 9. Dependencies

| Need | From | Fallback if late |
|---|---|---|
| `customer_advances`, `customer_advance_applications`, account 2055; `sales_orders`, `sales_order_lines` | D1 (0102, 0104) | Entries stay `status:"planned"` (not counted live, no claim in the UI) |
| `customer_contacts.contact_type`, `vendor_bills.vendor_id` | D2 (0106) | Purchases by Vendor groups by `COALESCE(vendor_id::text, lower(trim(vendor_name)))`; this works before and after 0106 |
| `projects`, `project_tasks`, `time_entries`, `project_expenses`; `leave_types`, `leave_balances`, `leave_requests`; `employee_loans`, `employee_loan_installments`; `approval_requests` (status for the Payables Detail column); a pure gratuity entitlement function exported from a service, not a route | D2 (0107-0109) | Planned. Payables Detail omits the approval column |
| `computeBankReconciliationStatement(companyId, bankAccountId, asOf)` exported by D3's service, backing D3-7 | D3 | Planned. Unreconciled Bank Items ships in wave 1 over `bank_transactions.is_reconciled` |
| Discount, shipping and advance lines in `loadPeriodSalesDocuments` and `document-totals` | D1 | VAT Audit inherits them automatically through the shared loader |
| API v1 `read:reports` wraps `runReport()`; D5 writes 2FA and session events to `activity_logs` | D5 | Independent. The Audit Trail shows whatever rows exist |

## 10. Review plan (live requests on my own port and database)

- **Tenant isolation:** swap `:companyId` and every id filter (`accountId`, `contactId`, `bankAccountId`,
  `payrollRunId`, `budgetPlanId`, `companyIds`) to another company's; PATCH/DELETE/read another company's schedules and
  runs. Expected 403/404/empty, never data.
- **Money:** recompute P&L, BS, TB, AR, AP and VAT boxes by hand in psql over a seeded set (AED and USD invoices, credit
  note, partial payment, refund, vendor credit, pending bill, year-end close, CT accrual, FX revaluation, void after
  period end); every total ties to the fils, no float noise. Boundaries: 23:59 vs 00:01 Dubai at month end, 29 Feb
  prior-year, April fiscal year.
- **VAT:** box 1/box 9 equality with mixed rates, reverse charge and an expense claim; the existing VAT suites must stay
  green after the purchases extraction, or the merge is blocked.
- **Abuse:** `limit=10^9`, a 20-year range, a 5,001-row PDF, `=HYPERLINK(…)` customer names in CSV, unknown query keys,
  two concurrent scheduler ticks (one run), a raw email address as a recipient.
- **Arabic and roles:** every PDF in `ar` (shaped glyphs, mirrored columns, Western digits); employee, accountant and
  firm_admin (assigned and unassigned) against payroll and audit reports.

## Summary for the CTO

1. Reports are mostly browser math today, so D4 builds one server report engine. Every report then gets PDF, CSV, XLSX, scheduling and drill-down from shared code.
2. 33 live now, 56 after wave 1 using existing tables only, and 66 after D1-D3 land. The VP's "56 without deps" was really 55.
3. The VP doc names `receipts` for payables; the code's payables are `vendor_bills`. The dashboard AP is not payables at all.
4. AP ageing counts unapproved bills that are not in the ledger. D4 limits it to posted statuses and adds a test that ties it to 2010.
5. Small Business Relief has no 31 Dec 2026 sunset in code. D4 adds it and a test.
6. Dashboard revenue, expenses and burn move to SQL over the shared ledger layer, so revenue equals the P&L by construction. All-time revenue is removed.
7. Migrations: 0114 (schedules and runs), 0115 (three indexes), 0116 (intercompany counterparty on accounts). No views or materialised views, and no new cron jobs.
8. D4 needs from D2 a pure gratuity function and `vendor_id`, and from D3 an exported reconciliation-statement function. Late items stay "planned", which is honest.
9. Owner decision: should monthly burn exclude irrecoverable VAT (5160)? The VP wrote "exclude"; I implement that, but it is a real cash cost.
10. Owner/legal decision: scheduled report emails go only to company members. Allowing external recipients (an auditor or a bank) is a data-sharing choice.

# Phase 8 — D4/D5 bar, report list, security standards, acceptance criteria (VP Platform, 2026-10-02)

Scope: D4 (reports, compliance, insight) and D5 (platform, security, experience). Every claim was checked
against `launch/phase-8-complete-product`; file:line given where it matters. Cost first: cheapest correct
route, no paid services, batch your work, consult before spending.

## 1. The bar

| Area | Zoho Books | FreshBooks | Wafeq | Watin | Muhasib today (verified) |
|---|---|---|---|---|---|
| Reports | "50+"; range, prior-period compare, drill to document, PDF/XLSX/CSV, schedule | ~20 (P&L, BS, GL, TB, aging, expense, time, project profit) | 40+ claimed; list unsure | unsure | 33 live (`client/src/lib/reportCatalog.ts:1562+`); CSV/XLSX client-side; no compare param on P&L/BS; drill-down only on ledger pages |
| API | REST v3, OAuth2, org rate limit (~100/min), webhooks, docs | REST, OAuth2, docs | REST + API key; webhooks unsure | unsure | Keys disabled (`server/routes/api-keys.routes.ts:13`); 7 webhook events (`shared/webhook-events.ts`) |
| Security | TOTP 2FA, session list, SSO, audit | TOTP 2FA | unsure | unsure | Google/Microsoft OAuth (`auth.routes.ts:403`), password policy (`:227-233`), rotating refresh sessions with UA/IP (`shared/schema.ts:155-180`), token blacklist, rate limits (`server/middleware/rateLimit.ts`, `security.ts:155-190`), helmet CSP. No TOTP, session list, idempotency, OpenAPI |
| Migration | From QuickBooks, Xero, Sage, Wave; CSV templates | CSV; QuickBooks switch (unsure) | Excel import; guides (unsure) | unsure | Opening balances + CSV; `MigrationGuides.tsx` page; no wizard |
| Mobile | iOS/Android, receipt camera | iOS/Android | iOS/Android | unsure | Responsive web, `MobileNav`, `use-mobile`, mobile UX test; no app |
| Help | Help centre, webinars, in-product tips | Help centre, chat | Help centre, Arabic | unsure | Static 5-guide `HelpCenter.tsx` (en/ar), Trust page; no search or contextual links |
| Export/delete | Backup ZIP of CSVs; org delete | CSV export | unsure | unsure | JSON backup+restore of accounts, journals, invoices, bills, VAT returns (`backups.routes.ts:36-274`); no documents/contacts/payroll; no company delete route |
| Tax | FTA-accredited; VAT 201; basic CT | n/a | FTA e-invoicing accredited (KSA proven; UAE unsure) | residency claim | VAT 201 with evidence, locks, amendments, FAF; CT with SBR and 0/9% bands (`shared/ct-workpaper.ts:197`) |

Why Dubai picks us: frozen, evidenced, locked, amendable VAT/CT returns no competitor matches; Arabic end to
end; honest capability badges; a scoped, documented API a firm can automate against; 7-year retention and
PDPL export built in; firm workspace with real roll-ups.

## 2. Reports to 55+ and dashboard KPI definitions

Params: **R** range, **A** as-of, **C** comparison (prior period / prior year / budget). Source: **V** = view
over `journal_lines`+`journal_entries` (one view per family), **Q** = query over the named document table.
Drill = row click target. All reports: AED plus document currency, Arabic via i18n, CSV always, XLSX via
existing `exceljs`, scheduling via `company_report_delivery_subscriptions`. **E** existing, **N** new,
**dep** = needs another stream's table.

| # | Report | E/N | Params | Drill | Source |
|---|---|---|---|---|---|
| **Financial** | | | | | |
| 1 | Profit & Loss | E | R, C | account→ledger | V, excl. year-end close |
| 2 | Balance Sheet | E | A, C | account→ledger | V |
| 3 | Cash Flow (indirect) | E | R, C | account→ledger | V |
| 4 | Cash Flow (direct) | N | R, C | bank txn | Q `bank_transactions`, `invoice_payments`, bill payments |
| 5 | Trial Balance | E | A | account→ledger | V |
| 6 | Comparative Trial Balance | N | A, C | account→ledger | V (two as-of + movement) |
| 7 | General Ledger | E | R | journal entry | V |
| 8 | Account Transactions | E | R | journal entry | V |
| 9 | Journal Report (by source) | N | R | journal entry | Q `journal_entries` |
| 10 | Equity Movement | N | R | journal entry | V (equity + close entries) |
| 11 | Period Comparison | E | R, C | report | existing endpoint |
| 12 | FX Gains and Losses | E | R | journal entry | V |
| 13 | Budget vs Actual | E | R, C=budget | account | V + `budgets` |
| 14 | Cash Flow Forecast | E | R | document | Q |
| 15 | Cost Centre P&L | E | R, C | account | V + `cost_centers` |
| 16 | Management Roll-up (firm) | E | R, C | company | move server-side; add BS, eliminations |
| **Sales / receivables** | | | | | |
| 17 | A/R Aging summary | E | A | customer→detail | `receivableAgingAsOfSql` |
| 18 | Receivables Detail (open items) | N | A | invoice | Q (`aging-as-of.service.ts:69`) |
| 19 | Customer Balance Summary | E | A | customer | Q |
| 20 | Invoice Status | E | R | invoice | Q |
| 21 | Revenue by Customer | E | R, C | invoice | Q `invoices`+lines |
| 22 | Sales by Product/Service | E | R, C | invoice | Q |
| 23 | Payments Received | N | R | payment | Q `invoice_payments` |
| 24 | Credit Notes and Refunds | N | R | CN / refund | Q `invoices(credit_note)`, `credit_notes`, `customer_refunds` |
| 25 | Quotes Status and Conversion | N | R | quote | Q `quotes` |
| 26 | Recurring Invoice Schedule | N | R | template | Q `recurring_invoices` |
| 27 | Sales Orders Status **dep D1** | N | R | sales order | Q `sales_orders` |
| 28 | Customer Deposits unapplied **dep D1** | N | A | deposit | Q `customer_deposits` + 2040 tie |
| **Purchases / payables** | | | | | |
| 29 | A/P Aging summary | E | A | vendor→detail | `payableAgingAsOfSql` |
| 30 | Payables Detail (open items) | N | A | bill | Q `receipts` (bills) |
| 31 | Vendor Balance Summary | E | A | vendor | Q |
| 32 | Expenses by Vendor | E | R, C | bill | Q |
| 33 | Expenses by Category | E | R, C | account | V |
| 34 | Purchases by Vendor (net, VAT, count) | N | R, C | bill | Q |
| 35 | Purchases by Item | N | R, C | bill line | Q |
| 36 | Payments Made | N | R | payment | Q bill-pay payments |
| 37 | Purchase Orders Status | N | R | PO | Q `purchase_orders` |
| 38 | Vendor Credits | N | R | vendor credit | Q `vendor_credit_notes` + applications |
| 39 | Expense Claims | E | R | claim | Q |
| **Tax** | | | | | |
| 40 | VAT Return (201) | E | period | box→documents | existing |
| 41 | VAT Summary | E | R | box | existing |
| 42 | VAT Audit — Sales Detail | N | R | invoice | Q: supply lines with rate, emirate, TRN |
| 43 | VAT Audit — Purchases Detail | N | R | bill | Q: input VAT lines, recoverable flag |
| 44 | Corporate Tax Estimate | E | tax year | account | existing |
| 45 | CT Computation Workpaper | E (export only) | tax year | adjustment | surface `ct-workpaper-export.service.ts` in catalog |
| **Banking** | | | | | |
| 46 | Bank Reconciliation Statement | N | A | bank txn | Q: statement vs ledger, unreconciled |
| 47 | Unreconciled Bank Items | N | R | bank txn | Q `bank_transactions` |
| **Inventory** | | | | | |
| 48 | Inventory Valuation | E | A | item | existing |
| 49 | Inventory Movement | E | R | movement | existing |
| 50 | Inventory Summary (on hand) | N | A | item | Q `inventory_movements` |
| **Projects / people** | | | | | |
| 51 | Project Profitability **dep D2** | N | R | project | Q `projects`, `time_entries`, `billable_expenses` |
| 52 | Time Summary **dep D2** | N | R | time entry | Q |
| 53 | Unbilled Time and Expenses **dep D2** | N | A | entry | Q |
| 54 | Payroll Summary | E | run | payslip | existing |
| 55 | Payroll Register (per employee) | N | R | payslip | Q `payroll_items` |
| 56 | WPS / SIF Summary | E | run | payslip | existing |
| 57 | Leave Balances **dep D2** | N | A | employee | Q `leave_balances` |
| 58 | End-of-Service Provision **dep D2** | N | A | employee | Q + 2036 tie |
| **Assets** | | | | | |
| 59 | Fixed Asset Register | E | A | asset | existing |
| 60 | Depreciation Schedule | E | R | schedule | existing |
| 61 | Asset Disposals **dep D3** | N | R | asset | Q `fixed_assets` + disposal journal |
| **Close / control** | | | | | |
| 62 | Month-End Close Status | E | period | task | existing |
| 63 | Audit Trail | E | R | entity | `activity_logs` (company-scoped, §7) |

63 total; 56 without the seven dependent rows, so 55+ holds if D1-D3 slip. Comparison is one shared
helper applied only to C rows. Drill-down reuses the catalog `reportHref` pattern. The frozen-count test
(`tests/unit/report-catalog-routes.test.ts:124-126`) is updated in the same commit.

### Dashboard KPI definitions (document in `docs/KPI_DEFINITIONS.md`, one test each)

| KPI | Definition | Code today |
|---|---|---|
| Cash position | Σ balances of accounts where `isCashOrBankAccount` (1010/1020/1030 or subType cash/bank), now, AED | OK (`dashboard.routes.ts:125-137`) |
| Revenue, expenses, net profit | Σ income (Cr−Dr) and expense (Dr−Cr) for the **selected period** (MTD default, YTD toggle), excluding year-end close and CT accrual entries | **all-time** (`:140-147`); change |
| Receivables outstanding | Σ over issued/partial/overdue invoices, `invoiceType≠credit_note`, not void: `total − payments − live credit notes`, ≥0, AED | OK (`invoice-outstanding.ts:99`, `dashboard.routes.ts:190`) |
| Overdue receivables | Subset with `dueDate < today` (Asia/Dubai); missing dueDate → issue+30 and flagged in UI | add "current" bucket |
| AR / AP aging | Buckets by days past due: current, 1-30, 31-60, 61-90, 90+; same for both | AR lacks "current" (`:184-221`) |
| Payables outstanding | Σ over posted bills (`receipts`) not fully paid: `total − payments − applied vendor credits`; due from bill else date+30 flagged | uses "unposted receipts" (`:210-221`); reuse `billOutstandingAsOfSql` (`aging-as-of.service.ts:83`) |
| Monthly burn | Mean of last 3 completed Dubai months of expense accounts **excluding depreciation, CT expense, irrecoverable VAT (5160)** | includes all (`:111-121`); decide |
| Runway (months) | cash ÷ burn; null when burn ≤ 0 | OK |
| Revenue growth | (this month − last) ÷ last; null when last = 0 | OK |
| VAT due next | Net payable of the open VAT period from the 201, with due date (28th after period end) | add |
| Top expense categories | Top 5 expense accounts, selected period | OK |

## 3. Security and API standards

**TOTP (RFC 6238):** SHA-1, 6 digits, 30 s step, ±1 step, 160-bit secret, `otpauth://` QR; secret AES-256-GCM
under a server key env (reuse the `ecommerce-secrets-at-rest` pattern); enrol = generate → verify → enable →
audit; last-used counter refuses replay; 10 recovery codes, hashed (`server/config/bcrypt.ts` cost), single-use,
regenerable; login = password → 5-minute challenge token → code; 5 attempts/min; disable needs password + code;
company setting "require 2FA for owners/accountants". Tables `user_totp`, `user_recovery_codes`.

**Sessions:** `GET /api/auth/sessions` lists `refresh_sessions` (UA, IP, created, last used, current);
`DELETE .../:id` and `/others`; revoke all on password change, 2FA enable, deactivation; new-device email
(unknown UA+IP), silent when email is unconfigured. Keep the password policy (`auth.routes.ts:227`); add max
128 chars.

**API keys and v1:** reuse `api_keys` (`shared/schema.ts:1538`); add `scopes jsonb`, `expires_at`,
`rate_limit_per_minute`, `rate_limit_per_day`. Key `muh_<prefix>_<secret>`, shown once, SHA-256 at rest.
Scopes `read:*`/`write:*` for contacts, items, invoices, bills, payments, journals; `read:reports`;
`webhooks:manage`. `Authorization: Bearer`, no cookies/CSRF, separate `apiKeyAuth` middleware, key never exceeds
creator's role, every call audit-logged with key id. Per-key limit via `buildLimiter` keyed on key id, defaults
60/min and 5,000/day (`RL_APIKEY_*`), draft-7 `RateLimit-*` headers and `Retry-After` (house style). Store
stays in-memory (single instance); multi-instance → Postgres counter table, not Redis.
**Idempotency:** `Idempotency-Key` required on every v1 write; scope (key id, method, path); table
`api_idempotency_keys` with request hash and stored response, 24 h TTL; same key + different body → 422
`IDEMPOTENCY_KEY_REUSED`; in flight → 409; replay returns stored response with `Idempotent-Replayed: true`.
**OpenAPI 3.1** generated from zod (`zod-to-openapi`, free) at `/api/v1/openapi.json`; docs page from a bundled
Scalar/Redoc build; envelope `{success,data,error,meta}`; cursor pagination `limit≤200`; ISO-8601 dates; money
as 2-dp strings + currency.

**UAE PDPL (Decree-Law 45/2021) and FTA records:** PDPL grants access, rectification, erasure, portability;
breach notice to the UAE Data Office (timing per executive regulations — unsure). Tax Procedures Law: VAT
records 5 years after the period (real estate 15). **CT Law Art. 56: 7 years.** Code enforces 5
(`server/services/retention.service.ts:2`); set 7 for CT-registered companies (owner/legal confirm).
**Export** = ZIP of one CSV per entity + documents + `manifest.json` with SHA-256 per file, owner/accountant
only, async, link expires 24 h. **Deletion** = owner-only, re-auth (password + TOTP), 30-day soft period with
restore, then personal data anonymised while ledgers, invoices, filings and evidence stay read-only until
retention expires; purge job after; audit-logged; firm-managed companies also need firm-owner confirmation.

## 4. Acceptance criteria (for integration tests)

| # | Input | Expected |
|---|---|---|
| 1 | `GET /api/reports/catalog` | `liveReportCount ≥ 55`; every live entry has `href`, `params ⊆ {range,asOf,comparison}`, `drillTarget` |
| 2 | P&L for Jan, `compare=priorYear` | three columns; delta = current − prior; year-end close excluded |
| 3 | Comparative TB 31 Mar vs 31 Dec | opening, movement, closing per account; Σ Dr = Σ Cr in both |
| 4 | Invoice 1,050 (VAT 50), credit note 525, payment 525 | Receivables Detail 0 open; Credit Notes 525; Payments Received 525; dashboard outstanding 0 |
| 5 | Bill 2,100 approved 40 days ago, paid 1,000 | Payables Detail 1,100; AP bucket 1-30 = 1,100; dashboard `apAging` identical |
| 6 | Dashboard `period=month` | revenue equals P&L revenue for the same range; no all-time option |
| 7 | VAT Audit Sales, one quarter | rows = taxable + zero-rated + exempt lines; Σ VAT = box 1 of the 201 |
| 8 | Bank account, 3 unreconciled txns | ledger balance + unreconciled = statement balance |
| 9 | Any report `?format=csv|xlsx` | 200, correct MIME, Arabic headers when `lang=ar`, same rows as JSON |
| 10 | Schedule report weekly | run row created; email skipped with reason when unconfigured |
| 11 | `POST /api/auth/2fa/enrol`, verify valid code | 200 enabled; 10 recovery codes shown once; audit row |
| 12 | Login with password on 2FA user | 200 `{challenge}`; no access cookie until `/2fa/verify` |
| 13 | Replay same TOTP code | 401 `TOTP_REPLAYED` |
| 14 | Recovery code used twice | 200 then 401; count decremented |
| 15 | 6 wrong codes in a minute | 429 with `Retry-After` |
| 16 | Two browser sessions; delete the other | list of 2 with `current`; deleted one's refresh → 401 |
| 17 | Change password | all other sessions revoked, current kept |
| 18 | Key with `read:invoices` | secret shown once; `GET /api/v1/invoices` 200; `POST` 403 `SCOPE_MISSING`; `/contacts` 403 |
| 19 | 61 requests/min on one key | 61st → 429, `RateLimit-Remaining: 0`; second key unaffected |
| 20 | `POST /api/v1/invoices` twice, same `Idempotency-Key` | identical body + `Idempotent-Replayed: true`; one invoice |
| 21 | Same key, different body | 422 `IDEMPOTENCY_KEY_REUSED` |
| 22 | v1 write without key | 400 `IDEMPOTENCY_KEY_REQUIRED` |
| 23 | `GET /api/v1/openapi.json` | valid 3.1; every v1 route present; CI lints it |
| 24 | Revoked or expired key | 401 `API_KEY_INVALID`; audit row |
| 25 | `POST /api/companies/:id/export` as accountant | 202 job; ZIP has ≥ 15 CSVs, documents, manifest with matching SHA-256 |
| 26 | Same as employee | 403 |
| 27 | `DELETE /api/companies/:id` | 401 without re-auth; with password+TOTP → `deletedAt`, hidden, `restore` works for 30 days |
| 28 | After 30 days (mocked clock) | users/contacts anonymised; invoices and journals readable; `DELETE /api/invoices/:id` → 409 `RETENTION_NOT_EXPIRED` |
| 29 | Zoho contacts CSV with 2 bad rows | preview shows mapping + 2 errors; dry run creates nothing; commit creates N−2 |
| 30 | Help search "VAT" in `ar` | ≥ 1 article; every page's help link resolves |

## 5. Scope cuts and owner items

| Cut | Reason |
|---|---|
| Sales by salesperson | No field; only if D1 custom fields mark one as salesperson |
| Redis/Upstash for limits | Extra infra; in-memory per instance, Postgres counter if ever multi-instance |
| Native mobile apps | PWA + 375 px audit meets the bar |
| Arabic PDF for all 63 | Server PDF for 10 statutory ones (P&L, BS, TB, GL, VAT 201, AR/AP aging, cash flow, customer/vendor statements) via existing `pdf-*`; CSV/XLSX for the rest |
| Comparison everywhere | Only C rows in §2 |
| External help search | Client-side search over bundled markdown |
| OAuth2 for v1 | Scoped keys meet the bar |

Owner items: retention 7 vs 5 (legal); default 2FA enforcement for firm owners; PDPL contact/DPO text on the
Trust page; public API docs before launch; email provider key (new-device and export-ready mails are silent
without it).

## 6. Cross-stream dependencies (agree names before building)

| D4/D5 need | Owner | Tables / fields to agree |
|---|---|---|
| Sales Orders, Customer Deposits reports; v1 invoice discount/shipping | D1 | `sales_orders`, `sales_order_lines`, `customer_deposits`, `customer_deposit_applications`, `invoices.discount_amount`, shipping line flag, `price_lists`, `custom_fields`, `custom_field_values` |
| Project/time reports; approval state in Payables Detail | D2 | `projects`, `project_tasks`, `time_entries`, `billable_expenses`, `approval_rules`, `approval_requests` (status on `receipts`, `expense_claims`, `purchase_orders`, `journal_entries`, `payroll_runs`) |
| Leave, EOS, loans reports | D2 | `leave_types`, `leave_balances`, `leave_requests`, `eos_provisions`, `employee_loans`, `employee_loan_deductions` |
| Bank rec statement, unreconciled items, disposals | D3 | `bank_statement_imports`, `bank_reconciliations`, `bank_transactions.reconciled_at`, `fixed_assets.disposed_at/disposal_proceeds/disposal_journal_id` |
| v1 `contacts`; Purchases by Vendor | D1+D2 | **No vendor table**: bills carry `vendor_name` text (`shared/schema.ts:1283`); customers are `customer_contacts`. Decide unified `contacts` with `type` or a `vendors` table. D5 blocks on this |
| Reports over payroll, assets, claims, vendor credits | D2/D3 | `employees`, `payroll_runs`, `payroll_items`, `expense_claims`, `fixed_assets`, `depreciation_schedules`, `vendor_credit_notes`, `month_end_close` exist **only as SQL migrations**, not in `shared/schema.ts`; owning stream adds Drizzle definitions in its first migration |
| Dashboard AP | D2 | `receipts.due_date` (today derived as date+30) |

## 7. Corrections to the master plan

1. Plan says "33 live reports with Arabic PDFs"; code: 33 live, exports are client-side CSV/XLSX
   (`client/src/pages/Reports.tsx:11715-11771`), server PDFs only for documents (`server/services/pdf-*.ts`),
   jsPDF on 3 pages. Change to "33 live reports, CSV/XLSX; PDF on 3 pages".
2. Plan lists general ledger, account transactions, FX, inventory valuation, asset register, depreciation
   schedule, audit log, cash flow as new; all live (`reportCatalog.ts:1562-2000`). Replace with §2 N rows.
3. Plan says credit notes count as unpaid; already netted (`invoice-outstanding.ts:99`, `dashboard.routes.ts:190`).
   Real gaps: all-time revenue (`:140-147`), AP from unposted receipts (`:210-221`). Use the §2 KPI table.
4. Plan says password policy missing; exists (`auth.routes.ts:227-233`). Change to "extend".
5. Plan says session revocation missing; logout revokes both tokens (`auth.routes.ts:627-652`), `refresh_sessions`
   stores UA/IP (`shared/schema.ts:155-180`). Change to "session list + revoke others".
6. Plan says rate limiting absent; exists (`rateLimit.ts`, applied `security.ts:155-190`, env `RL_API_MAX`,
   `RL_READ_MAX`, `RL_AUTH_MAX`, `RL_AI_MAX`). Change D5 to "per-key limiter on top".
7. Plan says one integration test; 25 suites in `tests/integration` (24 in `npm run test:integration`, one
   vitest), 161 unit files. Fix the inventory line.
8. Plan says data export missing; JSON backup/restore exists (`backups.routes.ts:36-274`). Change to "extend
   backup into the ZIP export".
9. Plan says help centre missing; `HelpCenter.tsx` (5 guides, en/ar), `MigrationGuides.tsx`, `TrustSecurity.tsx`
   exist. Change to "article store, search, contextual links".
10. Plan D3 says depreciation may credit 1040; code credits `asset.accumulatedDepAccountId`
    (`depreciation.service.ts:133`) resolved to 1240 (`fixed-assets.routes.ts:843,968,1235`;
    `defaultChartOfAccounts.ts:134`). Drop the fix. Disposal posting exists (`depreciation.service.ts:193-225`);
    change to "verify route and UI".
11. Plan D4 says add SBR and 0/9% bands; exist (`corporate-tax.routes.ts:178-211`, `shared/ct-workpaper.ts:197`).
    Change to "test the AED 3m revenue threshold and election carry-forward".
12. Plan D4 says add firm consolidated P&L/BS; "Management Roll-up" is live (`reportCatalog.ts:1992-1999`,
    `Reports.tsx:3688`). Change to "server-side roll-up with BS and eliminations".
13. Plan names no audit table; `audit_logs` (`shared/schema.ts:3638`) lacks `company_id`, `activity_logs`
    (`:3920`) has it. Audit Trail and PDPL export read `activity_logs`.
14. Plan treats API keys as absent; table has `scopes` (`shared/schema.ts:1550`), issuance deliberately off
    (`api-keys.routes.ts:13-15`). Reuse it.
15. Plan says 5-year retention; CT Law Art. 56 says 7. Change to 7 pending owner/legal.
16. Plan assumes vendors exist; no vendor table (§6). Add the contacts decision to D1/D2.
17. Phase 4 notes: adding a catalog entry breaks the frozen count (`report-catalog-routes.test.ts:124-126`);
    D4 updates it in the same commit.

## Summary for the CTO

1. 33 live reports confirmed; 63 defined, 56 without D1-D3 dependents, so 55+ is safe.
2. Reports are CSV/XLSX today, not Arabic PDF; cut PDF to the 10 statutory ones.
3. Dashboard credit-note bug is already fixed; real KPI gaps are all-time revenue and AP aging.
4. Rate limiting, OAuth, password policy, refresh sessions, 5-year retention, backups and a help page exist; the plan undercounts us.
5. Net-new D5: TOTP + recovery codes, session list, API v1 with scopes/idempotency/OpenAPI, export ZIP, soft delete, migration wizard.
6. Retention should be 7 years (CT law), not 5 — owner/legal to confirm.
7. Blocking: no vendor table; D1/D2 choose unified contacts or vendors before D5's v1 contacts resource.
8. Seven tables exist only as SQL migrations; owning streams add Drizzle definitions before D4 queries them.
9. No paid services needed; Redis refused, in-memory limiter per instance is enough.
10. Thirty numbered acceptance criteria are ready for the Opus lead to turn into integration tests.

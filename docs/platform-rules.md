# Platform rules (ledger, reporting, tenancy, RBAC, FX)

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- Testing, guard and database-harness rules (`npm run test:db`, route matrix, `npm run check`
  guards and baselines) live in [testing-runtime.md](testing-runtime.md).
- Write routes should validate with `strictBody` (`server/http/strict-body.ts`, see its README)
  and shared primitives in `shared/validators/`; money math uses integer fils via
  `shared/money.ts`. Cross-workstream calls go through `server/platform/` (service registry,
  domain events, job registry).
- UI copy goes into namespaced catalogs `client/src/locales/{en,ar}/*.json` (used via `<T k>` /
  `t["ns.key"]`); use logical CSS properties for RTL. `node tests/e2e/a11y-crawl.mjs [--rtl]` runs
  the axe/keyboard crawl.
  Report catalog labels stay English in `reportCatalog.ts`; Arabic lives in the keyed overlay
  `client/src/locales/ar-catalog/reportCatalog.json` (`useCatalogText()` in
  `client/src/lib/reportCatalogText.ts`, coverage in `tests/unit/report-catalog-arabic.test.ts`).
  Every user-visible catalog field is listed in `client/src/lib/reportCatalogFields.ts` (key
  `reportCatalog.<kind>.<id>.<field path>`); comparison metrics are `reportCatalog.metric.<id>.*`;
  strings the report hooks generate at runtime live in `reportCatalogGenerated.ts` (exact UI text
  `reportCatalog.ui.*`, templated sentences `reportCatalog.pat.*`). Surfaces translate with
  `ct(kind, id, field, fallback)`, `ct.cx(english)` or `ct.deep(model)` (render side only: exports
  and API payloads stay English; raw enum values such as statuses are never translated by value).
  `node tests/e2e/report-catalog-arabic-probe.mjs` (BASE_URL) checks Reports Advanced tools,
  onboarding automations, Dashboard, command palette and mobile nav for English lines.
  `npm run e2e:arabic-runtime` (`tests/e2e/arabic-runtime-crawl.mjs`, BASE_URL) counts rendered
  English text nodes on the 22 launch routes in Arabic mode (target 0); the i18n ratchet also scans
  `client/src/lib` + `client/src/hooks` string properties (baseline 0, `i18n-ignore-file:` for non-UI
  files).
- After a merged build, refresh the bundle baseline with
  `node scripts/check-bundle-budget.mjs --update`.
- Every journal write goes through the ledger kernel in `server/ledger/` (frozen API in
  `index.ts`, rules in its README): `postJournal`, `reverseEntry` / `voidEntry` /
  `reverseBySource`, `withLedgerTx` (pass `ctx.tx` to post inside your own transaction). Exact fils
  balance, account/period guards, in-transaction numbering under `pg_advisory_xact_lock`,
  idempotency keys and one-reversal-per-entry live there. `storage.createJournalEntry` is a legacy
  adapter over the kernel; new code must not add call sites (ratchet
  `scripts/guard-baselines/ledger-writes.json`). Drafts are deleted only with `deleteDraft`
  (journal delete route, `safeDeleteInvoice` for draft credit notes); a document with posted
  entries answers 409 and must be voided or reversed. Reversed/voided originals keep `status = posted`;
  use `journalLifecycle` for the lifecycle. Year-end close posts through the kernel
  (`ledgerClosePostingPort`, kind `year_end_close`); FX revaluation posts kind `revaluation` with a
  linked next-day reversal; receipt post/revise use `postJournal` + `reverseBySource`.
- Firm A/R (portfolio, `/firm/overview`, command centre, bookkeeper dashboard) comes only from
  `server/reporting/firm-receivables.ts` (settlement fragments, grouped by company, base currency) and
  `server/services/firm/receivables.service.ts` (AED through `fx.convert` with the company id). Never
  sum `invoices.total` for a firm figure. Assigned staff come from `firm_staff_assignments`, never from
  `users.is_admin`. `GET /firm/clients` is a fixed number of grouped queries and returns an allow-listed
  column set (no WPS or IBAN fields); `GET /firm/client-links` is scoped like the client list; a client
  outside the caller's firm is a 404 through `denyClientAccess`.
- System journal text is a key, not English: an entry memo is `journalMemo(key, params)` and every
  system LINE description is `journalLine(key, params)` (`shared/journal-memo.ts`, columns
  `memo_key`/`memo_params` and `line_key`/`line_params`, migrations 0131/0132). Add the template
  and `journal.memo.line.<key>` in both catalogs; `shared/journal-memo-render.ts` renders it in
  the UI, the GL PDF and the Excel exports (old rows fall back to the pattern matcher). A stock
  line names its document with `docKind` + `ref`. `tests/unit/journal-memo-registry.test.ts`
  fails on a raw English `memo:` or line `description:` in server code.
- Draft journals are removed with the kernel's `deleteDraft(entryId, ctx)` (conditional on
  `status = 'draft'`, audited); never `DELETE FROM journal_entries` directly.
- Cash settlement seams are late-bound through `server/platform/service-registry.ts`:
  `invoices.recordPayment` / `invoices.reversePayment` (`server/services/invoice-payment.service.ts`)
  and `bills.recordPayment` / `bills.reversePayment` (`server/services/bill-payment.service.ts`;
  reverse = `voidBillPayment`). Both reverse functions take an optional `tx` so a caller can run
  them inside its own `withLedgerTx`. Do not call `storage.recordInvoicePayment` or write
  `invoice_payments` / `bill_payments` from other modules.
- Payment accounts (X5): a payment (bill, invoice, payroll, receipt) posts to a postable cash/bank
  leaf. With no account chosen the default is the primary bank account's GL
  (`server/services/payment-accounts.service.ts`: earliest active managed bank account,
  preferring the payment currency; 1010 for cash; 1020 only while it is a leaf). A managed bank
  account's auto-created GL (1021..) sits under 1020, which then becomes a header. The ledger
  kernel refuses postings to any header account (`ACCOUNT_IS_HEADER`; reversals may still
  mirror old postings). Legacy payments on 1020 or a header: `scripts/qa/repair-misposted-payments.ts`
  (read-only finder; `--apply` reverses and re-records through the settlement seams).
- Bank reconciliation state changes only through `server/services/bank-reconciliation.service.ts`:
  `applyMatch` (row lock, `is_reconciled` guard, period lock, idempotency key, allocations in
  `bank_transaction_matches`) and `unmatchTransaction` (reverses exactly what the match created:
  kernel reversal, payment reversal through the seams above, draft removal via `deleteDraft`).
  Verify with `tests/db/banking-reconciliation.test.ts`.
- Payroll lives in `server/services/payroll/` (`runs.ts` state machine calculate → approve → pay
  with kernel accrual/payment entries and unapprove/unpay reversals, `settlement.ts` final
  settlement, `wps.ts` + `server/services/wps-sif.service.ts` SIF generation/pre-validation,
  `leave.ts`, `payslip.ts`, `legal-params.ts`; legal defaults in `docs/payroll-legal-parameters.md`).
  Run status is server-owned; verify with `tests/db/payroll-runs.test.ts`.
- Vendors are a master table (`server/services/vendor.service.ts`, `/api/companies/:companyId/vendors`):
  bills resolve/link a vendor by TRN or name; statements and aging read it.
- `GET /api/companies/:companyId/invoices` is cursor-paginated by default
  (`{ items, nextCursor, limit }`, default 50, max 200; `status` also accepts derived `open` /
  `overdue`). Callers that aggregate over every invoice must pass `?all=true` (Dashboard, Reports,
  CreditNotes, BankReconciliation) and keep the `["/api/companies", id, "invoices"]` query key so
  invalidations still match. Invoices and BillPay read the dashboard drill-through `?status=`.
- Document numbers come only from `server/services/invoice-numbering.service.ts`
  (`allocateInvoiceNumber`, inside the document's insert transaction, so a failed save rolls the
  number back). Each doc type (`invoice`, `cash_sale`, `credit_note`, `debit_note`, `quote`) has
  its own per-company series and Settings › Numbering row; prefixes are unique across types.
  Cash sales (owner decision 2026-11-18) use the `cash_sale` series (default `CS`), never the
  tax-invoice one; cash sales from before migration 0130 kept their `INV-` numbers.
- Statements, trial balance, aging, cash flow and corporate-tax figures read the reporting kernel in
  `server/reporting/` (see its README); other ledger readers should use it or `NOT_CLOSING_SQL`.
- Tenant-owned rows are loaded with `server/tenancy` (`scopedGet` / `scopedUpdate` /
  `scopedDelete` / `requireOwned`): a row in another tenant is a 404, never a 403.
- Company roles are enforced centrally by `server/middleware/companyRolePolicy.ts`
  (`POLICY_RULES`, permissions in `shared/permissions.ts`), mounted on `/api` before every route
  module. Unlisted company-scoped requests need `reports.read` (reads) or `documents.write`
  (mutations); non-members naming a company get 403 `COMPANY_ACCESS_DENIED`, non-members
  addressing another tenant's row id get 404. Add a rule for new sensitive routes and add new
  row-id path prefixes to `RESOURCES`. `RBAC_ENFORCE=enforce` (default) | `report` | `off`; fix
  test fixtures by giving users the right `company_users.role`, never by turning enforcement off.
- Status and transition routes need the permission of what they do, not just `documents.write`:
  anything that writes or reverses journal entries (`PATCH /invoices/:id/status` issue/void,
  credit-note issue/void, invoice credit/debit notes, customer payments, customer-credit apply/
  refund, FX revaluation undo) is `ledger.post`, the same as `POST /invoices/:id/post`.
  Foreign ids in write payloads (account, product, contact, cost centre, vendor) are checked with
  `assertRefsOwned` (`server/tenancy`) at write time and answer 404 `<KIND>_NOT_FOUND`.
  `/portal/*` staff routes are outside the central policy and check the role themselves (viewers
  may list link metadata, `documents.write` mints/revokes). `GET /companies/:id/activity-logs`
  merges audit rows (IP, user agent, before/after), so it needs `settings.company`,
  `documents.approve` or `ledger.post`; viewers and employees get 403 like the audit-log API.
- UI gating: `useCompanyPermission()` (`client/src/hooks/useCompanyPermission.ts`) reads
  `GET /companies/:id/team/me` (built from `shared/permissions.ts`) and `gate(permission)` returns
  `disabled` + a tooltip for controls the role cannot use. Unknown access never hides a control
  (the server still refuses). A 403 list must render as "no access", never as empty data.
- `TRUST_PROXY_HOPS` (default 1, warning in production when unset) sets Express `trust proxy` for
  `req.ip` and per-IP rate limits; `true` is refused.
- One VAT jurisdiction: UAE (5% standard). Saudi ZATCA and the 15% KSA rate were removed in STEP2
  (migration 0133); do not reintroduce country-specific rates without an owner decision.
- FX rate convention: a row (X, Y, r) means 1 X = r Y; company rates are stored as (foreign, base)
  with `company_id` set (NULL = admin-only system row) and `rate_type` spot | closing | average.
  Migration 0094 assigns pre-0094 non-FTA rates to the company only when the database has exactly
  one company; on multi-company databases they are flagged `legacy_unscoped` and ignored by
  lookups (re-enter them per company), and inverted manual rows are rewritten to (foreign, AED)
  with `legacy_inverted = true` (`scripts/qa/find-inverted-rates.mjs` lists them).
- Accounting-firm features are NR-internal (the owner's own firm runs them). There is no public
  firm sign-up: the landing page has no "for accounting firms" section or anchor, and
  `POST /api/firms/apply` answers 403 `FIRM_SIGNUP_CLOSED` unless `FIRM_SELF_SIGNUP=true` is set for
  a supervised onboarding (tests that onboard a second firm set it explicitly; platform admins still
  approve each application). Firm users get `firm_role` from platform staff, never from `/register`.
- Free trial (owner decision): every new company gets a `TRIAL_DAYS` (14) free trial of all
  features, no card required (`shared/trial.ts`, with the end behaviour constant). The trial start
  is the company's subscription row `created_at` (existing companies count from their row), and
  `/billing/subscription` returns `trial { daysLeft, ended, ... }` for the free plan. Nothing is
  locked when it ends: the dashboard and subscription page show a trial banner ("X days left" /
  "Your trial has ended - contact us to choose a plan", mailto support@muhasib.ai), and monthly
  invoice/receipt/seat figures stay unenforced until the owner decides. The public "14-day free
  trial, no card required" claim must equal `TRIAL_DAYS` (tests/unit/trial-pricing.test.ts). Cost/abuse
  caps stay hard whatever `BILLING_ENFORCEMENT` says:
  AI credits (402 `USAGE_LIMIT_REACHED`), storage (402 `STORAGE_LIMIT_REACHED`, receipts images plus
  journal attachments) and companies per user (403 `COMPANY_LIMIT_REACHED`). They apply when
  `costCapsEnforced()` is true (`BILLING_ENFORCEMENT=true`, or production, or
  `COST_CAPS_ENFORCEMENT=true`); `COST_CAPS_ENFORCEMENT=false` switches them off for a dev database.
  Each code has Arabic copy in `forms.serverErrors.<CODE>`. While Stripe is not configured
  `/billing/subscription` returns `checkoutAvailable: false` and the app shows "Contact us to
  upgrade" (mailto support@muhasib.ai); checkout itself answers 503 `STRIPE_NOT_CONFIGURED`.
- Toasts: never pass an English literal to `toast({ title, description })`; use
  `translateNow("toasts.<key>")` (catalog `locales/{en,ar}/toasts.json`, or `shell.toast*` on public
  auth pages) and `formatMessage` for values. `tests/unit/x6b-first-hour-ux.test.ts` fails on a
  literal. Counted nouns use the ICU-style `{count, plural, one {# bill} other {# bills}}` form that
  `formatMessage` understands (Arabic has zero/one/two/few/many).

## Go-live (opening balances)

One model for every migrating company (D1, accounting re-audit 3: N1-N4, N7, N14).

- Every account with a sub-ledger is posted by that sub-ledger's own opening seam, each against
  Opening Balance Equity 3040 and each with `entry_kind = 'opening'`: open invoices / bills
  (A/R 1040, A/P 2010, documents mode), opening stock (1070), the asset register's opening import
  (PPE cost and accumulated depreciation, fixed-asset sub-type accounts) and the employees'
  opening gratuity provisions (2036, `server/services/payroll/opening-gratuity.ts`).
- The opening trial balance (`server/services/migration-import`) is one opening entry on the
  cut-over date. Its line for a sub-ledger account is checked against the sub-ledger and moved to
  3040 instead of being posted, so 3040 nets to zero once every opening document is in and
  nothing is counted twice whatever the order. Stock, assets and employees come first (the trial
  balance is refused when they differ); open invoices / bills may follow, and until they arrive
  the month-end checklist step `opening_balances` stays incomplete.
- Gratuity: the employee records are the one source. Saving an opening provision on the employee
  form books it at once; the seam posts only the difference between the employees' provisions and
  every opening entry on 2036 (whatever posted it), so a doubled 2036 is reversed, not repeated.
- PPE: the register carries it. After an opening trial balance is committed an opening register
  import is refused (409 `OPENING_TB_ALREADY_COMMITTED`); later assets are bought with a payment
  account or on a bill. Month end ties PPE on the GL to the register (`fixed_assets` tie).
- VAT: at a cut-over that ends a tax period the VAT balance belongs to a return filed outside
  Muhasib and is carried on 2040. With a cut-over inside a tax period, that period's pre-go-live
  VAT may stay on 2020 / 1050 (a `vat` control leg of the opening entry): the period's return
  reports it in the adjustment column and its settlement clears it, so 2020 / 1050 end at 0.
  A return adjustment (output / input correction, voluntary disclosure) has no GL side, so one
  for VAT from before the go-live date (a return period starting on or before the latest
  committed import cut-over, or correcting such a period) is refused (422
  `VAT_PRE_GO_LIVE_ADJUSTMENT`): VAT carried elsewhere (e.g. 2040) is moved onto 2020 / 1050 by
  a reasoned VAT journal dated in the open period, which the return reports as an adjustment.
- GRNI (2015) is written only by purchase-order receipts and their bills; a manual stock
  purchase names the account it was paid from (422 `COUNTER_ACCOUNT_REQUIRED`). Month end ties
  2015 to the receipts not yet billed (`grni` tie).
- Cash flow: opening entries (`OPENING_ENTRY_SQL` in `server/reporting/ledger-query.ts`) are not
  cash flows of any section (IAS 7.45). When go-live falls inside the period their cash is part
  of the opening cash (`openingPosition` on the statement) and their profit-or-loss lines are not
  in the indirect method's net income, so direct and indirect agree.

## Customer-facing error codes (G3)

- Every 4xx a customer can trigger carries a stable `code` (`DomainError`, or `{ message, code }`);
  no raw `{ message }` response in the customer route modules (`tests/unit/server-error-copy.test.ts`).
- Each code has a specific sentence in both languages: `serverErrors.<CODE>` in
  `client/src/locales/{en,ar}/serverErrors.json` (older codes: `forms.serverErrors.<CODE>`).
  The test scans `server/` and `shared/` and fails when a code has no en and ar copy; only
  machine-only codes (webhooks, provider callbacks) are listed as exempt, with a reason.
- `localizeApiError` (`client/src/lib/validation-messages.ts`) resolves it: Arabic always uses the
  catalog sentence; English uses it when the server only sent the generic words of the code
  (a `DomainError` without its own message). The status-based Arabic sentence is the last resort.
- Validation errors name each field by its form label (`serverErrors.field.<id>`), never the raw
  id; add a label when a new field can fail server validation.

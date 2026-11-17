# Platform rules (ledger, reporting, tenancy, RBAC, FX)

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- `npm run test:db` runs `tests/db/**/*.test.ts` against the real app and a freshly migrated
  Postgres database per test file (`useHarness()` in `tests/db/harness.ts`; only `harness_*`
  databases are created/dropped, PGlite fallback when `CREATE DATABASE` is not allowed). Use it
  for any persistence, posting, tenancy, or concurrency regression; name tests after issue ids.
  `tests/db/route-matrix.test.ts` is the cross-tenant route matrix; known gaps live as per-issue
  files in `tests/db/route-matrix-allow/`.
- `npm run check` ends with `scripts/run-guards.mjs`: `check-raw-body.mjs` (raw `req.body` in
  write routes), `check-ledger-writes.mjs` (direct journal writes outside the ledger service), and
  `check-i18n-ratchet.mjs` (hard-coded JSX strings). Baselines in `scripts/guard-baselines/` may
  only move down (`--update` after real progress).
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
  English text nodes on the 20 launch routes in Arabic mode (target 0); the i18n ratchet also scans
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
  `scripts/guard-baselines/ledger-writes.json`). Reversed/voided originals keep `status = posted`;
  use `journalLifecycle` for the lifecycle. Year-end close posts through the kernel
  (`ledgerClosePostingPort`, kind `year_end_close`); FX revaluation posts kind `revaluation` with a
  linked next-day reversal; receipt post/revise use `postJournal` + `reverseBySource`.
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
- `TRUST_PROXY_HOPS` (default 1, warning in production when unset) sets Express `trust proxy` for
  `req.ip` and per-IP rate limits; `true` is refused.
- FX rate convention: a row (X, Y, r) means 1 X = r Y; company rates are stored as (foreign, base)
  with `company_id` set (NULL = admin-only system row) and `rate_type` spot | closing | average.
  Migration 0094 assigns pre-0094 non-FTA rates to the company only when the database has exactly
  one company; on multi-company databases they are flagged `legacy_unscoped` and ignored by
  lookups (re-enter them per company), and inverted manual rows are rewritten to (foreign, AED)
  with `legacy_inverted = true` (`scripts/qa/find-inverted-rates.mjs` lists them).

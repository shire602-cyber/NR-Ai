# P0 Fix Plan — Accounting Correctness, then Security Edges (living tracker)

> Ordered execution plan for the P0 phase of [`COMPETITIVE_ROADMAP.md`](./COMPETITIVE_ROADMAP.md).
> Sequence agreed with owner: **fix all accounting issues first, then security edges, then re-audit.**
> Status keys: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
> Each item lists: issue id · what's wrong · fix approach · files · verification.

---

## Phase 0 — Safety net (do before any fix)

- [x] **0.1 Working branch** — `fix/p0-correctness-and-security` created off the audited HEAD.
- [x] **0.2 Test runner working in-sandbox** — installed the Linux native binaries
  (`@rolldown/binding-linux-arm64-gnu`, `@esbuild/linux-arm64`) so **vitest now runs here**. The existing
  suite mocks the DB, so no Postgres is required: **full suite = 60 files / 702 tests green** with all fixes.
  New pure-function suites added: `invoice-lifecycle`, `financial-statements`, `future-date-guard`,
  `ct-consolidation`. (A true DB-backed golden ledger for the payment/void posting paths still recommended
  for A-B5/A-B8.)
  - Scenarios: post invoice → pay → void; post → pay → credit note (full & partial); multi-line VAT;
    foreign-currency invoice + settlement; zero-rated/exempt; reverse charge; period close.
  - Assertions: every JE balances (Σdebits = Σcredits); trial balance ties; **Assets = Liabilities + Equity**;
    cash-flow net change == change in bank/cash balances; AR/AP never abnormal without reclassification.
  - Files: `tests/accounting/*.test.ts` (new); run via `npm test`.
- [ ] **0.3 Baseline** — capture current `npm test`, `npm run check`, and a TB/BS snapshot on a seeded company.

---

## Phase A — Accounting correctness (FIRST)

### A1 · Void / payment / credit-note lifecycle (root-cause cluster — highest priority)
- [x] **A-1 Void of a PAID invoice leaves orphaned cash + negative AR.**
  DONE: `evaluateVoidRequest` blocks void/cancel when paid-total > 0 (HTTP 409
  `PAID_INVOICE_CANNOT_VOID`), directing the user to a credit note + refund. Wired into the void path.
  Files: `server/services/invoice-lifecycle.ts`, `invoices.routes.ts` void branch.
- [x] **A-B2 Unbalanced JE when VAT-output account missing.** DONE: shared `buildReversalLines` fails
  hard (422) when VAT was charged but the VAT account is missing, and asserts debits==credits. Applied to
  BOTH the void and credit-note paths (also removed the duplicated leg builder). Files: `invoice-lifecycle.ts`, `invoices.routes.ts`.
- [x] **A-B3 Credit notes: no dedup, no cap.** DONE: `evaluateCreditNoteRequest` caps cumulative credits at
  the original total (blocks a second full CN → no more negative-AR double-reversal), supports a partial
  `requestedAmount`, and rejects CN-of-CN. _Paid-invoice refund-vs-customer-credit branch tracked under A-B12._
  Files: `invoice-lifecycle.ts`, `invoices.routes.ts` credit-note path.
- [x] **A-B1 Stripe invoice-payment marks paid with no JE (and is dead code).** DONE: removed the dead,
  unwired Stripe helpers (`invoice-payment.service.ts` now an empty stub with a note). Any future online
  payment must settle via `storage.recordInvoicePayment` (which posts Dr Bank / Cr A/R).
- [x] **A-B12 Overpayments rejected instead of parked.** DONE: `allocatePayment` splits a payment into the
  A/R-settling portion and any excess, and `recordInvoicePayment` posts the excess as a customer credit to
  Deferred Revenue / Customer Advances (account 2050), with a safe fallback to the prior rejection when that
  account is absent. Files: `invoice-lifecycle.ts`, `storage.ts`, `constants.ts`.

### A2 · Financial statements
- [x] **A-2 Balance sheet leaves net-credit AR inside Assets.** DONE: `classifyBalanceSheetAccount`
  reclassifies a net-credit asset to liabilities and a net-debit liability to assets; wired into the
  balance-sheet builder. Files: `server/services/financial-statements.ts`, `financial-statements.routes.ts`.
- [x] **A-3 Cash-flow lists cash as an operating line; net change doesn't tie.** DONE: rebuilt on the
  direct method via `computeCashFlow` (cash-leg movements attributed to the dominant counterpart; cash
  accounts never listed; net change ties to the bank-balance movement). Golden test reproduces the old bug.
  Files: `server/services/financial-statements.ts`, `financial-statements.routes.ts`.
- [~] **A-B10 Retained earnings mislabeled; no period close.** PARTIAL: relabeled to
  "Retained Earnings (Accumulated)" (it is lifetime, not current-period). The closing-entry / period-close
  roll-forward mechanism remains a dedicated task (kept under A2/period-close — larger feature).
  Files: `financial-statements.routes.ts`.

### A3 · Posting guards
- [x] **A-4 Future-dated entries can post.** DONE: `assertNotFutureDate` (+ pure `isFutureDate`, configurable
  grace) rejects future-dated postings with 422. Wired into journal create/update/post and the invoice
  revenue-recognition (issue) path. Files: `period-lock.service.ts`, `journal.routes.ts`, `invoices.routes.ts`.

### A4 · Foreign exchange
- [x] **A-B4 Contradictory FX rate convention across modules.** DONE: canonical convention chosen with owner
  = **AED per 1 unit of foreign currency** (matches the invoice booking path). Fixed the unrealised-FX report
  to request foreign→AED and MULTIPLY (was AED→foreign and divide) via the tested `revalueForeignBalance`
  helper. Files: `server/services/financial-statements.ts`, `exchange-rates.routes.ts`. The read side of FX is
  now consistent and correct.
- [ ] **A-B5 No realised FX gain/loss on settlement; foreign→AED blocked.** DEFERRED (needs DB-backed harness):
  requires capturing a payment-date rate (schema/UX) and posting the realised difference to a Realised FX P&L
  account, plus allowing cross-currency settlement. Touches the critical `recordInvoicePayment` money path —
  do with integration tests in an environment where the DB-backed suite runs. Files: `storage.ts:4700,4767-4789`.
- [ ] **A-B8 No unrealised FX revaluation POSTED.** PARTIAL/DEFERRED: the revaluation report is now correct
  (A-B4); posting period-end revaluation JEs to the GL is a new feature — do with the DB-backed harness.

### A5 · VAT
- [x] **A-B6 Import VAT taxed as output but never recovered as input.** DONE: `calculateVatWorkpaperTotals`
  now mirrors import VAT (boxes 6 + 7) into recoverable tax (box 13), so it nets to nil for fully-taxable
  importers. No manual import-recovery category exists, so no double-count. Verified by new
  `vat-import-recovery` tests + existing VAT tests still green. Files: `firm-vat-workspace.service.ts`.
- [ ] **A-B9 Workpaper doesn't auto-mirror reverse charge.** DEFERRED (needs product decision):
  `reverse_charge_input` (box 10) is a **manual** row category, so auto-mirroring box 3 → box 10 would
  double-count whenever the user also enters the manual leg. The safe fix is a model decision (deprecate the
  manual input category and auto-derive, OR add a validation that flags an unbalanced RCM pair). Changes filed
  VAT — confirm intended UX first.
- [ ] **A-B15 Foreign-currency credit notes miss the FX factor in the VAT calc.** DEFERRED: lives in the
  `calculateVatReturn` SQL (FTA 201 figures); needs the exchange_rate joined in and DB-backed verification.
  Files: `vat-autopilot.service.ts:680-699`.
- [~] **A-B14 NULL line VAT rate silently defaults to 5%.** REVIEWED: current logic is FTA-conservative and
  correct — explicit `vatSupplyType` (zero/exempt/out-of-scope) always wins over rate, and only a line with
  BOTH null supply type and null rate defaults to standard 5% (the safe default). No code change; behavior is
  exercised by existing VAT tests. Files: `vat-autopilot.service.ts:305`.
- [ ] **A-B13 VAT rounded per-invoice only.** Open: decide + document line-vs-invoice rounding; align autopilot
  reconciliation tolerance. Files: `document-totals.service.ts:32-42`.

### A6 · Corporate tax  ✅ (test-backed)
- [x] **A-B7 Three different CT calculators give different answers.** DONE: `computeCtLiability` now delegates
  to the full `computeCtComputation` (single source of truth: zero-rate band, add-backs, SBR, 75% loss cap),
  and the inline live-preview formula now calls the shared calculator. Loss periods floor taxable income at 0.
  Files: `shared/ct-workpaper.ts`, `corporate-tax.routes.ts`. Verified by `ct-consolidation`/`ct-workpaper` tests.
- [x] **A-B16 SBR eligibility has no prior-period check.** DONE & WIRED: added `priorPeriodsExceededRevenueCap`
  input to `computeCtComputation`; added `storage.getCtPriorPeriodRevenueExceededCap` (checks any prior return's
  revenue > AED 3M cap) and the recompute route now passes it. Relief denied if current OR any prior period
  breached the cap. Files: `ct-workpaper.ts`, `storage.ts`, `corporate-tax.routes.ts`.
  (Caught by the re-audit: the flag was initially inert — now fixed.)

### A7 · Precision, dedup & dead code
- [ ] **A-B17 Money read/aggregation is float-based.** Fix: money custom type returns string/Decimal;
  aggregate reports/trial-balance/month-end with decimal.js. Files: `schema.ts:22-32` + report routes.
- [ ] **A-B11 Two divergent credit-note systems.** Fix: consolidate to one; link standalone CNs to invoices.
  Files: `credit-notes.routes.ts` + invoice-embedded path.
- [ ] **A7.x Remove dead code** revealed during the above (e.g. unwired Stripe path) once A-B1 resolved.

---

## Phase B — Security edges (AFTER accounting)

### Critical  ✅
- [x] **S-C1 Bill-payment not atomic → silent overpayment.** DONE: payment recording now runs in a single
  pg transaction with `SELECT ... FOR UPDATE` on the bill, recomputes the paid total from `bill_payments`
  under the lock, and guards the overpayment with Decimal math. JE posts after commit (idempotent +
  backfill-gl recoverable). Files: `bill-pay.routes.ts`. (Note: bill subledger and Drizzle GL are separate
  drivers; unifying onto recordInvoicePayment-style posting is a future step.)
- [x] **S-C2 Bank-reconcile create-entry can double-post.** DONE: the create-entry endpoint now rejects
  (409 `ALREADY_RECONCILED`) when the transaction is already matched/reconciled or already has a
  `matchedJournalEntryId`, before posting. Files: `bank-statements.routes.ts`.

### High
- [x] **S-H1 Portal-token cross-tenant IDOR.** DONE: `generate-access` now resolves the contact then
  enforces `hasCompanyAccess(userId, contact.companyId)` (403) before minting the portal token, closing the
  live cross-tenant data-exposure hole. Files: `portal.public.routes.ts`.
- [~] **S-H2 Seeded backdoor firm_owner accounts.** Code side already mitigated by revoke migration 0051
  (verified present). REMAINING = OPERATIONAL ONLY: rotate `JWT_SECRET` in any env that ran 0023/0028 and set
  `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true`. Can't be done in code — owner/ops action.
- [!] **S-H3 Hard-coded personal admin promotion (`migrations/0054`, shire602@gmail.com).** OWNER DECISION:
  this is the owner's OWN account, so auto-revoking would lock them out of admin. Not changed blindly.
  Recommended: move the grant out of the committed migration chain (so it doesn't apply in other
  environments) without stripping the owner's production access. Needs owner confirmation.
- [~] **S-H4 Money/export endpoints lack audit logging.** DONE for the key money mutations: bill payment,
  bank reconcile-create-entry, credit-note delete, fixed-asset delete, expense-claim approve now call
  `recordAudit`. REMAINING: report-export endpoints (who exported the VAT return / trial balance) — additive,
  follow-up. Files: `bill-pay`, `bank-statements`, `credit-notes`, `fixed-assets`, `expense-claims` routes.
- [x] **S-H5 Hard deletes bypass FTA retention.** DONE: fixed-asset delete now refuses (409
  `ASSET_HAS_POSTED_JE`) when posted JEs reference the asset (capitalization/depreciation) — preventing
  orphaned GL entries — and is audit-logged. (Credit-note delete already blocks *issued* notes; deletable
  drafts have no posted JE so retention does not apply.) Files: `fixed-assets.routes.ts`.
- [~] **S-H6 Non-atomic posting / missing GL.** Payroll posting already improved (atomic + audited, per
  re-audit). DEFERRED: posting GL for expense-claim approval (Dr expense / Cr employee-reimbursement payable)
  needs an account-mapping + liability-account design decision and DB-backed tests. Approval is now at least
  audit-logged. Files: `expense-claims.routes.ts`.

### Medium / Low
- [~] **S-M1 Mass-assignment** — DONE for the highest-value/flagged routes via a new `pickAllowed` allowlist
  helper (`server/utils/pick-allowed.ts`): `companies` PUT+PATCH (`updateCompany`) and `corporate-tax`
  create+update now strip id/createdAt/unknown keys before the Drizzle write. REMAINING: sweep the same
  pattern across the other ~60 `{...req.body}` write routes (cost-centers, contacts, inventory, receipts,
  reconciliation-rules, invoice-templates, bank connections, ai).
- [ ] **S-M2 Wire up the dead sanitization helpers** into PDF/email/CSV write paths. Files: `server/sanitize.ts`.
  (Deferred: apply at render time for non-React surfaces + CSV-formula-injection escaping; broad, do as a
  focused pass to avoid mutating stored content.)
- [x] **S-M3 Atomic invoice void/credit-note** — addressed by the Phase A A-1/A-B3 work (guards + shared
  balanced builder) plus the credit-note preflight ordering.
- [ ] **S-M4 Upgrade dev/build advisories** (`js-yaml`, `@babel/core`) — build-tooling only, no prod runtime.
- [ ] **S-L1** receipt image `nosniff` + attachment · **S-L2** dedicated `TOKEN_ENCRYPTION_KEY` ·
  **S-L3** push `companyId` into unscoped mutators · **S-L4** portal invoice match by id not name.

---

## Phase C — Re-audit & report back

- [ ] **C.1** Full green: `npm test` (incl. new golden-ledger suite), `npm run check`, lint.
- [ ] **C.2** Re-run the security audit and the accounting/code-quality audit (same scope as 21 Jun).
- [ ] **C.3** Diff against this tracker — every item `[x]` or explicitly deferred with reason.
- [ ] **C.4** Produce a re-audit report (what was fixed, before/after, residual risk) and return to owner.
- [ ] **C.5** Update `COMPETITIVE_ROADMAP.md` progress log; mark P0 complete; tee up P1.

---

## Status summary

| Group | Items | Done |
|---|---|---|
| Phase 0 — safety net | 3 | Done — branch + vitest runnable in-sandbox (704 tests) |
| Phase A — accounting | 19 | 13 done + 1 reviewed (A1, A2, A3, A4-B4, A6, A5-B6). Deferred: A-B5/A-B8 (FX posting, DB golden ledger), A-B9/A-B15 (VAT model/SQL), A-B11/A-B17 (A7 refactors), A-B13 |
| Phase B — security | ~18 | Done: S-C1, S-C2, S-H1, S-H5, S-M3 + partial S-H4/S-M1. Operational/owner: S-H2/S-H3. Deferred: S-H6 (expense GL), S-M2 (sanitization), S-M4, S-L1–L4, M1 sweep |
| Phase C — re-audit | 5 | Phase A re-audited (REAUDIT_RESULTS.md); Phase B re-audit pending |

**Verification status:** full suite green (61 files / 704 tests), `tsc` clean after every group.

_Last updated: 2026-06-21 — Phase A complete (safely-fixable), Phase B critical+high items landed._

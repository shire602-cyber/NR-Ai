# P0 Fix Plan — Accounting Correctness, then Security Edges (living tracker)

> Ordered execution plan for the P0 phase of [`COMPETITIVE_ROADMAP.md`](./COMPETITIVE_ROADMAP.md).
> Sequence agreed with owner: **fix all accounting issues first, then security edges, then re-audit.**
> Status keys: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
> Each item lists: issue id · what's wrong · fix approach · files · verification.

---

## Phase 0 — Safety net (do before any fix)

- [x] **0.1 Working branch** — `fix/p0-correctness-and-security` created off the audited HEAD.
- [~] **0.2 Golden-ledger test suite** — started: pure-function lifecycle tests in
  `tests/unit/invoice-lifecycle.test.ts` (sandbox has no Postgres, so engine-level decisions are
  extracted into pure functions and tested there; full DB-backed golden ledger to follow).
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
- [ ] **A-B1 Stripe invoice-payment marks paid with no JE (and is dead code).** Fix: route through
  `storage.recordInvoicePayment` (Dr Bank / Cr AR + payment row) or delete the unwired module.
  Files: `invoice-payment.service.ts:90-95`.
- [ ] **A-B12 Overpayments rejected instead of parked.** Fix: post the excess to a customer-credit /
  advances liability. Files: `storage.ts:4721`.

### A2 · Financial statements
- [ ] **A-2 Balance sheet leaves net-credit AR inside Assets.** Fix: sign-based reclassification — a
  net-credit asset control → current liability ("customer credit balances"); symmetric net-debit AP → asset.
  Files: `financial-statements.routes.ts:214-223`.
- [ ] **A-3 Cash-flow lists cash as an operating line; net change doesn't tie.** Fix: rebuild on the
  already-correct engine in `reports.routes.ts:96-252` (cash-leg-only) and delete the broken duplicate.
  Files: `financial-statements.routes.ts:352-420`.
- [ ] **A-B10 Retained earnings mislabeled; no period close.** Fix: label lifetime vs current-period
  correctly; add a closing entry that rolls P&L into an equity account; prevent double-count.
  Files: `financial-statements.routes.ts:168-170,257`.

### A3 · Posting guards
- [ ] **A-4 Future-dated entries can post.** Fix: reject `date > today` (configurable grace) in journal +
  document posting paths. Files: `journal.routes.ts:78-206` and document-posting services.

### A4 · Foreign exchange
- [ ] **A-B4 Contradictory FX rate convention across modules.** Fix: pick ONE convention
  (AED-per-foreign), assert it everywhere, migrate stored values if needed.
  Files: `invoices.routes.ts:283-294`, `vat-autopilot.service.ts:268-272`, `exchange-rates.routes.ts:457-499`.
- [ ] **A-B5 No realised FX gain/loss on settlement; foreign→AED blocked.** Fix: re-translate AR/AP at
  payment-date rate, post the difference to a Realised FX P&L account; allow foreign-into-AED settlement.
  Files: `storage.ts:4700,4767-4789`.
- [ ] **A-B8 No unrealised FX revaluation posted.** Fix: period-end revaluation entry for open foreign AR/AP.
  Files: `exchange-rates.routes.ts:428-538`.

### A5 · VAT
- [ ] **A-B6 Import VAT taxed as output but never recovered as input.** Fix: carry recoverable import VAT
  into Box 10/11 so it nets to nil for fully-taxable importers. Files: `firm-vat-workspace.service.ts`.
- [ ] **A-B9 Workpaper doesn't auto-mirror reverse charge.** Fix: derive the paired RCM leg automatically.
  Files: `firm-vat-workspace.service.ts`.
- [ ] **A-B15 Foreign-currency credit notes miss the FX factor in the VAT calc.** Files: `vat-autopilot.service.ts:680-699`.
- [ ] **A-B14 NULL line VAT rate silently defaults to 5%.** Fix: require explicit supply type; default
  zero-rated/exempt safely. Files: `vat-autopilot.service.ts:305`.
- [ ] **A-B13 VAT rounded per-invoice only.** Decide + document line-vs-invoice rounding; align autopilot
  reconciliation tolerance. Files: `document-totals.service.ts:32-42`.

### A6 · Corporate tax
- [ ] **A-B7 Three different CT calculators give different answers.** Fix: route ALL paths (compute,
  xlsx-import, live preview) through the single full `computeCtComputation`.
  Files: `corporate-tax.routes.ts:491-507`, `ct-workpaper.ts`.
- [ ] **A-B16 SBR eligibility has no prior-period check.** Files: `ct-workpaper.ts:318`.

### A7 · Precision, dedup & dead code
- [ ] **A-B17 Money read/aggregation is float-based.** Fix: money custom type returns string/Decimal;
  aggregate reports/trial-balance/month-end with decimal.js. Files: `schema.ts:22-32` + report routes.
- [ ] **A-B11 Two divergent credit-note systems.** Fix: consolidate to one; link standalone CNs to invoices.
  Files: `credit-notes.routes.ts` + invoice-embedded path.
- [ ] **A7.x Remove dead code** revealed during the above (e.g. unwired Stripe path) once A-B1 resolved.

---

## Phase B — Security edges (AFTER accounting)

### Critical
- [ ] **S-C1 Bill-payment not atomic → silent overpayment.** Wrap insert+JE+update in one DB transaction;
  Decimal overpayment guard. Files: `bill-pay.routes.ts:546-638`.
- [ ] **S-C2 Bank-reconcile create-entry can double-post.** Reject if line already matched/reconciled;
  single transaction. Files: `bank-statements.routes.ts ~848`, `storage.ts ~2610`.

### High
- [ ] **S-H1 Portal-token cross-tenant IDOR.** Add `hasCompanyAccess(user, contact.companyId)` before
  minting the token; add `requireCustomer`. Files: `portal.public.routes.ts:18-48`.
- [ ] **S-H2 Seeded backdoor firm_owner accounts.** Confirm revoke migration 0051 ran in prod; rotate
  `JWT_SECRET`; set `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true`. Files: migrations 0023/0028/0051.
- [ ] **S-H3 Hard-coded personal admin promotion.** Move out of committed migrations into an
  environment-scoped runbook; revoke in prod. Files: `migrations/0054`.
- [ ] **S-H4 Money/export endpoints lack audit logging.** Add `recordAudit` to bill-pay, bank, credit-note,
  expense-claim, report-export, role-grant. Files: respective routes.
- [ ] **S-H5 Hard deletes bypass FTA retention.** Enforce `assertRetentionExpired` on credit-note &
  fixed-asset deletes; move financial documents to soft-delete. Files: `storage.ts:3312`, `fixed-assets.routes.ts:660`.
- [ ] **S-H6 Non-atomic posting / missing GL.** Wrap payroll + invoice-void in transactions; post GL for
  expense-claim approve/pay and the online-payment path. Files: `payroll.routes.ts:1080`, `expense-claims.routes.ts`.

### Medium / Low
- [ ] **S-M1 Mass-assignment** — `validate()` / allowlist on write routes, starting with `updateCompany`.
- [ ] **S-M2 Wire up the dead sanitization helpers** into PDF/email/CSV write paths. Files: `server/sanitize.ts`.
- [ ] **S-M3 Atomic invoice void/credit-note** (folds into A-1/A-B3 transaction work).
- [ ] **S-M4 Upgrade dev/build advisories** (`js-yaml`, `@babel/core`).
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
| Phase 0 — safety net | 3 | 0 |
| Phase A — accounting | 19 | 0 |
| Phase B — security | ~18 | 0 |
| Phase C — re-audit | 5 | 0 |

_Last updated: 2026-06-21 (plan created; awaiting go-ahead to begin implementation)._

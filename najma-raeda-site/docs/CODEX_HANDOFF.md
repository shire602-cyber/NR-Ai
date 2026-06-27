# Codex handoff prompt

Copy everything in the code block below into Codex.

```
You are working in the NR-Ai repo (Muhasib.ai / Netmara — a UAE accounting
platform: React/Vite client + Node/Express/TypeScript server + Drizzle/Postgres,
deployed on Railway). All work lives on the branch:

    fix/p0-correctness-and-security   (currently at commit 7e611ed, 14 commits)

This branch contains a completed accounting-correctness + security pass (P0) plus
an e-invoicing increment (P1). Full context is in docs/: FIX_PLAN.md (the master
checklist with per-item status), REAUDIT_RESULTS.md, EINVOICING_PLAN.md,
CREDIT_NOTE_CONSOLIDATION_PLAN.md, and COMPETITIVE_ROADMAP.md. Read FIX_PLAN.md
first — do NOT redo anything already marked [x].

Already done on this branch (do not repeat): void-of-paid-invoice guard, shared
balanced reversal builder, credit-note cap/dedup, overpayment→customer-credit,
balance-sheet abnormal-balance reclassification, direct-method cash flow,
future-date guard, FX convention (AED-per-foreign), corporate-tax calculator
consolidation + SBR prior-period, import-VAT recovery, expense-claim GL posting,
unrealised + realised FX posting, reverse-charge imbalance warning, the full
mass-assignment allowlist sweep, portal IDOR fix, atomic bill-pay,
bank-reconcile double-post guard, fixed-asset delete retention guard, audit
logging, e-invoicing PINT-AE hardening. JWT_SECRET was already rotated in
Railway. The test suite runs locally and is green (728 tests); `tsc` is clean.

YOUR TASKS, in order:

1. Sync to the remote.
   - `git status` should show a clean tree on fix/p0-correctness-and-security.
     The index may be stale (commits were made via a temp index); run
     `git reset` first if status looks odd, then verify the tree is clean.
   - `git push origin fix/p0-correctness-and-security`
   - Open a PR: fix/p0-correctness-and-security -> main. Title:
     "P0 accounting correctness + security; P1 e-invoicing increment".
     Summarise from FIX_PLAN.md.

2. Verify the branch is green before merge.
   - `npm install` (if needed), then `npm test`, `npm run check` (tsc +
     contract checks), and `npm run lint`. Fix any failures you introduce; do
     not weaken assertions. Report the results in the PR.

3. Implement A-B11 (credit-note consolidation) against a staging/real Postgres,
   following docs/CREDIT_NOTE_CONSOLIDATION_PLAN.md EXACTLY. Critical: the
   VAT-return double-/under-count hinges on step ordering — backfill the
   standalone `credit_notes` rows into invoice-embedded credit notes
   (invoiceType='credit_note') BEFORE removing the divergent credit-note
   subtraction query in vat-autopilot.service.ts, and ship both in the same
   release. Add the integration test from the plan: create a standalone CN, run
   the backfill, and assert the VAT-201 totals AND the trial balance are
   unchanged before vs after (no double/under count). This resolves A-B15 too.

4. Smoke-test A-B5 (realised FX) against the real DB: post a foreign-currency
   invoice, settle it from an AED bank account with a payment-date exchange rate
   via POST /api/companies/:id/invoices/:invoiceId/payments (body field
   `exchangeRate`), and assert the journal entry is balanced with Dr Bank at the
   payment rate, Cr A/R at the invoice rate, and the realised FX gain/loss leg
   on account 4090/5140. The leg math is already unit-tested in
   server/services/invoice-lifecycle.ts (buildPaymentJournalLines) — this is
   just a live wiring confirmation.

5. (Optional, low priority) A-B17 full: the `money` custom type returns a JS
   float; converting read-path aggregations repo-wide to decimal-safe sums is a
   larger change. Only do this if time allows; the balance-critical cash-flow
   sums already use the exact `sumMoney` helper.

CONSTRAINTS:
- Do NOT rotate secrets or change Railway settings (JWT already rotated).
- Preserve the documented conventions: exchange rate = AED per foreign unit;
  invoice-level VAT rounding (see document-totals.service.ts); idempotent GL
  postings keyed by source/sourceId.
- Every new accounting decision must be a balanced, tested journal entry; add
  pure-function unit tests for any new posting logic, matching the existing
  patterns in server/services/*.ts and tests/unit/*.test.ts.
- Run `npm test` + `npm run check` green before each commit.
```

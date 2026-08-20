# Muhasib — Fifth Teardown: Ten Blind Accountants

**Date:** 20 August 2026
**Method:** ten independent AI accountants, **zero knowledge of the codebase**, each given only public-style API docs and one business scenario. Each computed its client's VAT 201, trial balance, P&L and balance sheet **by hand first**, then drove a live production build on real Postgres and audited every figure the system returned. Plus a senior-bookkeeper root-cause pass on everything they flagged.
**This is the closest thing to Step 4 — a real accountant reconciling a real return — that software can simulate.**

---

## The verdict, before the fixes: **"WOULD NOT SIGN."**

Agent 10, simulating a full SME quarter close in Sharjah, refused to sign the filing — and was right to. The VAT 201 disagreed with Muhasib's own general ledger by **AED 35 against the taxpayer**. Four other agents found the same class of rot from different angles. That is the exact failure mode this product exists to prevent, found by an auditor who had never seen a line of the code.

## The verdict, after the fixes: all six money defects are fixed, verified live, and regression-proof.

**956 unit tests + 193 live integration assertions green**, including a new 15-assertion suite born directly from this audit (`tests/integration/accountant-fixes.test.mjs`). Committed as `0a170339`.

---

## The roast — what ten strangers found in one afternoon

### 🔴 Money defects (all six now FIXED and verified)

| # | Defect | Who found it | The damage | Fix |
|---|---|---|---|---|
| 1 | **Every uncategorised bill posted to "Loss on Asset Disposal."** The fallback expense code `5130` was chosen before that code meant disposal losses; nobody re-checked. | Agents 3, 9, 10 (independently) | A garage's parts and rent — 12,500 — presented as asset-disposal losses. Any banker reading that P&L walks away. | Fallback → `5000 General Expenses` |
| 2 | **Approved expense-claim VAT was in the GL but not the VAT 201.** Box 9/13 read receipts and bills, never claims. | Agents 3, 8, 10 — quantified identically | Recoverable input VAT permanently under-claimed; **the ledger could never reconcile to the filed return**. The one gap a design partner would hit on day one. | Claims now feed Box 9 exactly like bills |
| 3 | **Entertainment VAT was "recovered."** No Article 53 blocked-input-tax handling anywhere. | Agent 8 | Client-entertainment input VAT debited to the recoverable account — an FTA audit finding waiting to happen. | Entertainment-category VAT expensed gross, excluded from Box 9 |
| 4 | **Credit-note dates were silently ignored.** Every CN stamped "today," so a CN belonging to the quarter being filed could never enter it. | Agent 10 (their box1c was 500 high because of it) | Period VAT and P&L overstated whenever a return-period CN was entered after period end — which is *when accountants enter them*. | `date` honoured, validated, period-lock checked against it, JE posts same-date |
| 5 | **"Mark paid" on expense claims paid nobody.** The handler's own comment promised a cash JE; none existed. Liability lived forever. | Agents 3, 8 | Employee Reimbursements Payable accumulated eternally; cash never credited. | Settlement JE posted (Dr 2045 / Cr bank or cash), idempotent |
| 6 | **Cost centre without a code → HTTP 500.** Unvalidated NOT NULL column detonating in the database. | Agent 7 | Raw 500s from a routine form miss. | pg `23502` → clean 400, centrally |

### 🟠 Real, still open (ranked by how much I'd care as your accountant)

1. **Unit prices are silently mutated to 2dp on storage** (Agent 5): sell 3 × 33.333333 and the stored invoice says 3 × 33.33 = 99.99 while the totals say 100.00 — the invoice **fails its own arithmetic on its face**, and the VAT 201 recomputes from the mutated prices (0.02 drift from the GL in one afternoon of small invoices). Fix: store 4dp unit prices or derive the document from totals. This is a schema migration — do it before the design partner, because accountants check invoice faces.
2. **Backdated journals post silently** (Agent 7): a 2019-dated journal walked straight into retained earnings, no warning. Period locks exist but nothing is locked by default. Add a soft guard (warn/confirm) for entries dated before the current fiscal year.
3. **Payment dates aren't controllable** — marking an invoice paid or matching a bank line posts the JE on *today*, never the real payment date. Same disease as the credit-note bug you just fixed, next organ over.
4. **VAT 201 refuses any period ending in the future** (`PERIOD_IN_FUTURE`, found by 5 of 10 agents) while P&L happily accepts the same dates. Accountants preview the current period constantly. Allow draft generation of open periods, clearly watermarked.
5. **The legacy VAT payload fields lie** (Agents 2, 6, 9): `box3SalesTaxExempt` carries *zero-rated* sales, `box8TotalVat` and `box8TotalInputTax` disagree about what box 8 means. The canonical fields are right; kill or correct the legacy aliases before anyone integrates against them.
6. **All service revenue lands in "Product Sales"** (4 agents complained): no way to choose a revenue account on an invoice. Cosmetic in the ledger, embarrassing in front of an accountant.

### 🟡 Paper cuts the agents kept tripping on
Zero-rated lines stored as `vatSupplyType: "standard_rated"` (return is right, the data is wrong); bills/claims/employees mix snake_case and camelCase, and employees take camelCase in but return snake_case; POST status codes wobble between 200/201; matching the same bank deposit twice returns a 200 no-op while the sibling endpoint correctly 409s; unauthenticated writes return 403 CSRF instead of 401; float noise (`3428.3300000000017`) leaks into money fields; a zero-salary employee sails into payroll unchallenged; bill timestamps sit at prior-day 20:00 UTC (cosmetic today, a month-boundary trap tomorrow).

---

## What survived ten strangers trying to break the books — credit where due

Every single agent, every single run: **the trial balance balanced and A = L + E held.** Multi-emirate VAT attribution was exact (32,000 into the Abu Dhabi box, zero leakage into Dubai's). The credit-note engine took a partial, a capped full reversal, a CN-of-CN attempt and a fully-credited retry and got every one right to the fils. FX converted USD/EUR books to AED perfectly across invoices, bills, and all four statements. Bank reconciliation deduped re-imports, refused double postings, and left the unknown deposit unbooked — exactly right. Payroll posted salaries + gratuity provision to the correct payable accounts with zero VAT contamination. Corporate tax with Small Business Relief: flawless. And across ~400 API calls by ten hostile strangers: **one 5xx in the entire system** (the cost-centre one, now dead).

## Bottom line

Ten accountants who had never seen this system found six ways it would corrupt or misfile a return, and all six died the same day, each with a regression test standing on its grave. The engine underneath held every ledger invariant every time. Fix the open list — starting with unit-price precision — before your real design partner runs their real quarter, and item 1 of that list is the only one I'd block launch on.

*Full evidence: `/agents/1..10/report.md` + raw JSON logs, per scenario, in the session workspace. Fixes: commit `0a170339`.*

# Issue #3 Closed — The Eleven Blind Modules

**Date:** 13 August 2026
**Prediction:** "budget for finding 5–10 more defects — that has been the consistent rate."
**Actual: 6 defects found, 6 fixed, all verified.**

**117/117 integration assertions and 954 unit tests green** on a clean clone via the production build.

---

## Coverage before and after

| | Before | After |
|---|---|---|
| Modules with zero integration coverage | **11** | **0** |
| Integration suites | 3 | **4** |
| Integration assertions | 73 | **117** |
| CI guard scripts | 5 | **7** |

Now covered end to end, with ledger-integrity assertions after every GL-touching
operation: inventory, quotes, bills/AP, purchase orders, expense claims, cost
centres, budgets, recurring invoices, payroll/WPS, bank accounts, fixed assets.

---

## The six defects

### 1. CRITICAL — Every bill without a vendor TRN was silently treated as reverse charge

`server/routes/bill-pay.routes.ts`

```ts
const billReverseCharge = typeof reverse_charge === "boolean" ? reverse_charge : !vendor_trn;
```

Reverse charge defaulted **on** whenever the vendor's TRN field was blank. A
blank TRN overwhelmingly means "not typed in yet", not "foreign supplier".

Measured: a plain AED 1,000 + 50 VAT domestic bill was stored with
`reverse_charge: true` and `total_amount: 1000`.

Two simultaneous consequences, both silent:

- **The VAT return is wrong in both directions.** Output VAT is self-assessed
  into Box 3 and input VAT claimed in Box 10, instead of ordinary recoverable
  input VAT in Box 9. My test asserted Box 9 = 1,000 / VAT 50 and got **0 / 0**.
- **Accounts payable is understated by the VAT.** `total_amount` correctly
  excludes VAT *for reverse charge* — so the amount owed to the vendor was
  recorded as 1,000 instead of 1,050, and the vendor gets underpaid.

**Fix:** reverse charge is now **opt-in only**. A missing TRN raises an advisory
`VENDOR_TRN_MISSING` warning on the response instead of silently changing the tax
treatment. Regression asserts Box 9 = 1,000 and Box 9 VAT = 50.

### 2. HIGH — Route shadowing hid the validated bank-account handler

`POST /api/companies/:id/bank-accounts` was registered in **two** files.
Express matches the first, and `companies.routes.ts` registers before
`bank-statements.routes.ts` — so the stricter handler (UAE bank list, GL account
link) **never executed**. Bank accounts could be created with any `bankName` at all.

**Fix:** the duplicate is removed; the canonical validated handler is live and now
accepts `name` as an alias for `nameEn`. Added
**`scripts/check-route-shadowing.mjs`** to `npm run check` — it normalises param
names (`:id` and `:companyId` collide, because Express matches on position).

### 3. HIGH — Overselling produced negative stock

Selling 999 units of a product with 10 on hand returned **200** and left
`currentStock: -989`, which flows into inventory valuation and COGS as a negative
asset.

**Fix:** 422 `INSUFFICIENT_STOCK` reporting on-hand vs requested. Only an explicit
`adjustment` (a stock-take correction) may drive the balance negative.

### 4. MEDIUM — Negative movement quantities silently ignored

`{ type: "purchase", quantity: -50 }` returned 200. The handler applies
`Math.abs()` for purchase/sale/return, so "purchase −50" **increased** stock by 50.

**Fix:** quantity must be positive; direction comes from `type`. Only
`adjustment` accepts a signed quantity.

### 5. MEDIUM — The build was broken by cloud-sync conflict files

Eight untracked duplicates (`scheduler.service 3.ts` — 26 KB of binary garbage;
`db 2.ts` — a 1.6 KB stub of a 58 KB file; a duplicate `_journal 2.json` beside
the migration journal) sat inside tsconfig's globs. `npm run check` exited 2.

**Fix:** removed, plus **`scripts/check-no-stray-duplicates.mjs`** in
`npm run check`. **Move this repo out of the synced Desktop folder.**

### 6. LOW — Recurring invoices demanded a database column name

The API required `linesJson` — the raw storage column — while every other
document endpoint takes `lines`.

**Fix:** `lines` accepted as an alias.

---

## What held up under attack

Genuinely solid, tested and passing:

- **Quotes** — auto-numbered (`QT-2026-00001`), correct totals, double-conversion blocked, and correctly **do not** post revenue to the GL.
- **Purchase orders** — correctly a commitment, not a transaction: approving a PO does **not** touch the ledger.
- **Expense claims** — state machine holds; approve-before-submit refused.
- **Payroll** — employee → run → calculate → SIF → approve, posting a balanced salary journal entry.
- **Bills** — approval posts a balanced AP entry; overpayment refused.
- **Budgets, cost centres** — create, lines, variance and profitability reports all work.
- **Ledger integrity** — trial balance balanced and A = L + E after every single module.

---

## Verification

```bash
npm ci && npm run check     # 7 guards, all green
npm test                    # 954 unit
npm run build
node dist/migrate.js && npm start &
RL_API_MAX=100000 RL_READ_MAX=100000 \
  BASE_URL=http://127.0.0.1:5000 npm run test:integration   # 117 assertions
```

Result on a clean clone, 13 Aug 2026: check ✓ · 954 unit ✓ · build ✓ · migrate ✓ ·
boot ✓ · **18 + 47 + 9 + 43 = 117 integration assertions, 0 failures**.

---

## Where this leaves launch

Issue #3 is closed. Of the three launch blockers, **one is now done**:

| Blocker | Status |
|---|---|
| ~~Eleven modules with zero coverage~~ | ✅ **Closed** — all covered, 6 defects fixed |
| **No accredited ASP contract** | ❌ Still open. Code ready; needs a signature. 31 Mar 2027. |
| **No real return filed and reconciled** | ❌ Still open. Needs one accountant, one afternoon. |

The defect rate held exactly to prediction — 6 found in the modules that had no
tests, versus 0 regressions in the modules that did. That is the whole argument
for the test suite, demonstrated twice.

**The product surface is still untouched:** 113 client routes, 61 nav
destinations, a 21,779-line `Reports.tsx`. Correctness is now genuinely strong.
The product is still 113 screens built on a guess.

# Muhasib — Third Teardown & Launch Verdict

**Date:** 13 August 2026
**Method:** three roast→fix loops against a live server, real Postgres, real HTTP, production build.
**Result:** 9 new defects found, 9 fixed and verified. **73/73 integration assertions and 953 unit tests green.**

---

## The verdict on "ready for launch"

**No — and I can tell you precisely what is missing, because it is no longer the code.**

The engine is now genuinely sound. I attacked it with parallel writes, absurd inputs, cross-tenant injection and privilege escalation. The ledger held every time. What blocks launch is three things I cannot fix from a keyboard:

| Blocker | Why it blocks launch | Owner |
|---|---|---|
| **No accredited ASP contract** | You legally cannot transmit a UAE e-invoice without one. Adapter is written and tested; this is a signature. **<AED 50m filers must appoint by 31 Mar 2027.** | You |
| **No design partner has filed a real return** | Every figure is verified against fixtures I wrote. Nobody has reconciled a Muhasib VAT 201 against a return they actually filed. That is the only test that counts. | You + 1 accountant |
| **Eleven modules still have zero test coverage** | Payroll, inventory, bank rec, POs, bill-pay, budgets, expense claims, cost centres, recurring invoices, quotes, credit notes. I found a critical in credit notes in 20 minutes precisely because it was untested. | Engineering |

Everything else — correctness, concurrency, security, tax logic — is in materially better shape than most products that do launch.

---

## What three loops found and fixed

### Loop 1 — from the second teardown

| # | Defect | Fix | Proof |
|---|---|---|---|
| **C7** | **Partial credit notes silently became full ones.** Asking to credit 400 of a 1,050 invoice returned `201` for **1,050** — reversing all output VAT when only part was returned, **under-declaring VAT to the FTA**. The handler never read `req.body.lines`. | Read the lines, credit exactly those, cap at the remaining uncredited balance, recompute VAT. The existing `requestedAmount` cap was already built and simply never wired. | credits 400 not 1,000; over-credit → `409`; omitting lines still fully reverses |
| **C8** | Invoices could be **dated in the future** (2099 → `200`), pushing supplies into a VAT period that has not happened. | 422 `INVOICE_DATE_IN_FUTURE`, one day of timezone tolerance. | verified |
| **C9** | A large invoice **500'd** on numeric overflow instead of validating. | Per-line caps plus a document-total bound; clean 422. | verified |
| **C10** | **No Small Business Relief** — the one CT feature that applies to most UAE SMEs and that no competitor models. | Full eligibility + election model (MD 73/2023), reporting tax with and without relief. | eligible at 1m revenue; electing yields 0 |

### Loop 2 — the modules nobody had ever tested

| # | Defect | Fix |
|---|---|---|
| **C11** | **Creating a quote always failed with a 500.** `quotes.number` is NOT NULL and the route never set it — the UI only worked because it forces the user to type a number by hand. | Server-side allocation (`QT-2026-00001`); an explicit number is still honoured for imports. |
| **C12** | **You could depreciate an asset that was never capitalised.** Capitalisation only posts when `paymentAccountId` is supplied, so the register showed a 12,000 laptop while the balance sheet showed **assets 0, liabilities 333, equity −333**. | 422 `ASSET_NOT_CAPITALIZED` with the two legitimate remedies. No silent equity posting. |
| **C13** | **Accumulated Depreciation was presented as a liability.** A contra-asset normally carries a credit balance; reclassifying it overstated **both** assets and liabilities and hid net book value. 36,000 asset + 1,000 depreciation reported as assets 36,000 / liabilities 37,000. | Contra-asset accounts stay in assets as a negative. Now reports **net book value 35,000**. |

### Loop 3 — concurrency, where ledgers actually break

These are invisible to unit tests. They only appear when two requests interleave.

| # | Defect | Measured | Fix |
|---|---|---|---|
| **C14** | **Revenue recognised N times.** Marking one invoice "sent" 10× in parallel created **10 revenue journal entries** — revenue and output VAT overstated 10×. | 10 entries | Advisory lock per invoice around the idempotency check. |
| **C15** | **One invoice credited N times.** 5 parallel credit notes all passed the cap check and posted, driving A/R negative. | 5 accepted | Advisory lock per invoice around the cap. |
| **C16** | **Negative journal amounts accepted.** `debit: −100 / credit: −100` balanced arithmetically and silently inverted the entry. | `200 OK` | 422; also rejects a line carrying both a debit and a credit. |
| **C17** | **Privilege escalation.** Any customer could `PATCH` their own company to `companyType: "nra"` and self-promote into the firm tenant type. | `200`, type changed | `companyType` is admin-only; empty updates return the company unchanged instead of 500. |

### Also fixed
**The build was broken on arrival.** Eight cloud-sync conflict copies (`scheduler.service 3.ts` — 26 KB of binary garbage; `db 2.ts` — a truncated stub; a duplicate `_journal 2.json` beside the migration journal) sat inside tsconfig's globs and killed `tsc`. Removed, plus `scripts/check-no-stray-duplicates.mjs` in `npm run check`. **Move this repo out of the synced Desktop folder.**

---

## What held up under attack — genuinely

I tried to break these and could not:

- **Invoice numbering under load.** 20 parallel invoices → 20 unique, gap-free numbers. FTA Article 78 satisfied.
- **Payment races.** 10 parallel full payments → exactly one accepted, ledger balanced.
- **Corporate tax.** 1,000,000 profit → 56,250. The AED 375,000 threshold is correctly applied (the naive 90,000 would have been an easy bug).
- **Multi-currency settlement.** USD 1,000 at 3.6725 settled at 3.60 → A/R closes to exactly zero, realised FX absorbed.
- **Tenant isolation.** `companyId` body-injection did not land in the victim company; cross-tenant journal read blocked.
- **Rate limiting.** It locked *me* out mid-audit. Twice.
- **Unbalanced journals**, double-posting, double quote-conversion, expense-claim state machine — all correctly refused.

---

## Scoreboard

| Metric | Baseline (7 Aug) | Now | Target |
|---|---:|---:|---|
| Unit tests | 939 | **953** | — |
| Integration assertions | 0 | **73** | — |
| Integration suites | 0 | **4** | 2 ✓ |
| Float money columns | 63 | **0** ✓ | 0 |
| Unjournaled migrations | 8 | **0** ✓ | 0 |
| First-paint JS (gzip) | 602 KB | **328 KB** | 140 KB |
| Production dependencies | 108 | **95** | — |
| Total LOC | 219,217 | **212,004** | 90,000 |
| **Client routes** | 113 | **113** | **20** |
| **Nav destinations** | 61 | **61** | **12** |
| **Largest file** | 21,779 | **21,779** | **800** |

**Read the last three rows.** They have not moved in a week. The correctness work is close to done; the *product* work has not started.

---

## The honest gap to launch

**Correctness: ~90%.** Seventeen defects found and fixed across three teardowns. The remaining risk is concentrated in eleven untested modules — and every time I have pointed a test at an untested module, I have found a bug. Expect more.

**Product: ~30%.** 113 screens, 61 nav destinations, a 21,779-line file, zero customers. Every screen is still a guess.

**Compliance: blocked.** The code is ready. The contract is not signed.

**What I would do, in order:**

1. **Sign the ASP.** Only item with an external deadline. It is a phone call.
2. **Test the eleven blind modules.** Budget for finding 5–10 more defects — that has been the consistent rate.
3. **Have one real accountant file one real VAT return** with Muhasib and reconcile it. Until that happens, "the numbers are right" is a claim about my fixtures, not about the FTA.
4. **Then delete.** 113 → 20 routes. Not before — you would be deleting screens whose correctness you have not established.

**Say "almost ready to launch" when:** the ASP is signed, the eleven modules are covered, and one real return has been filed and reconciled. Not before. Everything else on the list is now done and proven.

---

## Reproduce every claim

```bash
npm ci && npm run check && npm test          # 953 unit
npm run build && node dist/migrate.js
RL_API_MAX=100000 RL_READ_MAX=100000 npm start &
BASE_URL=http://127.0.0.1:5000 npm run test:integration   # 73 assertions
npm run scoreboard
```

The raised rate limits are required for the concurrency suite — it deliberately fires ~50 writes in seconds, which trips the production budget. A 429 there means the limiter works.

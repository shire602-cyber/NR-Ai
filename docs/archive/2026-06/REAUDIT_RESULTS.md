# Re-Audit Results — Phase A (accounting correctness)

> Independent re-audit of the `fix/p0-correctness-and-security` working tree after the
> Phase A fixes. Two read-only auditor passes (accounting + security). Date: 2026-06-21.

## Headline

**The accounting core is now substantially sound.** All 12 targeted Phase A fixes were
verified as correctly implemented and properly wired. The full automated suite is green
(**61 files / 704 tests**) and the project type-checks cleanly. The re-audit found **one real
gap in the fixes (now closed)** and **no new tenant-isolation/auth regressions** from the edits.

## Fix verification (accounting auditor)

| Fix | Result |
|---|---|
| A-1 block void of paid invoice | ✅ Verified (`invoice-lifecycle.ts` `evaluateVoidRequest`, wired in void path) |
| A-B2 fail-hard on missing VAT account | ✅ Verified (shared `buildReversalLines`, both void + credit-note) |
| A-B3 credit-note cap/dedup | ✅ Verified (`evaluateCreditNoteRequest`, preflight before number allocation) |
| A-B1 dead Stripe path removed | ✅ Verified (neutralized stub, no callers) |
| A-B12 overpayment → customer credit | ✅ Verified (`allocatePayment` → Deferred Revenue 2050, balanced legs) |
| A-2 balance-sheet reclassification | ✅ Verified (`classifyBalanceSheetAccount`) |
| A-3 direct-method cash flow | ✅ Verified (`computeCashFlow`, ties to bank movement) |
| A-4 future-date guard | ✅ Verified (journal create/update/post + invoice issue) |
| A-B4 FX single convention | ✅ Verified (`revalueForeignBalance`, AED-per-foreign) |
| A-B7 one corporate-tax calculator | ✅ Verified (`computeCtLiability` delegates; preview uses shared calc) |
| A-B16 SBR prior-period rule | ⚠️→✅ Found inert, **now wired** (see below) |
| A-B6 import-VAT recovery | ✅ Verified (nets to nil; no double-count) |

## Findings from the re-audit

1. **A-B16 was implemented but inert (now fixed).** The `priorPeriodsExceededRevenueCap`
   flag existed on the pure computation but no route supplied it, so Small Business Relief
   could still be over-granted. **Closed:** added `storage.getCtPriorPeriodRevenueExceededCap`
   and wired it into the recompute route. (704 tests green, tsc clean after the fix.)

2. **Minor, pre-existing:** `postInvoiceRevenueJournal` skips the VAT leg if the VAT account
   is missing, surfacing as a generic 500 (balance is still protected by `assertBalanced`),
   whereas the void/credit-note paths now return a clean 422. Recommend routing revenue
   recognition through the shared balanced builder for parity. (Low; edge-case only.)

## Security re-audit

- **Baseline essentially unchanged** — all nine previously-reported items remain (expected;
  Phase B not started). **Three positive deltas** recorded: the seeded backdoor accounts are
  neutralized by migration 0051 on up-to-date DBs; payroll now posts an atomic GL entry with
  audit; and the broken JE-less Stripe handler was removed.
- **No new tenant-isolation or auth gaps** were introduced by the accounting edits. The new
  service modules are pure/side-effect-free; the touched routes retain `authMiddleware +
  requireCustomer + hasCompanyAccess`.
- Two items the auditor flagged while reviewing touched files (`corporate-tax` `{...req.body}`
  mass-assignment; unscoped global exchange-rate writes) are **pre-existing** and belong to
  Phase B (M1 / access-control hardening), not regressions from this work.

## Phase B (security) — re-audit

A focused security re-audit verified the Phase B critical+high fixes. **All sound; no new issues introduced.**

| Fix | Result |
|---|---|
| S-H1 portal-token IDOR (live cross-tenant exposure) | ✅ `hasCompanyAccess(contact.companyId)` before minting token |
| S-C1 bill-payment atomicity / overpayment | ✅ single pg txn + `SELECT … FOR UPDATE` + Decimal guard + rollback/release |
| S-C2 bank-reconcile double-post | ✅ 409 `ALREADY_RECONCILED` before posting; not bypassable |
| S-H5 fixed-asset delete orphaning posted JEs | ✅ 409 `ASSET_HAS_POSTED_JE`; audit-logged |
| S-H4 audit logging on money/export mutations | ✅ bill-pay, bank create-entry, credit-note delete, fixed-asset delete, expense approve |
| S-M1 mass-assignment | ✅ `pickAllowed` allowlist on companies + corporate-tax; tenant scope pinned |

Auditor confirmed: no broken transaction, no weakened auth, no dropped required field, guard ordering correct.

Confirmed still-open (documented, not regressions): S-H2 JWT rotation (operational), S-H3 shire602 admin
(owner's own account — owner decision), S-H6 expense-claim GL posting (deferred — design + DB tests),
S-M2 sanitization (deferred), broader M1 sweep across remaining routes.

## Status

Phase A correctness work is complete for everything safely fixable in this environment.
Phase B critical + high security items are complete and re-audited; medium/low and design/operational
items remain (documented in `FIX_PLAN.md`).
Remaining accounting items are deferred with documented reasons in `FIX_PLAN.md`
(A-B5/A-B8 FX posting → need DB-backed golden ledger; A-B9/A-B15 VAT → model/SQL decisions;
A-B11/A-B17 → broad refactors; A-B13 rounding). **Phase B (security edges)** has not started.

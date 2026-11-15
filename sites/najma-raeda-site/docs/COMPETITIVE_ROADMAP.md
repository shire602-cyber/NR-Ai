# Muhasib.ai / Netmara — Competitive Roadmap (living document)

> Strategic north star. Keep this fixed and revisit it after each phase of fixes.
> Source: independent technical audit + competitive research (21 Jun 2026).
> Companion tracker: [`FIX_PLAN.md`](./FIX_PLAN.md) (the detailed, ordered to-do list).

## Guiding principle

**Correctness and trust before features.** You cannot win a market on AI if the
balance sheet is wrong. Fix the books, then lock the compliance moat, then reach
parity, then differentiate.

## The strategic clock: FTA e-invoicing mandate

UAE has adopted a **Peppol 5-corner CTC model**. Structured XML (UBL / PINT-AE),
sent via an **Accredited Service Provider (ASP)** with a Peppol ID, reported to the FTA.

| Milestone | Date |
|---|---|
| Pilot programme | Jul 2026 |
| Mandatory — businesses > AED 50M | **1 Jan 2027** |
| Mandatory — SMEs (< AED 50M) | **1 Jul 2027** |
| Mandatory — government | Oct 2027 |
| Penalties | up to AED 5,000 / month |

Wafeq is an accredited ASP today; Zoho is an FTA Digital Tax Integrator; Mazeed
markets e-invoicing readiness. **Without an accredited path the product cannot be
sold to serious UAE businesses by 2027.** This is the highest-leverage investment.

## Competitive snapshot

| | Wafeq | Mazeed | Zoho Books | QuickBooks |
|---|---|---|---|---|
| Focus | UAE+KSA, GCC-built | UAE+KSA, AI + experts | UAE + global suite | Global incumbent |
| FTA e-invoicing | Accredited ASP, Peppol BIS 3.0 | Compliant, e-inv ready | Digital Tax Integrator (EmaraTax) | VAT yes; weak on UAE Peppol |
| VAT + Corp Tax | Both automated | Both, IFRS | Both, real-time checks | VAT strong; CT add-ons |
| Bilingual AR/EN | Yes | Yes | Yes | Partial |
| Pricing/mo | AED 53/125/291, unlimited users | Free Starter + tiers | ~from $15 (3 users) | Mid/high per tier |
| AI / automation | Limited | AI-native | Growing | Growing |

## Where we can win

- **AI-native bookkeeping** — only Mazeed is AI-native locally; the rest bolt AI on.
  The AI-CFO / agentic surfaces are a real wedge **once the books are correct**.
- **Accountant / firm cockpit** — command-centre, client portfolio, document-chasing
  are a credible play for the bookkeeping-firm channel that resells to SMEs.
- **Price + unlimited users** — match Wafeq's unlimited-users model, undercut Zoho's
  per-user creep.

## Phased roadmap

### P0 — Stop the bleeding (correctness & security) — weeks 0–6
Trustworthy books; no cross-tenant leak. **← we are here. See FIX_PLAN.md.**
- Void-of-paid-invoice, balance-sheet sign reclassification, cash-flow rebuild,
  future-date guard.
- Portal IDOR; atomic transactions for bill-pay / bank-reconcile / payroll / void.
- Remove backdoor & personal-admin migrations; rotate JWT secret.
- Golden-ledger test suite.

### P1 — Compliance moat — months 1–3
Ready before rivals' SMEs migrate.
- Begin FTA ASP / Peppol path + PINT-AE XML; direct EmaraTax VAT-201 filing.
- Audit logging on every money/export action; retention + soft-delete everywhere.
- Consolidate duplicates (one CT calc, one credit-note system, one cash-flow, one VAT engine).
- Fix import-VAT recovery & reverse-charge auto-mirror; decimal-ize report aggregation.

### P2 — Competitive parity — months 3–6
Feature parity with Wafeq / Zoho.
- Bank feeds / open banking (Lean, Tarabut) for auto-reconciliation.
- Correct multi-currency + realised/unrealised FX; inventory with COGS.
- Payroll + WPS/SIF end-to-end; 30+ report parity; period close + RE roll-forward; Arabic/RTL polish.

### P3 — Differentiate on AI — months 6–12
A reason to switch, not just match.
- AI-CFO / agentic bookkeeping: anomaly detection, auto-categorisation, document chasing,
  natural-language reporting.
- Accountant/firm multi-client cockpit; client portal.

## Progress log

| Date | Phase | Note |
|---|---|---|
| 2026-06-21 | — | Roadmap created from audit. Starting P0 fixes (see FIX_PLAN.md). |
| 2026-06-21 | P0 | Phase A (accounting correctness) largely complete: A1, A2, A3, A4-B4, A6, A5-B6. Test suite made runnable in-sandbox (704 tests green). Re-audit passed — see REAUDIT_RESULTS.md. Remaining A-items deferred (FX posting, VAT model/SQL, refactors). |
| 2026-06-21 | P0 | Phase B (security) critical+high landed: portal IDOR (S-H1), atomic bill-pay (S-C1), bank-reconcile double-post guard (S-C2), fixed-asset delete/retention (S-H5), audit logging (S-H4), mass-assignment allowlist (S-M1). Re-audited sound, no regressions. Operational/owner: JWT rotation (S-H2), shire602 admin (S-H3). Deferred: expense GL (S-H6), sanitization (S-M2), M1 sweep. **P0 substantially complete.** |
| 2026-06-21 | P1 | E-invoicing serializer/validation hardened (provider-independent, deadline-de-risking): PINT-AE profile constants (replacing generic EU IDs), credit notes now type 381 + BillingReference, currency validation. 707 tests green. See EINVOICING_PLAN.md for the prioritised remaining gaps (verify exact PINT-AE URNs, foreign-currency AED tax total, full CreditNote syntax, Peppol endpoint IDs, ASP adapter + sandbox — owner action). |

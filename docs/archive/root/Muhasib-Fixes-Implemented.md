# Muhasib — What Actually Changed

**Date:** 7–8 August 2026
**Companion documents:** `Muhasib-Teardown-2026-08-07.md` (what was wrong),
`Muhasib-Rebuild-Plan.md` (the plan), `Muhasib-Verification-Report.md` (proof).

This is the complete changelog. Read the verification report for evidence; read
this for what was touched and why.

---

## Start here

```bash
npm ci && npm run check && npm test && npm run build
node dist/migrate.js && node dist/index.js &          # needs DATABASE_URL
BASE_URL=http://127.0.0.1:5000 npm run test:integration
npm run scoreboard
```

Expected: `check` green, **939 unit**, **50 integration**, server answers
`/api/version`. See the scope note at the top of the verification report — one
small pair of edits was not covered by a final consolidated run.

---

## Round 1 — correctness

| Finding | Change | Files |
|---|---|---|
| **C5** app wouldn't boot from a clean checkout | restored the deleted scheduler | `server/services/scheduler.service.ts` |
| **C4** AED 100,000 accepted on a AED 1,050 invoice, parked in Deferred Revenue | over-balance payments now 422 `PAYMENT_EXCEEDS_BALANCE` unless `allowCredit: true` | `server/storage.ts`, `server/routes/invoices.routes.ts` |
| **C3** period lock 500'd, so `assertPeriodNotLocked` could never fire | migration reconciles `closing_entry_id` + unique constraint; runtime DDL removed | `migrations/0087_*.sql`, `server/services/month-end.service.ts` |
| **C2** 63 money columns were 4-byte floats (AED 9,999,999.99 → 10,000,000) | migration to `numeric`; **root cause was a migration that was never journaled** | `migrations/0086_*.sql`, `migrations/_orphaned/` |
| **C1** a VAT endpoint returned a confidently wrong figure | deleted (it had zero client callers) | `server/routes/reports.routes.ts` |
| **M1/M2/M3** fabricated testimonial, false Zoho comparison, e-invoicing claim | removed | `MuhasibLanding.tsx`, `Pricing.tsx` |
| **H4** VAT period 1900→2999 accepted | span/date/future validation | `server/routes/vat.routes.ts` |
| **H6** bank account creation 500'd on `{name}` | Zod-validated, `name` alias, 422 not 500 | `server/routes/companies.routes.ts` |
| **H7** malformed TRN accepted | 15-digit validation | `server/routes/contacts.routes.ts` |
| **D6/D7** 10 vulnerabilities; `tsc` OOM | `npm audit fix` → 1; heap pinned in CI | `package-lock.json`, `.github/workflows/ci.yml` |

## Round 2 — the remaining highs, and the honesty fixes

| Finding | Change | Files |
|---|---|---|
| **H1** emirate silently defaulted to Dubai — misfiling every non-Dubai company's Box 1 | `DEFAULT 'dubai'` dropped, `COALESCE` removed; VAT 201 and autopilot now **refuse** with `EMIRATE_NOT_SET` | `migrations/0088_*.sql`, `shared/schema.ts`, `vat.routes.ts`, `vat-autopilot.service.ts` |
| **H2** "submitted" implied filed with the FTA when nothing was sent | response now carries `filing.transmittedByMuhasib: false` and says so; an FTA reference promotes it to `filed` and is recorded; client wording changed to "Finalised for review — not yet filed" | `vat.routes.ts`, `VATFiling.tsx` |
| **H3** e-invoicing returned a fabricated acceptance from a mock | mock **throws in production**; endpoint returns 503 `EINVOICE_PROVIDER_NOT_CONFIGURED` | `einvoice-provider.ts`, `invoices.routes.ts` |
| **H8** `maxCompanies` declared everywhere, read nowhere — free tier bypassable | enforced per owning user at highest held tier; admins and firm users exempt | `featureGate.ts`, `companies.routes.ts` |
| **D3** read rate limit was 3000/min **per user** (the key is `ip:userId`) | lowered to 600/min | `middleware/rateLimit.ts` |
| **D4** CSP `style-src` couldn't be tightened without a browser test | tightened policy now ships as a **`Content-Security-Policy-Report-Only`** header — blocks nothing, reports what would break | `middleware/csp.ts`, `middleware/security.ts` |
| **ASP** e-invoicing needed an external contract | **adapter written**: full submit / poll / webhook flow, 11 unit tests. Going live is `EINVOICE_PROVIDER=http` + 2 credentials, no code change | `einvoice-provider-http.ts`, `.env.example` |

## Round 3 — a new bug, found by static review

**C6 — foreign-currency expense receipts were not converted to AED in the VAT 201.**

Found by reading the input-VAT path, which none of my tests covered (every
fixture had zero receipts, so Boxes 9–11 were always zero — a real gap in my own
testing).

`server/routes/vat.routes.ts` summed receipts at **document-currency face value**:

```js
let totalExpenses = ordinaryReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
```

while invoice lines (`* fxRate`) and vendor bills (`* COALESCE(exchange_rate,1)`)
were both correctly converted. `receipts.exchange_rate` exists and is populated.

**Impact:** a USD 1,000 receipt with USD 50 VAT at 3.6725 reported AED 1,000 of
expenses and AED 50 recoverable input VAT instead of **AED 3,672.50 and AED
183.63**. The business under-claims input VAT and **overpays the FTA** — roughly
3.67× on every foreign-currency expense.

**Fix:** apply the stored rate to both the expense base and the input VAT, for
ordinary and reverse-charge receipts alike. For AED receipts the rate is 1, so
the change is a no-op on existing domestic data.

**Test added:** `tests/integration/flow.test.mjs` now creates a USD receipt,
posts it, and asserts Box 9 = 3,672.50, Box 9 VAT = 183.63, Box 13 = 183.63.

> ⚠️ **This fix is not yet test-verified** — the verification sandbox was
> unavailable when it was made. The change is arithmetically a no-op for AED
> data, so regression risk is minimal, but **run `npm run test:integration`
> before shipping.**

## Round 2 — cleanup and tooling

- **Dead code removed:** 6 never-imported pages (incl. two entire alternative landing pages), 15 unused UI wrappers, 5 unused components, 1 orphaned i18n file, **13 dependencies**. ~7,900 lines.
- **Performance:** first-paint JS **2.01 MB → 1.13 MB raw / 602 KB → 328 KB gzip (−46%)** by descoping the eagerly-preloaded PDF vendors from `modulePreload`. They still load on demand.
- **Credit notes:** four permanently-disabled menu items removed, plus the three now-unreferenced mutations and three unused icon imports behind them.
- **New tooling:** `npm run scoreboard`, `npm run audit:i18n`, `scripts/check-money-types.mjs`, `scripts/check-migration-journal.mjs` (the last two wired into `npm run check`).
- **CI:** new `boot-and-fixes` job — clean-DB migrate → build → boot → `/api/version` → integration tests.

---

## Three plan items deliberately NOT done — my plan was wrong

Verifying them showed the proposed change would cause harm:

1. **"Delete the five 410 credit-note routes."** A `410 Gone` with an explanation is *correct* deprecation; deleting them yields a less useful `404`. **Kept.** The real defect was the dead UI behind them — that's what got removed.
2. **"`POST /invoices/:id/post` always fails."** It has a working repair path. **Kept**, with a comment clarifying it is a repair endpoint, not the issue path.
3. **"`ClientDashboard.tsx` is orphaned."** `Dashboard.tsx:97` renders it for client users. **Kept.**

Two source-scanning unit tests referenced the deleted dead landing pages and were
repointed at the live `MuhasibLanding.tsx` — they had been guarding a page nobody shipped.

---

## Still open, honestly

| Item | Why |
|---|---|
| **Sign an accredited ASP** | Commercial, not technical. All code is done. **Deadline: 31 Mar 2027 for <AED 50m filers.** |
| **Promote the CSP report-only policy** | Needs a week of production logs showing zero `style-src-elem` violations, then flip it. Runbook in `csp.ts`. |
| **The Great Deletion to 12 screens** | Dead code is gone; the rest means removing *working* features. You chose "keep both, SME first" — a product decision. |
| **Full Arabic translation** | Gate shipped (`npm run audit:i18n`: 49/111 pages). Pointless before the screen count drops. |
| **Reconcile VAT against a real filed return** | The tests prove internal consistency and GL agreement — not that every FTA edge case (reverse charge, partial exemption, imports) is complete. **Do this before real customers file.** |

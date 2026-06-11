# Launch-Readiness Report — Muhasib.ai

_Generated 2026-06-11 against `main`. This is the automated-proof gate from
the "UAE-First" development plan: every claim below is backed by a command
that runs in CI or locally, not by assertion._

## Release gates (all green)

| Gate                                     | Command                    | Status                                                     |
| ---------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Typecheck + bundle/route/contract guards | `npm run check`            | ✅ tsc clean; 70 route modules registered; 7 API contracts |
| Unit tests                               | `npm test`                 | ✅ 552 tests / 39 files                                    |
| Production build                         | `npm run build`            | ✅                                                         |
| Lint                                     | `npm run lint`             | ✅ 0 errors                                                |
| Format                                   | `npm run format:check`     | ✅                                                         |
| Migration hygiene                        | `npm run check:migrations` | ✅                                                         |
| Dependency audit                         | `npm audit --omit=dev`     | ✅ 0 vulnerabilities                                       |
| Browser E2E                              | `npm run e2e`              | ✅ 78 routes + 14 flows + matrix + RTL, 0 failures         |

## Plan acceptance criteria → proof

| Criterion                                                                                             | Proof                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trust blockers fixed (audit, notification scoping, reset email, CORS, secret encryption, lint/format) | PR #49; `tests/unit/trust-blockers.test.ts`, `ecommerce-secrets-at-rest.test.ts`                                                                                                                                               |
| Normal SaaS customer cannot see or call NRA Center                                                    | PR #50; persona matrix in `tests/unit/nra-access.test.ts` (401/403 for anonymous/customer/portal), E2E URL-guessing probes on 5 NRA/admin endpoints as `client` and `client_portal` users                                      |
| NRA staff manage only allowed client companies                                                        | `getAccessibleCompanyIds` (firm_admin → assigned only; `[]` for non-firm roles); covered by firm E2E flows                                                                                                                     |
| Seeded accounting fixtures produce deterministic reports                                              | VAT: `vat-autopilot.test.ts` (boxes, partial exemption, stagger); CT: `ct-bridge.test.ts` (9 fixtures: disallowables, SBR, 75% loss cap — hand-computed expected values); e-invoice: `einvoice.test.ts`, `einvoice-qr.test.ts` |
| Locked periods respected by VAT/CT/journal/AI posting                                                 | `assertPeriodNotLocked` call sites + E2E month-end flow                                                                                                                                                                        |
| AI cannot mutate books without approval/audit                                                         | PR #52; autopilot threshold floor 0.8, draft-only AI GL queue, `ai_autopost_receipt` audit rows (`receipt-autopilot.test.ts`, 33 tests)                                                                                        |
| Unpaid plan cannot access paid endpoints by changing frontend state                                   | `tests/unit/billing-enforcement.test.ts` — server-side 403 TIER_LOCKED with `BILLING_ENFORCEMENT=true`; gates mounted in 10+ route modules                                                                                     |
| Provider-less bank environments show manual import only                                               | Open-banking adapter reports unconfigured; manual statement import is the fallback path                                                                                                                                        |
| Trust documentation                                                                                   | `docs/TRUST.md` (security, retention, backup proof, audit coverage, incident checklist)                                                                                                                                        |
| No real-company data used                                                                             | All tests run against freshly seeded fixtures; E2E registers throwaway accounts per run                                                                                                                                        |

## What remains before public launch (owner inputs, not code)

1. **Email** — paste `RESEND_API_KEY` (or `SMTP_*`). Activates password
   reset, invoice send, payment chasing instantly.
2. **Stripe** — keys + 8 price IDs, test a checkout, then flip
   `BILLING_ENFORCEMENT=true` **last**. Enforcement behavior is already
   tested.
3. **Bank feed provider** — choose Tarabut / Dapi / Salt Edge / FINX,
   paste sandbox creds; adapter + sync pipeline are ready.
4. **Push** — `npx web-push generate-vapid-keys`, paste both keys.
5. **Domain** — buy, point DNS at Railway, set `FRONTEND_URL` (now also
   feeds CORS and password-reset links).
6. **Live ASP/FTA e-invoicing provider** — when UAE accreditation lists
   firm up; XML generation/validation is ready and marked "not connected".

## Competitive claim discipline

The defensible claim remains: **strongest UAE-first workflow coverage**
(FTA VAT 201 box engine with workpapers and drilldown, CT bridge with SBR
and loss carryforward, PINT AE e-invoice readiness, Arabic/RTL throughout,
firm NRA Center, WhatsApp chasing, AI close with guardrails) — verified by
this repo's own test suite. Claims of global feature parity with Digits,
Wafeq, Zoho Books, QuickBooks, or Xero are **not** made: those require
third-party benchmarking, live bank feeds, and a billing track record.

## Pilot protocol (when the owner starts real-company testing)

1. All gates above green on the release commit.
2. Create the pilot company under a fresh account; enable autopilot only
   after the first 20 receipts are reviewed manually.
3. Daily backup + restore drill during week 1 (`/api/backups` flow).
4. Review audit logs and AI inbox weekly with the client.
5. File the first VAT return in parallel run (Muhasib + incumbent tool)
   for one period before switching over.

# Muhasib.ai — Verification Evidence Pack

_Last updated: 2026-06-11. Regenerate the claims below whenever the test
suite changes; every claim must stay machine-checkable._

## Purpose

This document compiles what is **provably true** about Muhasib.ai — the
evidence an accountant, investor, or accreditation reviewer can check —
and explicitly lists what is **not yet certified**. Claims beyond this
document are marketing until evidenced.

## 1. Continuous verification gate (every pull request)

Repository: `shire602-cyber/NR-Ai`. CI workflow: `.github/workflows/ci.yml`.
No change merges to production without all three checks passing:

| Check                          | Contents                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck · Test · Build       | `tsc` strict; **502 vitest unit tests**; bundle-hygiene, route-registration, and API-contract scripts; production build                                                                                                                                                                                                                                           |
| Browser E2E · full route crawl | Headless Chromium against a fresh Postgres 16: **74 workspace routes** (firm-owner admin), **12 business flows**, **12-route account-type matrix** (`client` and `client_portal` users in isolated contexts), **5-route Arabic/RTL smoke**. JS errors, error screens, blank pages, bad redirects, or untolerated 4xx/5xx fail the build with screenshot artifacts |
| GitGuardian                    | Secret scanning                                                                                                                                                                                                                                                                                                                                                   |

Evidence: the Actions tab of the repository — every merged PR (#30–#44)
shows these checks green.

## 2. Functional correctness claims (with their tests)

| Claim                                                      | Evidence                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-entry balance is enforced (debits = credits)        | Server rejects unbalanced entries; E2E flow posts a balanced entry and asserts it renders in the ledger UI                                              |
| Journal entry numbering is atomic and collision-free       | `::int` casts on the SUBSTRING position (a regex-form trap that previously numbered every entry `-001`); E2E posts ≥2 entries on the same day every run |
| Credit notes post correct reversing entries                | E2E issues a credit note and asserts `journalEntryId` linkage; account resolution by stable `ACCOUNT_CODES`                                             |
| VAT 201 box math derives from approved workpaper rows only | Unit tests on `calculateVatWorkpaperTotals`; E2E bulk-approves drafts and asserts Box 8/Box 11 VAT totals                                               |
| UAE corporate-tax computation (AED 375,000 threshold, 9%)  | Unit tests incl. threshold edge cases; E2E pulls a schedule from posted entries                                                                         |
| Excel round-trips are lossless                             | Template→parser round-trip tests for both VAT and CT workpapers                                                                                         |
| Bank statement import → reconciliation chain works         | E2E imports a 3-row CSV and asserts a rule auto-matches                                                                                                 |
| FTA 5-year retention is enforced                           | Deleting a journal entry inside the window is refused (verified during E2E development)                                                                 |
| Backups restore real data                                  | E2E: create marker account → backup → delete → restore → marker recovered; restore is checksum-verified and transactional                               |
| Secrets at rest                                            | Bank tokens AES-256-GCM encrypted (`secret-vault.ts`); tamper-rejection unit-tested                                                                     |
| Session resilience                                         | Rate-limit/network blips never log users out (only a definitive 401 does); tiered API limits                                                            |
| Bilingual operation                                        | RTL smoke asserts `dir=rtl` + error-free rendering on key routes in Arabic                                                                              |

## 3. Known limitations — NOT certified

- **No third-party certification**: no licensed-accountant sign-off on tax
  outputs, no FTA Tax Accounting Software accreditation, no IFRS review,
  no security audit / penetration test.
- **No production track record**: no uptime history, no error-rate
  monitoring (Sentry not wired), no pilot customers.
- **Billing not deployed** (Stripe pending); tier gates intentionally fail
  open (`BILLING_ENFORCEMENT` flag).
- **Bank feeds are statement-import only** until an open-banking provider
  credential exists; the connect/sync API is built and tested but not
  exercised against a live provider.
- **E-invoicing (UAE e-billing mandate) not implemented** — see
  `docs/EINVOICING_PLAN.md`.
- **Email delivery unconfigured** — flows that send mail are built but
  have no provider.
- Restore semantics are **recovery** (re-insert missing rows), not
  point-in-time rollback; rows modified after the backup keep their
  current values.
- ~400 legacy lint warnings (mostly unused symbols) remain app-wide.

## 4. How to re-verify locally

```
npm ci && npm run check && npm test && npm run build
# E2E (needs Postgres + a running server):
npx tsx server/migrate.ts && npm run dev &
npx playwright-core install chromium
DATABASE_URL=... npm run e2e
```

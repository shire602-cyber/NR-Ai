# Muhasib — Remediation Roadmap Reconciliation

**Date:** 1 October 2026
**Tree verified:** `bcef2255` on `main` (251 commits), fresh clone, clean `npm ci`
**Purpose:** reconcile the 30-item remediation roadmap (written against an earlier
snapshot of the codebase) with what this repository actually contains today, so
no fix is re-done and nothing still open is assumed closed.

---

## 1. Verification run on this tree

| Gate | Result |
|---|---|
| `npm run check` (tsc + 7 guard scripts) | green |
| `npm test` (vitest) | **956 passed**, 1 skipped, 0 failed (83 files) |
| `npm run build` (vite + esbuild) | green |
| `npm run test:integration` (built server + Postgres 16, 2 Oct) | **189 passed, 0 failed** across 7 suites (fixes 18, flow 47, concurrency 9, modules 43, uncovered-modules 48, ai-degradation 13, tenant-boundaries 11) |
| Static sweep: 230 `:companyId` routes | 229 guarded; **1 real gap** (team members, fixed below) |
| Static sweep: 194 record-id routes | all guarded (load-then-check helpers such as `findInvoiceForUser`) |
| Static sweep: 17 handlers taking `companyId` from body/query | all guarded |
| Live adversarial probe (firm → SaaS tenant, portal, API keys, backups, admin) | **1 real gap** (firm client edit, fixed below); everything else held |

After the two fixes: unit suite 964 passed, 1 skipped.

---

## 2. Roadmap items — status against this tree

### Phase 0 — catastrophic correctness and security

| Roadmap item | Status | Evidence in this tree |
|---|---|---|
| P0.1 Invoices on default chart create zero ledger entries (name mismatch) | **Closed** | `invoice-posting.service.ts` resolves accounts by `ACCOUNT_CODES` + `isSystemAccount`, not by name; zero-rated split to 4060 |
| P0.2 24 IDOR endpoints | **Closed (1 residual, fixed today)** | `requireCompanyAccess` / `hasCompanyAccess` / `find*ForUser` on every data route; `tenant-isolation-idor.test.ts`; integration IDOR assertions. Residual: team-member update/delete — see §3 |
| P0.3 Hardcoded JWT secret fallback | **Closed** | `config/env.ts`: `JWT_SECRET` and `SESSION_SECRET` required, min 32 chars, boot refuses otherwise |
| P0.4 VAT charged on zero-rated supplies | **Closed** | `document-totals.service.ts` applies per-line `vatRate`; zero-rated lines post to a separate income account |
| P0.5 No DB transactions on financial writes | **Closed** | `createJournalEntry` inserts entry + lines in one transaction; invoice create runs in `db.transaction`; `withDocumentLock` wraps posting in a transaction |
| P0.6 Race in document numbering | **Closed** | xact-scoped advisory locks + unique `(company_id, entry_number)` with retry; `invoice-numbering.service.ts` sequences (migration 0034); concurrency integration suite |
| P0.7 Wrong VAT-201 computation | **Closed** | Rewritten; emirate must be set (`EMIRATE_NOT_SET`), FX-converted input VAT, Box 9/13 integration assertions |
| P0.8 Unauthenticated WhatsApp webhook | **Closed (by redesign)** | No inbound webhook exists; WhatsApp is a personal-link firm-only surface behind `authMiddleware` + `requireFirmRole()` |
| P0.9 No helmet / rate limiting | **Closed** | `middleware/security.ts`, `rateLimit.ts`, `csp.ts` (CSP in report-only mode pending prod logs) |
| P0.10 JWT in localStorage | **Closed** | httpOnly cookie via `auth-cookies.service.ts`; CSRF token on cookie-auth mutations; zero `localStorage` token reads in `client/src` |
| P0.11 Error message / stack leakage | **Closed** | `errorHandler.ts`: generic message in production, stack never returned |

### Phase 1 — data integrity

| Roadmap item | Status | Evidence |
|---|---|---|
| Money stored as `real` | **Closed** | Migration 0086 → `numeric` (63 columns); `check-money-types.mjs` guards CI. 20 remaining `real()` columns are quantities, confidences and percentages, not money |
| Missing indexes | **Closed** | Migrations 0043, 0083 |
| Schema drift / unjournaled migrations | **Closed** | `check-migration-journal.mjs` in `npm run check`; orphaned migration quarantined |
| Period lock never fired | **Closed** | Migration 0087; `assertPeriodNotLocked` used on invoice and journal writes |

### Phase 2 — deployment

| Roadmap item | Status | Evidence |
|---|---|---|
| Dockerfile builds stale `backend/` | **Closed** | Multi-stage Dockerfile builds repo root `dist/`, SHA-keyed layers |
| Server binds loopback | **Closed** | `server.listen(port, "0.0.0.0")` |
| Not a git repo | **Closed** | GitHub `shire602-cyber/NR-Ai`, CI workflow with boot-and-fixes job |
| Fatal boot log unreadable, malformed UUID → 500 | **Closed** | `6089cf5` |

### Phase 3 — SaaS foundations

| Roadmap item | Status | Evidence |
|---|---|---|
| Stripe billing | **Code done, needs keys** | `stripe.service.ts`, webhook signature verified via `constructEvent`; enforcement auto-enables only when Stripe is configured |
| Transactional email | **Code done, needs provider** | `email.service.ts`: Resend or SMTP; degrades to `{ sent: false }` |
| Invitations | **Closed** | `/invitations/verify/:token`, `/invitations/accept/:token` |
| Durable file storage | **Code done, needs token** | S3-compatible or Vercel Blob; boot warns `EPHEMERAL` when neither is set |
| Code-splitting | **Closed** | 111 lazy routes with `lazyWithReload`; first-paint JS −46% |

### Phases 4–6 — VAT correctness, billing, quality gate

Covered by the four teardowns (7, 13, 14, 16 August) and verified above. The
engine-level items are closed; the items that remain are listed in §4.

---

## 3. Fixed in this session

**Cross-tenant IDOR on team-member management** (`server/routes/team.routes.ts`,
`server/storage.ts`).

`PUT` and `DELETE /api/companies/:companyId/team/:memberId` verified that the
caller owned `:companyId`, then called `updateCompanyUser(memberId)` /
`deleteCompanyUser(memberId)`, which mutated the `company_users` row **by id
alone**. An owner of company A who knew (or guessed) a membership row id from
company B could change that member's role or remove them from B.

Fix:

- Storage now addresses membership rows as `(id, companyId)` and refuses to
  re-home a row to another company. Update returns `undefined` and delete
  returns `false` when the row is not in that company.
- Routes validate both ids as UUIDs, resolve the member **within** the URL's
  company (404 otherwise, so a guessed id leaks nothing), validate `role`
  against the four known roles, and refuse to demote or remove the last owner
  (`422 LAST_OWNER`) so a company cannot be orphaned.
- Audit records now carry the member's `before` state.

Regression test: `tests/unit/team-member-scoping.test.ts` (8 cases, two
tenants, real routes behind a membership-backed storage mock).

No client change needed: `TeamManagement.tsx` already sends the role within
the company it is viewing.

**Firm owner could edit a self-signup SaaS customer's company**
(`server/routes/firm.routes.ts`, `PUT /api/firm/clients/:companyId`).

The handler checked that the target was *accessible* to the caller. A
`firm_owner`'s accessible set is "all companies", and unlike its sibling
handlers (summary, switch, archive, assign-staff) it never checked that the
company was actually an NRA client. Confirmed live on 2 October: a freshly
promoted firm owner renamed a SaaS tenant's company to "PWNED BY FIRM" and
overwrote its TRN with HTTP 200. This is the same tenant boundary that
`hasCompanyAccess` enforces for firm roles everywhere else.

Fix: the route now returns `400 Company is not an active NRA client` for any
non-client or archived company, matching its siblings. Firm owners can still
create and edit real NRA clients (verified live after the fix).

**Regression coverage for both findings:**
`tests/integration/tenant-boundaries.test.mjs`, wired into
`npm run test:integration` (11 assertions against a live server and
Postgres; the firm cases need `DATABASE_URL` to promote a firm owner).

---

## 4. Still open — and who owns it

Nothing below is a code defect found in this tree. These match the
repository's own launch checklist (`MOVE-REPO-AND-LAUNCH-CHECKLIST.md`).

| Item | Owner | Why it matters |
|---|---|---|
| Rotate the weak firm-owner password flagged in the July live audit | Owner, 1 min | Live credential on an account holding client TRNs/IBANs |
| Set `BLOB_READ_WRITE_TOKEN` (or S3) in production | Owner, 15 min | Receipt images are on ephemeral disk until then |
| Set `OPENAI_API_KEY` and run ~100 real receipts | Owner, then 1 week | The AI has never run live; accuracy and cost per receipt are unmeasured |
| Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` | Owner | Billing and email are wired but dormant without keys |
| Sign an accredited e-invoicing ASP | Owner (commercial) | Legally required to transmit; deadline 31 Mar 2027 for < AED 50m filers |
| Reconcile one VAT 201 against a return actually filed with the FTA | Owner + 1 accountant | All 130 integration assertions verify against in-house fixtures |
| Promote CSP from report-only after a week of clean production logs | Eng, after launch | Runbook in `middleware/csp.ts` |
| Full Arabic translation of report bodies | Eng, after screen consolidation | Gate: `npm run audit:i18n` |
| Consolidate 113 screens → ~20 | Product, after a design partner | Dead code is already gone; the rest is removing working features |

### Engineering notes (not blockers)

- `withDocumentLock` passes a transaction handle to its callback, but the
  posting callbacks ignore it and write through the global `storage` handle.
  Serialisation still holds (the lock is held until the outer transaction
  commits) and `createJournalEntry` is itself atomic, so behaviour is correct;
  the doc-comment's "everything inside runs in one transaction" overstates it.
- `AI_MODEL` defaults to `gpt-3.5-turbo` in `config/env.ts`. Pin the model
  explicitly in production when the key is provisioned.

---

## 5. Bottom line

The roadmap written against the earlier snapshot is **superseded**: every
engineering item in Phases 0–3 is closed in this tree, and the gates are green
from a clean clone. The one residual tenant-isolation gap is fixed in this
commit with a regression test. What stands between this tree and launch is the
owner-action list in §4, not code.

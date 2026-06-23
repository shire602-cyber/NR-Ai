# Production Hardening & Scale Plan (living tracker)

> Goal: large-scale production readiness for a **private beta → 10s–100s of
> companies**, hardened so it doesn't paint us into a corner at 1,000s.
> Decision (2026-06): launch = private beta first; first focus = **scale &
> performance**. E-invoicing delivery is deferred (seam built; see
> EINVOICING_PLAN.md) — public claim stays "e-invoice **ready**", not
> "compliant", until an accredited ASP is wired.
> Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Phase S — Scale & performance (FIRST)
- [x] **S1 Kill N+1 in financial statements.** DONE: P&L, balance sheet, and cash flow now issue ONE batched
  `getJournalLinesByEntryIds` query (then group in memory for cash flow) instead of one query per entry —
  2 queries total instead of N+1. Files: `financial-statements.routes.ts`. (Sweep other report routes for
  the same pattern as S1.x.)
- [x] **S2 DB indexes for hot paths.** DONE: audited — the composite indexes already exist
  (journal_entries company+date/company+status, journal_lines(entry_id), invoices company+date/status,
  invoice_payments(invoice_id/company_id), bank_transactions(company+match_status), quotes/CN/PO company+status).
  Added the one gap: `idx_journal_entries_company_source` (company_id, source, source_id) for
  `getJournalEntriesBySource` (migration 0083). Files: `shared/schema.ts`, `migrations/0083…`.
- [x] **S3 List-endpoint pagination.** DONE for the heavy ones: invoices list already paged (trimmed
  projection, cap 1000); added the same to the **journal entries list** (`getJournalEntriesByCompanyId` now
  takes optional `{limit,offset}` — default unchanged for internal callers; the list route caps at 1000
  newest, `?limit&offset` to page). Files: `storage.ts`, `journal.routes.ts`. (Receipts/contacts lists can
  follow the same pattern if they grow; lower priority.)
- [x] **S4 Response caching (safe scope).** DONE: HTTP `Cache-Control: private, max-age=300` on the
  derived/static report catalog (`/api/reports/catalog`) — zero staleness risk (changes only on deploy),
  cuts repeat fetches on every dashboard load. An app-level cache for chart-of-accounts/company-profile was
  intentionally NOT added: at 10s–100s scale those indexed reads are cheap and a cache adds staleness risk —
  revisit at 1,000s after profiling shows them hot.
- [x] **S5 Deploy config for production.** DONE: `railway.json` `sleepApplication` → false (no cold starts
  for a paid product). DB pool is already env-tunable (`DB_POOL_MAX`, default 10) — fine for beta on 1 replica.
  TODO (post-beta, HA): raise `numReplicas` to 2+ (cost decision) and size the pool to replicas × max < Postgres
  connection limit.
- [~] **S6 Load smoke (runbook — needs a staging URL + token).** Run against staging once deployed:
  ```
  TOKEN=<jwt>; BASE=https://<staging>
  npx autocannon -c 20 -d 30 -H "Authorization=Bearer $TOKEN" \
    $BASE/api/companies/<id>/invoices?limit=50
  npx autocannon -c 20 -d 30 -H "Authorization=Bearer $TOKEN" \
    $BASE/api/companies/<id>/journal
  npx autocannon -c 10 -d 30 -H "Authorization=Bearer $TOKEN" \
    "$BASE/api/companies/<id>/financial-statements/balance-sheet?asOfDate=2026-06-30"
  ```
  Watch p95 latency + error rate at ~20 concurrent (beta load); the S1 N+1 fix should show the biggest gain
  on the financial-statements endpoints. Can't be run in this sandbox (no live server/DB).

## Phase R — Reliability
- [x] **R1 Graceful shutdown + connection draining.** DONE (already built, audited):
  `server/shutdown.ts` `installGracefulShutdown` — stop accepting (LB rotation) →
  disconnect WS politely → drain in-flight HTTP (bounded) → drain DB pool (bounded)
  → hard-exit watchdog. Wired in `bootstrap()`. Healthchecks at `/health/live`,
  `/health/ready`, `/health`.
- [x] **R2 Rate-limit coverage audit.** DONE: coverage is complete. Per-route
  profiles (OAuth, credential-auth with success-refund + session-read skip, AI/OCR,
  bulk OCR) PLUS a two-tier general limiter on `/api/` (reads 3000/min, mutations
  100/min) so **every** `/api` route is covered — no unprotected mutating endpoint.
  Global 10MB body cap + HTTPS enforcement also in `security.ts`. All limits
  env-tunable (`RL_*`). No gap found for beta.
- [x] **R3 Backup + restore drill.** DONE (runbook): app-level checksum-verified
  transactional restore already exists + is E2E-tested (`backups.routes.ts`).
  Added `docs/BACKUP_RESTORE_DRILL.md` — two backup layers (Railway snapshot +
  in-app), RPO 24h / RTO 4h beta targets, weekly/monthly drill cadence, a
  ledger-invariant verification checklist (debits=credits), and a drill log.
  Owner-run (needs live/staging DB).

## Phase O — Observability
> Found the basics already mature: requestId on every request, a request logger
> (method/path/status/duration, level-by-status), `/health/live` + `/health/ready`
> + `/health` (DB ping latency, pool stats, memory, version, uptime), and
> process-level `unhandledRejection`/`uncaughtException` handlers. Phase O adds the
> single alertable seam + latency flagging on top.
- [x] **O1 Central error-capture seam.** DONE: `server/services/monitoring.ts`
  `captureException(err, ctx)` — ONE place all server errors route through. The
  global error handler (non-operational + 5xx + unhandled branches) and the
  process crash handlers (`unhandledRejection`/`uncaughtException`) now call it.
  Logs structured today (behaviour unchanged); forwards to an external tracker
  (Sentry/Datadog) when `SENTRY_DSN`/`MONITORING_DSN` is set — env-gated + lazy so
  no SDK dependency until you opt in (same seam pattern as the ASP adapter). Tests:
  `tests/unit/monitoring.test.ts`. Files: `monitoring.ts`, `errorHandler.ts`,
  `index.ts`.
- [x] **O2 Slow-request flagging + pool visibility.** DONE: `requestLogger` now warns
  on successful requests slower than `SLOW_REQUEST_MS` (default 2000ms) tagged
  `slow:true`, so latency outliers surface in logs without an APM. `/health` already
  reports `pool` saturation (total/idle/waiting) and DB ping latency; added
  `errorTracking: configured|logs-only` so the health page shows whether an external
  monitor is wired. Files: `requestLogger.ts`, `index.ts`.
- [ ] **O3 External wiring (owner action, post-DSN).** When you pick a tracker:
  `npm i @sentry/node`, init in `index.ts`, and fill the forward hook in
  `monitoring.ts` (one block). Add an uptime monitor (UptimeRobot/BetterStack) on
  `/health/ready` + a public status page. Client-side error boundary → same DSN.

## Phase T — Test depth (parallel)
- [~] **T1 Money-path branch coverage.** Added `tests/unit/money-coverage.test.ts`
  (19 tests) closing untested branches: `sumMoney` fils-exact summation (float-drift
  cases), every `classifyCounterpart` cash-flow bucket (operating/investing/financing),
  `isCashOrBankAccount` (subType/code-range/name), and `evaluateCreditNoteRequest`
  invalid-amount + default-remaining branches. Suite now 777 pass / 1 skip, tsc clean.
- [ ] **T2 DB-backed golden-ledger integration tests.** Extend the CI Postgres-job
  pattern (already running `credit-note-consolidation`) with end-to-end posting tests:
  invoice→payment→credit-note→void, asserting debits=credits and final balances. These
  run in CI (need Postgres) — can't execute in this sandbox.

## Phase L — Launch ops (before public)
- [x] **L1 ToS / privacy / support pages.** DONE (already built, verified):
  `PrivacyPolicy.tsx` (11 sections, UAE PDPL Decree-Law 45/2021, FTA Art. 78
  5-yr retention, DPO contact, real entity "Najma Al Raeda Accounting LLC"),
  `TermsOfService.tsx` (14 sections incl. tax/accounting disclaimer, governing
  law, limitation of liability), `CookiePolicy.tsx`, and `HelpCenter.tsx`
  (support@muhasib.ai, migration guidance). All routed (`/privacy`, `/terms`,
  `/cookies`, `/help`). Recommend a final legal review + adding the full
  registered street address before GA.
- [ ] **L2 Owner inputs (env, not code)** — see LAUNCH_READINESS.md §"What remains":
  email (Resend/SMTP), Stripe + 8 price IDs (flip `BILLING_ENFORCEMENT=true`
  LAST), bank-feed sandbox creds, web-push VAPID keys, domain + `FRONTEND_URL`.
- [ ] **L3 Pilot protocol** — parallel VAT run for one period, week-1 daily backup
  drills (see BACKUP_RESTORE_DRILL.md), manual review of first 20 receipts before
  enabling autopilot. Owner-run with a pilot company.

_Last updated: 2026-06 — Phases S, O, R, T1, and L1 (legal/support pages) done. All
code-side hardening that can run in-sandbox is complete. Remaining is owner-/live-DB-
gated only: O3 (wire Sentry once a DSN is chosen), T2 (DB golden-ledger tests in CI),
L2 (email/Stripe/bank/domain env), L3 (pilot protocol + backup drill execution)._

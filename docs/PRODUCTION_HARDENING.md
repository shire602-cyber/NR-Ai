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
- [ ] **S4 Response caching for read-heavy/derived data.** Short-TTL cache for
  report catalog, chart-of-accounts, company profile; invalidate on write.
- [x] **S5 Deploy config for production.** DONE: `railway.json` `sleepApplication` → false (no cold starts
  for a paid product). DB pool is already env-tunable (`DB_POOL_MAX`, default 10) — fine for beta on 1 replica.
  TODO (post-beta, HA): raise `numReplicas` to 2+ (cost decision) and size the pool to replicas × max < Postgres
  connection limit.
- [ ] **S6 Load smoke.** A k6/autocannon script hitting the hot endpoints at
  beta concurrency; record p95 latency before/after S1–S4.

## Phase R — Reliability (next)
- [ ] Graceful shutdown + connection draining; healthcheck already at /api/version.
- [ ] Rate-limit coverage audit across all mutating/expensive endpoints.
- [ ] Backup + restore drill (docs/TRUST.md flow) on a schedule.

## Phase O — Observability (next)
- [ ] Error tracking (Sentry/equivalent) wired in client + server.
- [ ] Request metrics + p95 latency + DB pool saturation; basic alerting.
- [ ] Uptime monitor on /api/version + a public status page.

## Phase T — Test depth (parallel)
- [ ] Raise coverage from ~12.7% with integration/route tests on the money
  paths (golden-ledger via the CI Postgres job pattern).

## Phase L — Launch ops (before public)
- Owner inputs (from LAUNCH_READINESS.md): email (Resend/SMTP), Stripe + price
  IDs (flip BILLING_ENFORCEMENT last), bank-feed sandbox, web-push VAPID keys,
  domain + FRONTEND_URL.
- ToS / privacy / support pages; onboarding polish; pilot protocol (parallel
  VAT run, week-1 backup drills).

_Last updated: 2026-06 — Phase S starting (S1 first)._

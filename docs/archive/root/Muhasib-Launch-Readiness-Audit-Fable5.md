# Muhasib.ai — Launch Readiness Audit (Live Production)

**Auditor:** Fable5 (senior QA lead / launch reviewer / security tester / UAE accounting advocate)
**Target:** https://nr-ai-production.up.railway.app
**Deployed commit:** `039af1a4` (environment: production, reported by `/api/version`)
**Date:** 2 July 2026
**Access:** Firm-owner session (admin@alainbcenter.com), browser already authenticated. **Read-only** — no records created or deleted.
**Method:** Live black-box + authenticated walkthrough (Chrome), cookie-less API probes, console/network inspection, cross-referenced against source repo evidence.

---

## 1. Executive Verdict: **CONDITIONAL GO**

Muhasib is genuinely close. The API enforces authentication and tenant scoping on every protected route I probed, the accounting surface is broad and real (seeded chart of accounts with Dr/Cr, invoices with automatic VAT/numbering, a full Report Center, VAT/CT compliance, bilingual RTL), and the recent design work is live and looks trustworthy — serif headings, tabular figures, clean empty states, a "UAE TAX READY" trust cue. This does not look or behave like a prototype.

It is **not yet ready to charge customers** because of three concrete, evidence-backed issues found in minutes of live use:

1. **Post-deploy stale-chunk failures** break core pages (Dashboard error boundary; Reports rendered a full white screen once) with no auto-recovery. Every deploy risks breaking active sessions until a hard refresh.
2. **Client error telemetry is broken in production** — `POST /api/client-errors` returns **403**, so the app's own "We've been notified" message is false. You would be blind to production errors during launch.
3. **The billing safety fix is not deployed.** Live commit is `039af1a4`; the auto-enforcement fix (`f0afbc01`) is unpushed. On the deployed logic, paid features are gated in production unless `BILLING_ENFORCEMENT=false` is set — a paywall-with-no-checkout risk.

None are architectural. All are fixable in days. Fix these, deploy `f0afbc01`, and this converts to **GO for a private/pilot launch**.

---

## 2. Launch Readiness Score: **67 / 100**

| Category | Weight | Score | Notes |
|---|---|---|---|
| Core accounting workflows | 20 | 15 | Pages load, CoA seeded, invoices/quotes/credit notes/VAT/reports present; deep posting not live-tested (read-only) but 924 repo tests back it. |
| Customer experience | 15 | 10 | Beautiful UI, excellent empty states; badly undercut by stale-chunk broken/blank screens on returning sessions. |
| Firm / NRA workflows | 10 | 7 | Firm→client switching works ("Back to Firm", MANAGING context, NRA groups visible); not deeply exercised. |
| Security & tenant isolation | 20 | 15 | API auth enforced on all probed routes; strong repo posture (SSRF guard, AES-256-GCM). Runtime headers unverified; weak admin password; billing fix undeployed. |
| Reliability & deployment | 15 | 7 | Stale-chunk/lazy-import failures, no chunk-error recovery, worst-case white screen; Google Fonts 503. |
| Compliance / accounting trust | 10 | 8 | UAE TAX READY, VAT/CT present, "View proof", honest proxy language in reports. |
| Observability & operations | 10 | 5 | Client-error pipeline returns 403 (broken); "we've been notified" misleading; `/api/version` healthy. |
| **Total** | **100** | **67** | Conditional Go. |

---

## 3. Top 10 Launch Blockers / Risks

1. **P1 — Stale-chunk lazy-import failure breaks Dashboard** after a deploy (error boundary shown). Evidence: console `TypeError: Failed to fetch dynamically imported module: /assets/Dashboard--a04q_Gb.js`.
2. **P1 — Reports route can render a full white screen** (no boundary) when a chunk fails above the layout. Evidence: blank viewport, empty DOM, recovered only on fresh document load.
3. **P1 — Client error telemetry broken:** `POST /api/client-errors` → **403**. Production errors are not being captured; "We've been notified" is false.
4. **P1 — Billing safety fix not deployed** (`f0afbc01` unpushed). Deployed logic can paywall paid features in production with no live checkout.
5. **P2 — External Google Fonts dependency failing** (`fonts.googleapis.com` → 503). Reliability + privacy (third-party request with user IP) risk; should self-host.
6. **P2 — Partial Arabic i18n:** chrome/navigation/headings translate and RTL flips correctly, but report content panels remain English. Bilingual promise only half-delivered.
7. **P2 — No client-side stale-chunk recovery** (auto-reload on dynamic-import error) — the root cause behind #1 and #2.
8. **P3 — `/api/version` exposes commit hash, environment, uptime** unauthenticated. Minor info disclosure; fine for beta, trim for GA.
9. **Risk (unverified) — Runtime security headers** (CSP, HSTS, `Set-Cookie` flags, CORS) not confirmable with available tooling; configured in source but not runtime-verified here.
10. **Risk — Weak admin credential** (`admin123`) on a live firm-owner account holding real tenant data (TRNs, IBANs, emails). Rotate immediately; enforce password policy + consider MFA for firm owners.

---

## 4. Findings (grouped by severity)

### P0 — Launch blockers
_None found in live testing._ (Notably, the feared unauthenticated data leak was **ruled out**: `GET /api/companies` returned data only because the browser carried an authenticated session; cookie-less it returns empty. Same for `/api/notifications`, `/api/admin/users`, `/api/companies/:id/invoices`.)

### P1 — Must fix before paid launch

| ID | Persona | Route | Repro | Expected | Actual | Impact | Fix | Confidence |
|---|---|---|---|---|---|---|---|---|
| P1-1 | All | `/dashboard` | Open app in a session that predates the current deploy; load Dashboard | Dashboard renders | Error boundary "Dashboard couldn't load"; console: failed dynamic import of `Dashboard--*.js` | First screen after login is broken for returning users across deploys | Add chunk-load-error handler that force-reloads once (bump on hashed-asset 404); keep old chunks warm for a grace period | High |
| P1-2 | All | `/reports` | SPA-navigate to Reports with a stale module graph | Reports renders | Full white screen, empty DOM; recovered on fresh load | Worst-case UX (blank app), no error shown | Same chunk-recovery handler + ensure a top-level error boundary wraps lazy routes so failures never blank the shell | High |
| P1-3 | All | `POST /api/client-errors` | Trigger any client error | 2xx, error logged | **403** on every attempt | Production error blindness; "We've been notified" is untrue | Fix CSRF/token handling (or exempt with a signed beacon) so client errors actually persist; verify they reach your tracker | High |
| P1-4 | Owner/Admin | Billing | Deployed commit `039af1a4` | Auto-enforce only when Stripe live | Prod enforces unless `BILLING_ENFORCEMENT=false`; fix `f0afbc01` unpushed | Paid features may be paywalled with no checkout, or given away | `git push` `f0afbc01`, redeploy, confirm `/api/version` shows new commit | High |

### P2 — Fix soon

| ID | Persona | Route | Issue | Fix | Confidence |
|---|---|---|---|---|---|
| P2-1 | All | Global | Google Fonts `503` (external CDN dependency) | Self-host Geist/Instrument Serif; removes third-party IP leak + failure mode | High |
| P2-2 | Arabic user | `/reports` (and likely others) | RTL + nav translate, but content panels stay English | Complete i18n coverage on content strings; QA a full Arabic pass | High |
| P2-3 | All | SPA | No lazy-import retry/backoff | Wrap `React.lazy` in retry-with-reload helper | High |

### P3 — Polish

| ID | Route | Issue | Fix |
|---|---|---|---|
| P3-1 | `/api/version` | Exposes commit/env/uptime unauthenticated | Return minimal status publicly; gate details |
| P3-2 | Global | Notification badge shows "99+" on a near-empty tenant | Verify notification counting isn't inflated |

### Unverified risks (could not test with available access/tooling)
- Runtime **CSP / HSTS / Set-Cookie (HttpOnly, Secure, SameSite) / CORS** headers — configured in source, not runtime-confirmed here.
- **Rate limiting** thresholds on auth/OCR/AI/upload/export/webhooks (behavioral test needs controlled load).
- **IDOR / cross-tenant** document access with a *second, separate* tenant login (only one firm context available).
- **XSS** in invoice/report/filename fields (needs mutation permission).
- **Webhook signature/replay** live behavior; **backup/restore/rollback**; **monitoring/alerting** actually receiving events (P1-3 suggests the client half is broken).
- **OCR provider-outage** fallback messaging (needs upload permission).

---

## 5. Customer-experience walkthrough by persona

**UAE SME owner (first-time).** Landing page is clear and UAE-specific ("AI Bookkeeping Built for UAE Businesses", VAT workflows, bilingual). After login the app looks premium and trustworthy — "UAE TAX READY" badge, AED formatting, tabular numbers, a warm "Welcome back" dashboard with Net Profit / Revenue. Empty states are genuinely helpful ("No invoices yet — VAT, sequential numbering, and PDFs are handled automatically"). The risk: if they return after you ship a deploy, the first thing they may see is "Dashboard couldn't load" or a blank Reports page — a trust-killer at exactly the wrong moment.

**Accountant / bookkeeper.** The depth is there and well-organized: Chart of Accounts (seeded, Dr/Cr, grouped), Journal Entries, Bank Reconciliation, Reconciliation Rules, Cost Centers, Fixed Assets, Month-End Close, plus a strong Report Center that opens one report at a time with period/export/"View proof" and honest language ("Persona ranking changes recommendations, not report names"). This will feel credible to a professional. Deep posting flows weren't exercised live (read-only), but the repo's 924 passing tests cover the double-entry core.

**NRA firm staff.** Firm context works — "MANAGING Taran General Trading LLC · TRN…", "Back to Firm", multiple client companies and NRA groups visible in the account graph. Client switching is present and coherent. Not stress-tested for stale context across rapid client switches (recommend a scripted pass before onboarding firms).

---

## 6. Hardening checklist

- **Auth / session / RBAC:** ✅ API auth enforced on all probed routes. ▢ Rotate `admin123` now; enforce password policy; consider MFA for firm owners. ▢ Runtime-verify cookie flags (HttpOnly/Secure/SameSite).
- **Tenant isolation:** ✅ cookie-less probes return empty. ▢ Add an automated 2-tenant IDOR test (company A token → company B ids → expect 403/404).
- **File upload / OCR / AI:** ▢ Verify size/type limits and OCR-outage fallback live; ▢ confirm AI/OCR rate limits.
- **Tax / accounting integrity:** ✅ VAT/CT surfaces present; ✅ reports use honest proxy language. ▢ Live-verify a full invoice→VAT→report cycle on staging.
- **Payments / webhooks:** ▢ Deploy billing fix (P1-4); ▢ live-verify webhook signature + replay protection.
- **Exports / documents:** ▢ Verify invoice PDF + report export + filename sanitization with real data.
- **Monitoring / logging / backup:** ▢ **Fix client-error 403 (P1-3)** — you are currently blind; ▢ confirm server error tracking receives events; ▢ verify backup/restore + rollback runbook.
- **Deployment / cache / rollback:** ▢ **Add stale-chunk recovery (P1-1/P1-2/P2-3)**; ▢ self-host fonts (P2-1); ▢ verify `preDeployCommand` migrations + one-click rollback.

---

## 7. 100% Launch-Ready Plan

**48-hour actions** — _Owner: Eng lead_
- Push `f0afbc01` + redeploy; confirm `/api/version` shows new commit. **Accept:** commit matches; free-tier gating behaves per Stripe state.
- Fix `POST /api/client-errors` 403. **Accept:** deliberate client error appears in your tracker; response 2xx.
- Rotate the admin password; audit for other weak/shared creds. **Accept:** no `admin123`-class passwords; policy enforced.

**7-day actions** — _Owner: Frontend lead_
- Ship stale-chunk recovery (auto-reload once on dynamic-import failure) + top-level lazy-route error boundary. **Accept:** simulate a deploy mid-session → app self-recovers, never blanks.
- Self-host fonts. **Accept:** zero third-party font requests; no 503 path.
- Runtime security-header verification (CSP/HSTS/cookies/CORS). **Accept:** headers present and correct on prod responses.

**14-day actions** — _Owner: QA + Backend_
- Automated 2-tenant IDOR/tenant-isolation suite in CI. **Accept:** cross-tenant access returns 403/404, test gates deploys.
- Live staging pass of invoice→payment→VAT→report + PDF/export + OCR outage. **Accept:** each step verified with screenshots.
- Complete Arabic content i18n. **Accept:** full Arabic pass shows no stray English on core pages.

**30-day actions** — _Owner: Founder / Ops_
- Rate-limit verification on auth/OCR/AI/upload/export/webhooks. **Accept:** documented thresholds + tests.
- Backup/restore + rollback drill; alerting on error-rate/latency. **Accept:** successful restore rehearsal; alerts fire on synthetic incident.
- External security review kickoff (pre-SOC 2). **Accept:** engagement scheduled.

---

## 8. Retest Plan

**Automated tests to add**
- Frontend: chunk-load-error handler unit test; lazy-route error-boundary test.
- API: client-errors POST success (regression for the 403); 2-tenant IDOR matrix; auth-required assertions on a route sample.
- CI: block deploy if `/api/version` post-deploy ≠ built commit.

**Manual scripts to repeat**
- Post-deploy: with an old tab open, navigate Dashboard/Reports/Invoices → expect self-recovery, no blank/boundary.
- Full Arabic walkthrough of Dashboard, Invoices, Reports, VAT.
- Firm: rapid client switching → confirm no stale company context.

**Production smoke checklist** (extend existing `scripts/production-smoke.mjs`)
- `/api/version` commit matches; login; `/api/auth/me` 200; Dashboard renders; one report opens; client-errors POST 2xx; no console chunk errors.

**Staging destructive-test checklist**
- Create invoice → send → mark paid → confirm journal + VAT movement; credit note; receipt OCR incl. forced provider outage; bank import + reconcile; month-end close; then clean up.

---

## 9. Final Recommendation — what must be true before public launch

1. Deployed commit includes the billing auto-enforcement fix, and billing posture is correct for your Stripe state.
2. `POST /api/client-errors` returns 2xx and errors reach your tracker — you can *see* production problems.
3. Stale-chunk failures self-recover; no deploy can leave a user on a broken Dashboard or blank Reports.
4. Fonts self-hosted (no external 503 path); runtime security headers verified.
5. Admin/firm credentials rotated off weak passwords.
6. A 2-tenant isolation test passes in CI, and one full invoice→VAT→report cycle is verified on staging.

Meet 1–3 (days of work) and you are cleared for a **private/pilot launch**. Add 4–6 for public GA. The product is close and the foundation is strong — the remaining work is deployment hygiene and observability, not rebuilding.

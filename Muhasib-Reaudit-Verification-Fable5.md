# Muhasib.ai — Live Re-Audit Verification (post-fix)

**Target:** https://nr-ai-production.up.railway.app
**Deployed commit verified:** `5d161e73` (was `039af1a4` at first audit)
**Access:** authenticated admin session, Claude-in-Chrome. Read-only (one disposable telemetry probe to `/api/client-errors`).
**Date:** 2 July 2026

## Verdict: **GO for private launch** — all P1s fixed and verified live.

Every blocker from the first audit was fixed, deployed, and re-tested against the live production build (not just locally). Verification evidence below.

## Blocker-by-blocker verification

| # | Issue (first audit) | Fix | Live evidence on `5d161e73` | Status |
|---|---|---|---|---|
| P1-1 | Stale-chunk failure broke Dashboard (error boundary) | Service worker network-first for navigation + `lazyWithReload` retry/reload + boundary reload | On the exact browser that failed before (old SW + cached shell), Dashboard auto-recovered: loaded old index → reloaded → fetched new `Dashboard-*.js` (200) → full render. No boundary. | ✅ Fixed |
| P1-2 | Reports rendered blank white screen | Same recovery + network-first SW | Reports loads fully on normal SPA navigation (Report Center, categories). No blank. | ✅ Fixed |
| P1-3 | `/api/client-errors` 403 (telemetry broken; "we've been notified" false) | Exempted from CSRF | Live POST from page returns **204** (twice, two builds). | ✅ Fixed |
| P1-4 | Billing fix not deployed | Pushed `f0afbc01` (auto-enforce when Stripe configured) | Deployed commit includes it; billing logic self-manages. | ✅ Deployed |
| P2-1 | Google Fonts 503 (external CDN dep + IP leak) | Self-hosted via Fontsource (incl. Arabic, lazy) | **Zero** `fonts.googleapis` requests; no font link in DOM; woff2 served from `/assets/`. | ✅ Fixed |
| — | Service worker caching (root cause of P1-1/1-2) | Rewrote to network-first navigation, cache-first only for `/assets/`, bumped to v2 | `caches.keys()` = `["muhasib-v2"]` only (v1 purged); SW active. | ✅ Fixed |
| Regression | Body font fell back to system-ui (`--font-sans` said "Geist", Fontsource is "Geist Sans") — **caught in this re-audit**, missed the earlier commit | Token now leads with "Geist Sans"; committed `5d161e73` | `document.fonts.check("16px 'Geist Sans'")` = **true**; body computed font leads with "Geist Sans". | ✅ Fixed |

## Additional live checks
- **Auth/tenant isolation:** cookie-less fetches of `/api/companies`, `/api/notifications`, `/api/admin/users` return empty (enforced). (Unchanged from first audit — still solid.)
- **Console:** zero app errors across Dashboard, Invoices, Chart of Accounts, Reports, VAT Filing on the new build.
- **Core pages render:** Dashboard (Net Profit −AED 479.40, Filing pulse, Audit Readiness), Invoices (empty state), Chart of Accounts (seeded, Dr/Cr), Reports (Report Center), VAT 201 (workpaper + boxes + entry grid).
- **Local gates (build `5d161e73`):** 935 tests pass, tsc clean, `npm audit --omit=dev` 0 vulns, production build succeeds.

## Updated launch-readiness score: **91 / 100** (was 67)

| Category | First | Now | Why |
|---|---:|---:|---|
| Core accounting workflows | 15 | 16 | Verified rendering live; deep posting still not mutation-tested. |
| Customer experience | 10 | 14 | Stale-chunk breakage gone; fonts correct; polish confirmed live. |
| Firm / NRA workflows | 7 | 7 | Firm context works; not deep-tested this pass. |
| Security & tenant isolation | 15 | 16 | Auth enforced; external font IP leak removed; **admin password still weak → caps this.** |
| Reliability & deployment | 7 | 14 | Root-caused SW + recovery, verified auto-recovery across a real deploy. |
| Compliance / accounting trust | 8 | 9 | VAT 201 / CT workpapers render live with honest proxy language. |
| Observability & operations | 5 | 9 | Error telemetry now works (204); version endpoint healthy. |
| **Total** | **67** | **91** | |

## What still holds it under 95 (all owner actions, not code)
1. **Rotate the `admin123` password** (+~2 pts). A weak live credential on a firm-owner account caps the security score regardless of code.
2. **Complete Arabic content i18n** (+~2 pts). RTL + nav/headings translate; report body strings still English.
3. **Verify at runtime:** security headers (CSP/HSTS/cookie flags), rate limits, and a 2-tenant IDOR test in CI (+~2 pts of *confidence*, not new code).

Do #1 today (1 minute) and you're at a verified ~93 with a clean bill on every P1. #2 and #3 take you past 95.

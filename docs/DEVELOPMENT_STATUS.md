# Muhasib.ai — Development Status & Roadmap

_Last updated: 2026-06-11 (reliability program: quarantine cleared to infra-only)_

## Mission

Build the most reliable accounting software there ever was: effortless for
every class of user (SME owner, bookkeeper, firm accountant, portal client),
deep and correct in the back office, unbeatable on UAE/FTA-native compliance.
Beat **Digits** (AI-native, zero UAE depth), **Wafeq** (regional incumbent,
utilitarian), **QuickBooks/Zoho** (breadth without local depth).

## THE repository

**`shire602-cyber/NR-Ai` is production.** Its `main` deploys automatically to
the Railway service behind the production domain (verify the running commit
at `/api/version`). `NR-Ai-Backend` is a stale sibling — do not develop there.

Workflow: branch → PR → CI green (three checks) → merge → auto-deploy.
CI gates every PR with:
1. **Typecheck · Test · Build** — tsc, 491 vitest unit tests, hygiene scripts
   (bundle hygiene, route registration vs config/route-registry.json, API
   contract), production build
2. **Browser E2E · full route crawl** (`npm run e2e`,
   tests/e2e/full-crawl.mjs) — headless Chromium against a real Postgres:
   74 workspace routes as firm-owner admin, 9 business flows (double-entry
   journal, firm client profile, quote lifecycle incl. invoice conversion,
   credit-note issue with reversing-entry assertion, purchase-order
   send→approve→receive, cost-center report, invoice-template set-default,
   financial statements, bank CSV import + reconciliation auto-match), and a
   12-route account-type matrix ('client' and 'client_portal' users in
   isolated contexts). JS errors, error screens, blank mains, bad redirects,
   and untolerated 4xx/5xx fail the build with screenshot artifacts.
   TOLERATED_API in the script is the only allowed 4xx list — keep it short.

## Feature state

Everything customer-facing works and is E2E-locked. Shipped from quarantine
during the reliability program (each with schema, migration, storage, routes,
page, sidebar EN/AR, and an E2E flow):
Quotes · Credit Notes (auto reversing journal entries via
`createJournalEntryWithLines`) · Purchase Orders · Cost Centers (journal-line
allocation) · Financial Statements · Reconciliation Rules · Invoice
Templates · Bank Import (connections, CSV/OFX statements, Lean-ready
open-banking connect/callback/sync endpoints). Employee management lives in
**Payroll** (the old duplicate module/page was deleted).

Premium UI system (Geist/Instrument Serif, editorial PageHeader on ~65 pages,
split-screen auth, Filing Pulse with fix-it actions, express onboarding,
⌘K search) and the **VAT workpaper Excel round-trip** (pull-from-books, .xlsx
import via shared parser, styled export with copy-ready VAT 201 sheet) are
live.

## Remaining quarantine (tsconfig excludes + route-registry amnesty)

Undeployed infrastructure only — each needs external credentials or a product
decision, not just code: `billing` + `stripe.service` (monetization; flip
`BILLING_ENFORCEMENT=true` once live — gates currently fail OPEN on purpose),
`webhooks` + `webhook.service`, `push` + `push-notification.service` +
`client/lib/push`, `api-keys`, `document-versions`,
`depreciation.service`, `invoice-payment.service`, and client misc
(`useHealthCheck`, `date-safe`, `DeveloperSettings`, `DocumentVersions`,
`NotificationPreferences`, `Subscription` pages).

## Hard-won invariants (do not regress)

- `SUBSTRING(x FROM ${param})` with a bound parameter is the REGEX form in
  Postgres — entry numbering uses `::int` casts; keep them.
- Auth rate limiting: only credential paths consume the strict budget
  (isCredentialAuthPath); reads have a 1200/min tier. A 429 on /api/auth/me
  must NEVER log the user out (ProtectedRoute redirects only on real 401).
- The onboarding wizard auto-opens at most once per mount; any dismissal
  persists showTour=false.
- Sidebar shows full workspace nav for every userType except 'client'.
- Credit-note account lookups go by ACCOUNT_CODES, names only as fallback.
- Route payload dates: coerce ISO strings to Date at route boundaries
  (normalize*Dates helpers) — Drizzle timestamps reject strings.

## Where to go next (priority order)

1. **Corporate-tax workpaper parity** with the VAT loop (export, template,
   pull-from-books) — same service patterns, big compliance moat.
2. **Workpaper review UX**: bulk-approve pulled draft rows, status filters,
   evidence on pulled rows.
3. **Arabic coverage** for all new strings (auth panel, eyebrows, Filing
   Pulse, express onboarding, new sidebar entries) + RTL audit.
4. **Billing/Stripe rehab** when keys exist → flip BILLING_ENFORCEMENT.
5. **Lean credentials** → live bank feeds through the already-shipped
   connect/sync endpoints.
6. **E-invoicing readiness** (UAE Peppol wave) — research plan first.
7. PageHeader v2 (icon/back slots) for the ~25 intentionally skipped pages;
   dark-mode/mobile polish; layout-matching skeletons.

## Conventions

- Verify: `npm run check`, `npm test`, `npm run build`, `npm run e2e`
  (needs DATABASE_URL, a running server, and CHROMIUM_PATH or installed
  Playwright Chromium).
- Brand: paper #FAFAF6, ink #131820, emerald #0D5C3D, gold #C19E50,
  midnight #0E1320; display serif via `font-display`; money in
  `font-mono tabular-nums`.
- Shared client/server code in `shared/` (`@shared/*`).
- New features follow the rehab recipe: schema + idempotent migration +
  storage + routes + page + sidebar (EN/AR i18n) + E2E flow, PR'd and merged
  only when all three checks are green.

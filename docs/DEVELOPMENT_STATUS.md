# Muhasib.ai — Development Status & Roadmap

_Last updated: 2026-06-10 (session: premium UI + VAT workpaper round-trip; PR #1 merged to main)_

## Mission

Build the best accounting software there ever was: effortless for every class of
user (SME owner, bookkeeper, firm accountant, client portal viewer), deep and
correct in the back office, and unbeatable on UAE/FTA-native compliance.
Primary competitors to beat: **Digits** (AI-native UX, zero UAE depth) and
**Wafeq** (regional incumbent, utilitarian feel, compliance buried in menus).

## Two repositories

| Repo | Role | Deploy |
|---|---|---|
| `shire602-cyber/NR-Ai` | Marketing site / landing (Muhasib.ai landing shipped on main) | Railway, from `main` |
| `shire602-cyber/NR-Ai-Backend` | The product (React+Vite client, Express server, Drizzle/Postgres) | Railway, from `main` |

Working branch convention for Claude sessions: one shared branch name across
both repos, PR into `main` when green. Railway only deploys `main`.

## Where we are (merged to NR-Ai-Backend main via PR #1, 2026-06-10)

### Brand & premium foundation
- **Font bug fixed**: index.html now loads Geist / Geist Mono / Instrument
  Serif (the theme always referenced them; Inter/JetBrains were loading
  instead, so all serif display type was silently Georgia).
- Premium split-screen **auth** (Login/Register): midnight #0E1320 brand panel,
  drifting emerald/gold `MeshGradient`, Instrument Serif headlines with gold
  italic accents, trust points; warm-paper form side; serif card titles.
- Shared `BrandMark` (م meem on emerald) used in sidebar + auth.
- Header: **⌘K search pill** wired to the existing command palette
  (`openCommandPalette()` event in CommandPalette.tsx).
- Dashboard hero: mesh backdrop, emerald eyebrow, glass profit card, eased
  **count-up** on net profit (`useCountUp`, reduced-motion aware).
- PWA/theme colors moved from old blue #1E40AF to emerald #0D5C3D / paper.
- Previously-missing utilities defined: `animate-ping-soft`, `tracking-tightest`.

### Editorial design system
- `client/src/components/ui/page-header.tsx` — emerald eyebrow + serif title +
  description + actions slot. Adopted on **~57 workspace pages** (sales,
  purchases, accounting, compliance, insights, settings, firm, admin).
  Holdouts (intentional): pages with back-button/breadcrumb headers, icon-hero
  headers, or stat banners — PageHeader needs `icon`/`backHref` slots first.
- `EmptyState` restyled (square icon tile, accent fleck, tighter type).

### Compliance as a product moat
- **Filing Pulse** card on dashboard, fed by the previously-unused
  `GET /api/companies/:id/compliance/overview`: animated audit-readiness score
  ring, VAT 201 + corporate tax next-due chips (On track / Due soon / Overdue),
  links into VAT workspace and tax workpaper.
- **Fix-it rows**: each open audit issue deep-links to the screen that resolves
  it (map in Dashboard.tsx `ISSUE_ACTIONS` — strings must match
  `server/routes/compliance-dashboard.routes.ts`).

### Onboarding speedrun
- Express path on the welcome step: company name + emirate (+ optional TRN,
  15-digit validated) → company created → UAE chart of accounts auto-seeded
  (server `seedChartOfAccounts`) → onboarding complete → dashboard.
  Guided 6-step wizard still available beneath it.

### VAT workpaper = the Excel replacement (flagship feature)
Located: `VatWorkspaceDialog` in `client/src/pages/firm/ClientPortfolio.tsx`,
server in `server/services/firm-vat-workspace.service.ts` +
`server/routes/firm-vat-workspace.routes.ts` (+ new
`server/services/vat-workpaper-export.service.ts`).

The loop is closed in all directions:
- **books → workpaper**: `POST /:id/pull-from-books` — period's issued
  invoices (split standard/zero-rated/exempt by line supply type) and posted
  receipts (standard expense / reverse-charge input) land as **draft** rows
  for review. Idempotent via `sourceDocumentId` dedupe.
- **Excel → workpaper**: `POST /:id/import-file` (.xlsx, base64, 10MB/2000-row
  caps) parsed by the **same shared parser** as the paste box
  (`shared/vat-workpaper-grid.ts`; client lib re-exports it). Template
  download (`GET /template`) has headers that round-trip the parser exactly.
- **workpaper → Excel**: `GET /:id/export` — styled workbook: grid grouped by
  FTA category (approved-only totals, excluded rows struck) + copy-ready
  VAT 201 sheet (boxes 1a–14). For archiving / sending to client.
- **workpaper → return**: existing `POST /:id/generate-return`.
- All imports/pulls/exports audit-logged. 488 unit tests green (13 new VAT
  export/import tests).

### Frontend repo (NR-Ai)
- Landing page on main (PR #26). No changes needed this session.
- Stale duplicate **PR #25 should be closed** (superseded by merged #26).

## Known issues / tech debt
- `vat.routes.ts` VAT 201 generator still buckets explicitly-exempt 0%-rate
  lines as zero-rated; the workpaper mapper was fixed (exempt checked first) —
  consider aligning the generator the same way.
- ~49 pre-existing lint warnings (notably react-hooks "create components
  during render" in CustomerContacts.tsx, sync setState in Receipts.tsx).
- New UI copy (auth panel, eyebrows, Filing Pulse, express onboarding) is
  English-only — needs Arabic i18n keys for full bilingual parity.
- No E2E/browser tests (only vitest unit tests). Playwright would pay off.
- tsconfig `baseUrl` deprecation warning under TS 6 (project pins TS 5.9.3).
- Railway **frontend** service connection should be verified by the owner
  (Settings → Source: repo NR-Ai, branch main, auto-deploy on) — backend
  deploys fine after PR #1 merge.

## Where to go next (priority order)

1. **Verify Railway deploys are healthy** after the PR #1 merge; fix boot
   errors from logs if any.
2. **Workpaper review UX**: bulk-approve for pulled draft rows (review queue),
   filter by status/category, attach evidence to pulled rows, surface
   "pulled vs books" drift warnings.
3. **Corporate tax workpaper parity** with the VAT loop (export, template,
   pull-from-books) — same service patterns.
4. **Bank feeds** (see NR-Ai repo `BANK_INTEGRATION_RESEARCH_PLAN.md`):
   UAE open-banking aggregator (e.g. Lean) — biggest data moat; feeds
   reconciliation + Filing Pulse accuracy.
5. **Arabic coverage** for all new strings; RTL audit of new surfaces
   (auth split-screen, PageHeader actions).
6. **PageHeader v2**: optional `icon` and `backHref`/breadcrumb slots, then
   convert the ~25 intentionally-skipped pages.
7. **E-invoicing readiness** (UAE Peppol/e-billing wave) — strategic, start a
   research plan like the bank one.
8. **Dark-mode + mobile polish pass** over the new premium surfaces.
9. **Skeletons matching final layout** on invoices/VAT pages; editorial empty
   states on remaining routes.
10. Housekeeping: close NR-Ai PR #25; consider Playwright smoke suite.

## Conventions a new session should know
- Verify with: `npm run check` (tsc + bundle hygiene + route registration +
  API contract), `npm test` (vitest), `npm run build`.
- Design tokens live in `client/src/index.css`; brand colors: paper #FAFAF6,
  ink #131820, emerald #0D5C3D (accent var), gold #C19E50, midnight #0E1320.
- Serif display = `font-display` (Instrument Serif); money/numerals =
  `font-mono tabular-nums`.
- Shared client/server code goes in `shared/` (`@shared/*` alias).
- Railway deploys `main` only — work must be PR'd and merged to ship.

## Deployment

Production deploys from `main` via Railway (service source: this repo). Verify the running build at `/api/version`.

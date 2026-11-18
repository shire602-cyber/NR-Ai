# Broken-path sweep (pre-release)

Owner requirement: "the product must be complete and working properly with no broken paths."

- Date: 2026-11-18
- Base: PR head a3c0b99, then origin with WQ1 merged (1291fa9); sweep commits on top (see the
  SWEEP results file for the final sha).
- Target: a production build (`npm run build`, `NODE_ENV=production`) on a scratch Postgres
  database, `BASE_URL=http://localhost:<port>`, browser time zone Asia/Dubai, Chromium 1243.

## How to run it again

```bash
npm run build && npm run db:migrate                     # scratch DATABASE_URL
NODE_ENV=production ALLOW_LOCAL_STORAGE=true BASE_URL=http://localhost:$PORT \
  CORS_ORIGIN=http://localhost:$PORT node dist/index.js &
BASE_URL=http://localhost:$PORT DATABASE_URL=<scratch> npm run e2e:sweep   # 2-3 h on 4 CPUs
BASE_URL=http://localhost:$PORT DATABASE_URL=<scratch> npm run e2e:flows   # ~25 min, en + ar
node tests/e2e/sweep-report.mjs <sweep.json ...>   # the route table below
```

Delta runs: `SWEEP_REUSE=true` keeps the seeded personas; `SWEEP_PERSONAS`, `SWEEP_LANGS`,
`SWEEP_ROUTES`, `SWEEP_CLICKS=false` narrow it; `FLOWS=invoices,purchases` narrows the flows.
Details: [docs/testing-runtime.md](../testing-runtime.md).

## Method

`tests/e2e/broken-path-sweep.mjs` (`npm run e2e:sweep`):

1. Personas (`tests/e2e/lib/sweep-personas.mjs`), seeded through the API: **trial owner** (new
   company, onboarding done, no books), **owner with populated books** (the report audit fixture:
   invoices, bills, receipts, payroll, assets, budgets, bank, VAT, close), **accountant** and
   **viewer** (invited into the owner's company), **NR firm staff** (firm `preparer` assigned to
   the owner's company), **NR admin** (platform admin, firm owner), **client-portal user** (bound
   to one customer contact) and the **signed-out visitor**.
2. Routes: every App.tsx route (`tests/e2e/launch-routes.mjs`, pinned to the router by
   `tests/unit/launch-routes-all.test.ts`), param routes resolved against seeded records
   (account ledger, journal entry, invoice / quote / PO / bill / recurring edit, client pages,
   public invoice share link, statement portal token, e-invoicing approver link), and every
   in-app link found on each visited page (sidebar, settings sub-nav, footer, in-page links,
   file links checked for a download), plus every command-palette entry and every mobile More
   row at 390 px.
3. Each page, in English and Arabic, fails on: a 4xx/5xx document, a 5xx or non-gate 4xx API
   response (401/402/403 are gates), the 404 page, an error boundary, a blank main area, a
   console error, a page error or unhandled rejection, a failed request, horizontal scroll,
   a visible native date/select/file input, raw i18n keys / `{placeholders}` / UUIDs /
   `undefined` in visible text, and (Arabic) English UI copy or a non-RTL document.
4. Clicks: every enabled button, tab, switch, radio and menu item (destructive actions and
   paid AI calls skipped); a click fails when it throws, makes a failed request or does nothing
   observable (no navigation, DOM change, request, download, file chooser, scroll, print or
   clipboard write). An opened dialog is submitted empty and must answer with validation.

`tests/e2e/core-flows.mjs` (`npm run e2e:flows`) drives the release flows through the UI in
both languages, each on its own new owner (table at the end).

## Results

ROUTES_TABLE

FLOWS_TABLE

## What was broken and how it was fixed

FIXED_LIST

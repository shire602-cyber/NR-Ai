# Broken-path sweep (pre-release)

Owner requirement: "the product must be complete and working properly with no broken paths."

- Date: 2026-11-18
- Base: PR head a3c0b99; origin merged in twice (WQ1 at 1291fa9, then WQ1 + AS1 + CASH-SERIES at
  ffa0c72). Final results are on ffa0c72 + the SWEEP commits.
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
   to one customer contact), the **signed-out visitor** and (Step 1 / F13) the **Arabic-data
   owner** (`ownerAr`: the same books written with Arabic customer, vendor, item, account and
   memo text via `REPORT_AUDIT_ARABIC=true`), which runs the Arabic check with nothing excused.
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
   `undefined` in visible text, and (Arabic) English UI copy or a non-RTL document. English is
   excused only where a whole user-data string (a seeded customer, vendor or item, harvested
   from the API, never a system `nameEn` that has a `nameAr`) appears in the line; a word that
   merely occurs somewhere in the data excuses nothing. Mark data you render with
   `translate="no"`. Every individual report the catalog opens (`tests/e2e/lib/report-urls.mjs`,
   kept in step with the catalog by `tests/unit/sweep-english-rule.test.ts`) is visited, not only
   the catalog page.
4. Clicks: every enabled button, tab, switch, radio and menu item (destructive actions and
   paid AI calls skipped); a click fails when it throws, makes a failed request or does nothing
   observable (no navigation, DOM change, request, download, file chooser, scroll, print or
   clipboard write). An opened dialog is submitted empty and must answer with validation.

`tests/e2e/core-flows.mjs` (`npm run e2e:flows`) drives the release flows through the UI in
both languages, each on its own new owner (table at the end).

## Results

### Counts

- First full run (before fixes, base + WQ1): 1,492 page checks, 2,527 clicks, 520 failures
  (380 English-in-Arabic lines, 68 do-nothing clicks, 49 raw ids, 14 native inputs, 4 non-gate
  4xx, 2 404 pages, 2 non-RTL, 1 dialog without validation).
- Final full run (after fixes): 1,510 page checks, 2,505 clicks, 9 failures, all fixed and
  re-checked in delta runs (AI-written text in Arabic, a slow Evidence Center on the phone).
- Delta run over the WQ1 / AS1 / CASH-SERIES areas on ffa0c72 + fixes (trial, owner, accountant,
  viewer; en + ar; clicks in both): 356 page checks, 919 clicks, 0 failures.
- Core flows on the final build: 34 flow runs (17 flows x en, ar), 34 pass, nothing "in progress".

### Every route / state checked (final state)

"pass": no failure in the final runs. "fixed (rules)": failed the first run, passes now.
Viewports: desktop 1440 px unless marked (mobile = 390 px, mobile-more = the phone More sheet,
palette = command palette entry, file = file link checked for a download).
Out of scope: none. Saudi ZATCA was removed in STEP2 (`/settings/zatca` is the not-found page).
Not run: live provider calls (e-invoicing transmission, Stripe checkout,
e-mail delivery), which stay behind their configured boundaries.

| Route                                                       | Persona(s)                                                  | en   | ar   | Result                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ---- | ---- | ---------------------------------------------------- |
| `/`                                                         | visitor                                                     | pass | pass | pass                                                 |
| `/ (mobile)`                                                | visitor                                                     | pass | pass | pass                                                 |
| `/accounts/:id/ledger`                                      | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/accounts/:id/ledger (mobile)`                             | owner                                                       | pass | pass | pass                                                 |
| `/admin`                                                    | admin                                                       | pass | pass | pass                                                 |
| `/admin/activity-logs`                                      | admin                                                       | pass | pass | fixed (english-in-arabic)                            |
| `/admin/clients`                                            | admin                                                       | pass | pass | pass                                                 |
| `/admin/clients/:id`                                        | admin                                                       | pass | pass | pass                                                 |
| `/admin/clients/:id/documents`                              | admin                                                       | pass | pass | pass                                                 |
| `/admin/clients/:id/tasks`                                  | admin                                                       | pass | pass | pass                                                 |
| `/admin/dashboard`                                          | admin                                                       | pass | pass | pass                                                 |
| `/admin/documents`                                          | admin                                                       | pass | pass | pass                                                 |
| `/admin/import`                                             | admin                                                       | pass | pass | pass                                                 |
| `/admin/invitations`                                        | admin                                                       | pass | pass | pass                                                 |
| `/admin/users`                                              | admin                                                       | pass | pass | pass                                                 |
| `/advanced-analytics`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/advanced-analytics (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/advanced-reports`                                         | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/advanced-reports (mobile)`                                | trial, owner                                                | pass | pass | pass                                                 |
| `/ai`                                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/ai (mobile)`                                              | trial, owner                                                | pass | pass | pass                                                 |
| `/ai-cfo`                                                   | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/ai-cfo (mobile)`                                          | trial, owner                                                | pass | pass | pass                                                 |
| `/ai-chat`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/ai-chat (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/ai-features`                                              | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/ai-features (mobile)`                                     | trial, owner                                                | pass | pass | pass                                                 |
| `/ai-inbox`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/ai-inbox (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/analytics`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/analytics (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/anomaly-detection`                                        | trial, owner, accountant, viewer                            | pass | pass | fixed (uuid, english-in-arabic)                      |
| `/anomaly-detection (mobile)`                               | trial, owner                                                | pass | pass | fixed (uuid, english-in-arabic)                      |
| `/assistant`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/assistant (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/auto-reconcile`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/auto-reconcile (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/backup-restore`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/backup-restore (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/bank-accounts`                                            | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/bank-accounts (mobile)`                                   | trial, owner                                                | pass | pass | pass                                                 |
| [Historical route name redacted]                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| [Historical route name redacted] (mobile)                  | trial, owner                                                | pass | pass | pass                                                 |
| [Historical callback route name redacted]                                      | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| [Historical callback route name redacted] (mobile)                             | trial, owner                                                | pass | pass | pass                                                 |
| `/bank-reconciliation`                                      | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/bank-reconciliation (mobile)`                             | trial, owner                                                | pass | pass | pass                                                 |
| `/bank-reconciliation?import=1`                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/banking`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/banking (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/bill-pay`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/bill-pay (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/bill-pay?tab=bills&status=open`                           | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/bill-pay/:id/edit`                                        | owner                                                       | pass | pass | pass                                                 |
| `/bill-pay/:id/edit (mobile)`                               | owner                                                       | pass | pass | fixed (native-input)                                 |
| `/bill-pay/new`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/bill-pay/new (mobile)`                                    | trial, owner                                                | pass | pass | fixed (native-input)                                 |
| `/budgets`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/budgets (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/cashflow-forecast`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/cashflow-forecast (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/chart-of-accounts`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/chart-of-accounts (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/client-portal/dashboard`                                  | portal                                                      | pass | pass | pass                                                 |
| `/client-portal/documents`                                  | portal                                                      | pass | pass | pass                                                 |
| `/client-portal/invoices`                                   | portal                                                      | pass | pass | pass                                                 |
| `/client-portal/messages`                                   | portal                                                      | pass | pass | pass                                                 |
| `/client-portal/statements`                                 | portal                                                      | pass | pass | pass                                                 |
| `/company-groups`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/company-groups (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/company-profile`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/company-profile (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/compliance`                                               | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/compliance (mobile)`                                      | trial, owner                                                | pass | pass | pass                                                 |
| `/compliance-calendar`                                      | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/compliance-calendar (mobile)`                             | trial, owner                                                | pass | pass | pass                                                 |
| `/compliance-calendar?filter=open`                          | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/consolidation`                                            | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/consolidation (mobile)`                                   | trial, owner                                                | pass | pass | pass                                                 |
| `/contacts`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/contacts (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/cookies`                                                  | visitor                                                     | pass | pass | pass                                                 |
| `/cookies (mobile)`                                         | visitor                                                     | pass | pass | pass                                                 |
| `/corporate-tax`                                            | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/corporate-tax (mobile)`                                   | trial, owner                                                | pass | pass | pass                                                 |
| `/cost-centers`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/cost-centers (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/credit-notes`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/credit-notes (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/credit-notes/new`                                         | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/credit-notes/new (mobile)`                                | trial, owner                                                | pass | pass | pass                                                 |
| `/dashboard`                                                | visitor, trial, owner, accountant, viewer, firmStaff, admin | pass | pass | fixed (english-in-arabic)                            |
| `/dashboard (mobile)`                                       | visitor, trial, owner                                       | pass | pass | fixed (english-in-arabic)                            |
| `/debit-notes`                                              | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/debit-notes (mobile)`                                     | trial, owner                                                | pass | pass | pass                                                 |
| `/debit-notes/new`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/debit-notes/new (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/demo`                                                     | visitor                                                     | pass | pass | pass                                                 |
| `/demo (mobile)`                                            | visitor                                                     | pass | pass | pass                                                 |
| `/developer-settings`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/developer-settings (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/document-vault`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/document-vault (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/document-versions`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/document-versions (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/evidence-center`                                          | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/evidence-center (mobile)`                                 | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/evidence-center?sourceType=bill_payment&sourceId=:id`     | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/exchange-rates`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/exchange-rates (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/expense-claims`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/expense-claims (mobile)`                                  | trial, owner                                                | pass | pass | pass                                                 |
| `/feedback`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/feedback (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/financial-statements`                                     | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/financial-statements (mobile)`                            | trial, owner                                                | pass | pass | pass                                                 |
| `/firm-relationship`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/firm-relationship (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/firm/analytics`                                           | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/bulk`                                                | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/clients`                                             | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/clients/:id`                                         | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/command-center`                                      | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/comms`                                               | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/document-chasing`                                    | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/email-intake`                                        | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/health`                                              | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/pipeline`                                            | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/practice`                                            | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/staff`                                               | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/firm/value-ops`                                           | firmStaff, admin                                            | pass | pass | fixed (english-in-arabic)                            |
| `/fixed-assets`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/fixed-assets (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/forgot-password`                                          | visitor                                                     | pass | pass | pass                                                 |
| `/forgot-password (mobile)`                                 | visitor                                                     | pass | pass | pass                                                 |
| `/help`                                                     | visitor                                                     | pass | pass | pass                                                 |
| `/help (mobile)`                                            | visitor                                                     | pass | pass | pass                                                 |
| `/history`                                                  | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/history (mobile)`                                         | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/import`                                                   | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/import (mobile)`                                          | trial, owner                                                | pass | pass | fixed (native-input)                                 |
| `/import?kind=trial_balance`                                | visitor                                                     | pass | pass | pass                                                 |
| `/integrations`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/integrations (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/integrations-hub`                                         | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/integrations-hub (mobile)`                                | trial, owner                                                | pass | pass | pass                                                 |
| `/inventory`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/inventory (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/invoice-templates`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/invoice-templates (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/invoices`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/invoices (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/invoices?new=1`                                           | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/invoices?open=:id`                                        | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/invoices?status=overdue`                                  | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/invoices/:id/edit`                                        | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/invoices/:id/edit (mobile)`                               | owner                                                       | pass | pass | pass                                                 |
| `/invoices/new`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/invoices/new (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/journal`                                                  | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/journal (mobile)`                                         | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/journal/:id`                                              | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/journal/:id (mobile)`                                     | owner                                                       | pass | pass | pass                                                 |
| `/login`                                                    | visitor                                                     | pass | pass | pass                                                 |
| `/login (mobile)`                                           | visitor                                                     | pass | pass | pass                                                 |
| `/migration-guides`                                         | visitor                                                     | pass | pass | pass                                                 |
| `/migration-guides (mobile)`                                | visitor                                                     | pass | pass | pass                                                 |
| `/month-end`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/month-end (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/news-feed`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/news-feed (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/notification-preferences`                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/notification-preferences (mobile)`                        | trial, owner                                                | pass | pass | pass                                                 |
| `/notifications`                                            | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/notifications (mobile)`                                   | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/onboarding`                                               | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/onboarding (mobile)`                                      | trial, owner                                                | pass | pass | pass                                                 |
| `/payment-chasing`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/payment-chasing (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/payroll`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/payroll (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/portal/:token`                                            | visitor                                                     | pass | pass | pass                                                 |
| `/portal/:token (mobile)`                                   | visitor                                                     | pass | pass | pass                                                 |
| `/portal/einvoicing-approve/:token`                         | visitor                                                     | pass | pass | fixed (english-in-arabic)                            |
| `/portal/einvoicing-approve/:token (mobile)`                | visitor                                                     | pass | pass | fixed (english-in-arabic)                            |
| `/pricing`                                                  | visitor                                                     | pass | pass | pass                                                 |
| `/pricing (mobile)`                                         | visitor                                                     | pass | pass | pass                                                 |
| `/privacy`                                                  | visitor                                                     | pass | pass | pass                                                 |
| `/privacy (mobile)`                                         | visitor                                                     | pass | pass | pass                                                 |
| `/purchase-orders`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/purchase-orders (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/purchase-orders/:id/edit`                                 | owner                                                       | pass | pass | pass                                                 |
| `/purchase-orders/:id/edit (mobile)`                        | owner                                                       | pass | pass | pass                                                 |
| `/purchase-orders/new`                                      | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/purchase-orders/new (mobile)`                             | trial, owner                                                | pass | pass | pass                                                 |
| `/quotes`                                                   | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/quotes (mobile)`                                          | trial, owner                                                | pass | pass | pass                                                 |
| `/quotes/:id/edit`                                          | owner                                                       | pass | pass | pass                                                 |
| `/quotes/:id/edit (mobile)`                                 | owner                                                       | pass | pass | pass                                                 |
| `/quotes/new`                                               | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/quotes/new (mobile)`                                      | trial, owner                                                | pass | pass | pass                                                 |
| `/receipt-autopilot`                                        | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/receipt-autopilot (mobile)`                               | trial, owner                                                | pass | pass | pass                                                 |
| `/receipts`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/receipts (mobile)`                                        | trial, owner                                                | pass | pass | fixed (native-input)                                 |
| `/reconciliation-rules`                                     | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/reconciliation-rules (mobile)`                            | trial, owner                                                | pass | pass | pass                                                 |
| `/recurring-invoices`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/recurring-invoices (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/recurring-invoices/new`                                   | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/recurring-invoices/new (mobile)`                          | trial, owner                                                | pass | pass | pass                                                 |
| `/register`                                                 | visitor                                                     | pass | pass | pass                                                 |
| `/register (mobile)`                                        | visitor                                                     | pass | pass | pass                                                 |
| `/reminders`                                                | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/reminders (mobile)`                                       | trial, owner                                                | pass | pass | pass                                                 |
| `/reports`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/reports (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/reports?persona=accountant`                               | trial                                                       | pass | pass | pass                                                 |
| `/reports?persona=owner`                                    | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/reports?report=balance-sheet&asOf=2026-11-18`             | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/reports?report=profit-loss&from=2026-11-01&to=2026-11-18` | owner, accountant, viewer                                   | pass | pass | pass                                                 |
| `/reports?tab=trial&report=trial-balance`                   | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/reports/statements-of-account`                            | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/reports/statements-of-account (mobile)`                   | trial, owner                                                | pass | pass | pass                                                 |
| `/reset-password?token=synthetic-preview-token`             | visitor                                                     | pass | pass | pass                                                 |
| `/reset-password?token=synthetic-preview-token (mobile)`    | visitor                                                     | pass | pass | pass                                                 |
| `/sales/cash-sale`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/sales/cash-sale (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/sales/receive-payment`                                    | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/sales/receive-payment (mobile)`                           | trial, owner                                                | pass | pass | pass                                                 |
| `/samples/muhasib-sample-invoice.pdf (file)`                | visitor                                                     | pass | pass | pass                                                 |
| `/services`                                                 | visitor                                                     | pass | pass | pass                                                 |
| `/services (mobile)`                                        | visitor                                                     | pass | pass | pass                                                 |
| `/settings`                                                 | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/settings (mobile)`                                        | trial, owner                                                | pass | pass | pass                                                 |
| `/settings/approvals`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/settings/approvals (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/settings/company`                                         | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/settings/company (mobile)`                                | trial, owner                                                | pass | pass | pass                                                 |
| `/settings/einvoicing`                                      | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/settings/einvoicing (mobile)`                             | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/settings/numbering`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/settings/numbering (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/settings/security`                                        | trial, owner, accountant, viewer                            | pass | pass | fixed (english-in-arabic)                            |
| `/settings/security (mobile)`                               | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `/settings/tax-rates`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/settings/tax-rates (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/smart-assistant`                                          | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/smart-assistant (mobile)`                                 | trial, owner                                                | pass | pass | pass                                                 |
| `/subscription`                                             | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/subscription (mobile)`                                    | trial, owner                                                | pass | pass | pass                                                 |
| `/task-center`                                              | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/task-center (mobile)`                                     | trial, owner                                                | pass | pass | pass                                                 |
| `/tax-return-archive`                                       | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/tax-return-archive (mobile)`                              | trial, owner                                                | pass | pass | pass                                                 |
| `/team`                                                     | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/team (mobile)`                                            | trial, owner                                                | pass | pass | pass                                                 |
| `/terms`                                                    | visitor                                                     | pass | pass | pass                                                 |
| `/terms (mobile)`                                           | visitor                                                     | pass | pass | pass                                                 |
| `/trust`                                                    | visitor                                                     | pass | pass | pass                                                 |
| `/trust (mobile)`                                           | visitor                                                     | pass | pass | pass                                                 |
| `/vat-autopilot`                                            | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/vat-autopilot (mobile)`                                   | trial, owner                                                | pass | pass | pass                                                 |
| `/vat-filing`                                               | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/vat-filing (mobile)`                                      | trial, owner                                                | pass | pass | pass                                                 |
| `/vendors`                                                  | trial, owner, accountant, viewer                            | pass | pass | pass                                                 |
| `/vendors (mobile)`                                         | trial, owner                                                | pass | pass | pass                                                 |
| `/verify-email`                                             | visitor                                                     | pass | pass | pass                                                 |
| `/verify-email (mobile)`                                    | visitor                                                     | pass | pass | pass                                                 |
| `/view/invoice/:token`                                      | visitor                                                     | pass | pass | pass                                                 |
| `/view/invoice/:token (mobile)`                             | visitor                                                     | pass | pass | pass                                                 |
| `more:mobile-more-ai (mobile-more)`                         | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-banking.accounts.title (mobile-more)`     | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-bankReconciliation (mobile-more)`         | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-billPay (mobile-more)`                    | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-budgets (mobile-more)`                    | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-chartOfAccounts (mobile-more)`            | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-complianceCalendar (mobile-more)`         | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-contacts (mobile-more)`                   | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-corporateTax (mobile-more)`               | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-costCenters (mobile-more)`                | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-creditNotes (mobile-more)`                | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-einvoicing-settings (mobile-more)`        | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `more:mobile-more-evidenceCenter (mobile-more)`             | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `more:mobile-more-exchangeRates (mobile-more)`              | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-expenseClaims (mobile-more)`              | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-fixedAssets (mobile-more)`                | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-inventory (mobile-more)`                  | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-journal (mobile-more)`                    | trial, owner                                                | pass | pass | fixed (english-in-arabic)                            |
| `more:mobile-more-monthEndClose (mobile-more)`              | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-pages.vendor (mobile-more)`               | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-paymentChasing (mobile-more)`             | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-payroll (mobile-more)`                    | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-purchaseOrders (mobile-more)`             | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-quotes (mobile-more)`                     | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-recurringInvoices (mobile-more)`          | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-settings (mobile-more)`                   | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-taxReturnArchive (mobile-more)`           | trial, owner                                                | pass | pass | pass                                                 |
| `more:mobile-more-vatFiling (mobile-more)`                  | trial, owner                                                | pass | pass | pass                                                 |
| `palette:command-item-action-new-invoice (palette)`         | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-action-new-journal (palette)`         | owner                                                       | pass | pass | fixed (english-in-arabic)                            |
| `palette:command-item-action-scan-receipt (palette)`        | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-aichat (palette)`                 | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-bank (palette)`                   | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-billpay (palette)`                | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-contacts (palette)`               | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-corp-tax (palette)`               | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-dashboard (palette)`              | owner                                                       | pass | pass | fixed (english-in-arabic)                            |
| `palette:command-item-nav-inventory (palette)`              | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-invoices (palette)`               | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-journal (palette)`                | owner                                                       | pass | pass | fixed (english-in-arabic)                            |
| `palette:command-item-nav-payroll (palette)`                | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-receipts (palette)`               | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-reports (palette)`                | owner                                                       | pass | pass | pass                                                 |
| `palette:command-item-nav-vat (palette)`                    | owner                                                       | pass | pass | pass                                                 |
| `more:mobile-language-toggle (mobile-more)`                 | –                                                           | –    | –    | fixed (not-rtl, english-in-arabic; no longer linked) |
| `/journal-entries?status=draft`                             | –                                                           | –    | –    | fixed (not-found-page; no longer linked)             |
| `/evidence-center?sourceType=inventory&sourceId=:id`        | –                                                           | –    | –    | fixed (english-in-arabic; no longer linked)          |

318 routes/states checked in the final run(s): 273 pass, 45 fixed, 0 failing; 3652 clicks.

STEP2 delta (2026-11-19, 246a8dd): the `/settings/zatca` rows were removed; the `no-ksa-rate` and
`invoices` flows were re-run in en and ar and pass.

Authorization return recheck (2026-11-21, PR #75). In local Chromium with a simulated processor,
the callback returned HTTP 201 in English and Arabic RTL. The browser cleared the temporary query
parameters and displayed the localized CSV statement screen. The check recorded zero browser
console errors or failed API requests.

### Core flows (UI, final build)

| Flow           | Step                                                                   | en   | ar   |
| -------------- | ---------------------------------------------------------------------- | ---- | ---- |
| signup         | register page renders in the chosen language                           | pass | pass |
| signup         | in-page switch to the other language and back keeps the form working   | pass | pass |
| signup         | register with name/email/password lands in onboarding (no e-mail step) | pass | pass |
| signup         | trial claim / trial banner shows after onboarding                      | pass | pass |
| onboarding     | industry picker offers templates and accepts one                       | pass | pass |
| onboarding     | a second device resumes at the same step                               | pass | pass |
| second-company | company switcher > New company creates it and opens its onboarding     | pass | pass |
| second-company | trial cap (3 companies): the fourth is refused with the plan dialog    | pass | pass |
| coa            | Add account drawer creates the account                                 | pass | pass |
| coa            | edit the account name                                                  | pass | pass |
| invoices       | editor: create a draft and issue it from the nudge                     | pass | pass |
| invoices       | draft invoice editor Checks tab lists the checks                       | pass | pass |
| invoices       | issued invoice opens as the locked read-only document                  | pass | pass |
| invoices       | PDF downloads                                                          | pass | pass |
| invoices       | share link opens for a signed-out customer                             | pass | pass |
| invoices       | sent and viewed log records the customer's view                        | pass | pass |
| invoices       | record a payment on the invoice                                        | pass | pass |
| invoices       | receive one payment across several invoices                            | pass | pass |
| invoices       | full credit note from an issued invoice (prefilled editor)             | pass | pass |
| invoices       | partial credit note from an invoice                                    | pass | pass |
| invoices       | make recurring from an invoice                                         | pass | pass |
| quotes         | create a quote and convert it to an invoice                            | pass | pass |
| quote-email    | send a quote by e-mail from the row menu                               | pass | pass |
| cash-sale      | record a cash sale: CS number, paid at once                            | pass | pass |
| cash-sale      | Settings > Numbering changes a prefix                                  | pass | pass |
| purchases      | bill editor: supplier picker '+ New supplier', upload, save            | pass | pass |
| purchases      | approve and pay a bill                                                 | pass | pass |
| purchases      | debit note against the bill                                            | pass | pass |
| purchases      | PO -> bill                                                             | pass | pass |
| purchases      | expense claim with receipt                                             | pass | pass |
| bank           | import a statement CSV through the mapper                              | pass | pass |
| bank           | suggestions and rules tabs open                                        | pass | pass |
| bank           | match a transaction, then unmatch it                                   | pass | pass |
| vat            | prepare the return for last quarter                                    | pass | pass |
| vat            | mark ready, record filing with an FTA reference                        | pass | pass |
| vat            | record the payment                                                     | pass | pass |
| vat            | periods tab and compliance calendar show the quarter filed             | pass | pass |
| reports        | /financial-statements renders                                          | pass | pass |
| reports        | /reports renders                                                       | pass | pass |
| reports        | /reports/statements-of-account renders                                 | pass | pass |
| reports        | /cashflow-forecast renders                                             | pass | pass |
| reports        | /analytics renders                                                     | pass | pass |
| reports        | aging report via the report catalog API                                | pass | pass |
| plans          | trial banner and plan cards on /subscription                           | pass | pass |
| plans          | choose a plan -> contact (checkout not configured)                     | pass | pass |
| plans          | admin sets the plan                                                    | pass | pass |
| einvoicing     | both partners offered, none chosen, not connected                      | pass | pass |
| einvoicing     | approver link page shows the display name only (no TRN / TIN)          | pass | pass |
| assistant      | Ask answers a question                                                 | pass | pass |
| assistant      | Review scan runs                                                       | pass | pass |
| assistant      | Automations switch toggles and persists                                | pass | pass |
| no-ksa-rate    | invoice: no 15% option                                                 | pass | pass |
| no-ksa-rate    | quote: no 15% option                                                   | pass | pass |
| no-ksa-rate    | credit note: no 15% option                                             | pass | pass |
| no-ksa-rate    | bill: no 15% option                                                    | pass | pass |
| no-ksa-rate    | purchase order: no 15% option                                          | pass | pass |
| no-ksa-rate    | debit note: no 15% option                                              | pass | pass |
| no-ksa-rate    | recurring invoice: no 15% option                                       | pass | pass |
| no-ksa-rate    | company settings: no 15% option                                        | pass | pass |
| no-ksa-rate    | tax rates: no 15% option                                               | pass | pass |
| no-ksa-rate    | /settings/zatca is the not-found page, with no ZATCA text              | pass | pass |
| no-ksa-rate    | /settings/einvoicing has no ZATCA text or link                         | pass | pass |
| no-ksa-rate    | API: /api/features and the ZATCA routes are 404                        | pass | pass |
| prices         | API plans: 59 / 119 / 229 monthly, 590 / 1,190 / 2,290 yearly          | pass | pass |
| prices         | /pricing monthly shows 59 / 119 / 229                                  | pass | pass |
| prices         | /pricing yearly shows 590 / 1,190 / 2,290                              | pass | pass |

## What was broken and how it was fixed

Each item: what the sweep or a flow saw, the root cause, the fix, and the regression test.

1. **Invoices > Deposits crashed** ("filter is not a function", error boundary). The dialog read
   the paged invoice list as an array. Now asks for `?all=true`. Test: `tests/unit/sweep-fixes-ui.test.ts`.
2. **No way to create a second company.** The switcher only switched; Settings offered "Create your
   company" only with none. New "New company" item in the company switcher (`NewCompanyDialog`):
   validates the name, creates it, switches and opens onboarding; the plan cap (3 on trial) shows
   the plan dialog. Tests: unit (dialog), flow `second-company` (en, ar).
3. **Notification links opened the 404 page**: `/invoices/<id>`, `/banking`, `/compliance`,
   `/settings`, `/journal-entries?status=draft`. The server now writes real routes
   (`shared/app-links.ts` `invoiceHref`, bank statement upload, `/compliance-calendar`, `/task-center`,
   `/settings/security`, `/journal`); App.tsx redirects the old links already stored. Test:
   `tests/unit/app-links-routes.test.ts` (every stored literal link, incl. raw SQL `action_url`,
   is a non-redirect client route).
4. **Reports in Arabic were English** (trial balance, balance sheet, P&L, VAT, sales, expenses,
   ledger, balances, close, CT, payroll, planning tabs): hard-coded headings, raw account types
   ("expense"), English account names, `MMM dd, yyyy` dates. Catalog keys
   (`reportCenter.tabs.*`), Arabic account names, `formatDateRange`. Tests: unit (TB render in
   Arabic), `report-discovery` updated to the keys; sweep (ar).
5. **Activity log / security history in Arabic showed English** ("Company invitation", "Compliance
   obligation completed", "Corporate tax return pulled from books", "Bank reconcile confirm
   entry"). 57 entity labels, missing action labels, and status-built codes composed from entity +
   status labels. Test: `activity-log-label-coverage` (now also helper-passed codes and
   status-built codes).
6. **Evidence Center** showed a raw UUID ("Showing proof rows for Invoice 53402a18-…") and
   English month-end checks ("Control accounts reconciled"). Shows the document number; month-end
   sentences localised. Tests: unit (`broken-path-sweep-rules`), sweep.
7. **Anomaly findings quoted record ids** ("Invoice with ID '77cb…'") and AI types showed raw
   ("potential_fraud"). Server replaces ids with document numbers before storing; stored text
   drops them; AI types have labels; AI-written English is marked `lang="en"` in Arabic. Tests:
   unit.
8. **AI bank categorisation**: memos "AI Draft (review required): …" and the drafts notice were
   English-only, and the notice linked to a missing page. Memo shapes localised, notice is
   catalog copy (old stored wording still recognised), link `/journal`. Tests: unit.
9. **Bill capture preview never showed in production**: `fetch(data:)` blocked by CSP
   `connect-src 'self'`, and the blob iframe by `default-src`. Data URL decoded in the page
   (`dataUrlToBlob`); `frame-src 'self' blob:` in both policies. Tests: unit; flow `purchases`.
10. **Admin and firm consoles bounced to onboarding** when the staffer's own company was
    unfinished. `/admin` and `/firm` are exempt from the customer onboarding redirect. Test: flow
    `plans` (admin sets the plan).
11. **Do-nothing buttons**: Admin "Export data" and "Refresh", Activity logs "Export logs" (no
    handler); Financial statements "Generate" with unchanged dates; Compliance calendar "Today" on
    the current month (now disabled); Admin invitations "Send invitation" empty (only the browser
    bubble; now in-app validation). Selected filter chips now expose `aria-pressed` (firm
    portfolio, backup schedule). Tests: sweep clicks.
12. **Chart of accounts search ignored account codes** ("6100" found nothing). Searches the code
    too. Test: flow `coa`.
13. **Debit note editor used a native date input.** Uses the app `DatePicker`. Test: sweep
    (native-input rule).
14. **Bank import in Arabic**: "Detected: Generic (Arabic/English)" and the import notification's
    "(generic format)" were English. Localised label; notification names the format (CSV / bank).
    Tests: unit, flow `bank` (ar checks the mapper text).
15. **Approver page and partner steps**: partner legal names read as untranslated copy and the
    language button was untagged mixed text. Names in a `translate="no"` span; the button names
    the target language with its `lang`. Test: unit.
16. **Receive payment with no saved customers** opened an empty picker (dead end). Explains and
    links to Customers. Test: flow `invoices`.
17. **Security > devices**: raw user-agent strings marked as data (`translate="no"`).

### CI

Not added to the Browser E2E job: that job runs the dev server (React development warnings would
count as console errors) and its 25-minute budget is used by the full route crawl; a sweep subset
on a production build needs its own job.

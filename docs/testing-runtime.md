# Testing and runtime notes

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- Vitest uses `tests/setup.ts`, which sets `NODE_ENV=test`, `PORT=5001`, and a test
  `DATABASE_URL`.
- Vitest and ESLint intentionally exclude `.claude/` and `.claire/` worktrees. Do not use those as
  source-of-truth unless the task explicitly targets them.
- In development, `npm run dev` starts Express on `PORT` (default `5000`) and mounts
  Vite in middleware mode; there is no separate client dev script.
- For cookie/session-based state-changing API requests, fetch `/api/csrf-token` and send
  the returned value as `X-CSRF-Token`; Bearer-auth requests are CSRF-exempt.
- The Docker/Railway runtime expects a Node 20.19+ production build because the Vite/Rolldown
  toolchain requires at least Node 20.19. Keep the production Docker base on Debian slim/glibc
  rather than Alpine/musl for the Vite 8/Rolldown native bindings. `/health/live` is the cheap
  liveness probe; `/health` is DB-backed readiness/full health.
- After dependency changes, validate the Railway install path with
  `npx -p node@20.19.0 -p npm@10.8.2 -c "npm ci --omit=dev --ignore-scripts"` so npm 10
  lockfile/platform issues are caught before deployment.
- For a containerized local stack, `docker compose up --build` starts the app plus Postgres 16
  using `.env` and persists `pgdata`/`uploads` volumes.
- For authenticated endpoint smoke testing, run `bash tests/test-firm-endpoints.sh` with
  `TEST_BASE`, `TEST_EMAIL`, and `TEST_PASS` set explicitly. The script deliberately has no
  production URL or password defaults.
- For read-only production smoke testing, run
  `SMOKE_READ_ONLY=true SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod -- <url>`.
- Railway production deploys from `origin/main`; pushing only a feature/Codex branch will not update
  production until `main` is fast-forwarded or otherwise deployed, and `/api/version` reports the
  expected commit.
- For authenticated staging/firm smoke testing, run
  `SMOKE_BASE_URL=<url> SMOKE_EMAIL=<email> SMOKE_PASSWORD=<password> npm run smoke:prod`.
  Set `SMOKE_REQUIRE_OAUTH_CONFIG=true` when OAuth providers must be configured, and use
  `SMOKE_WORKSPACE_MUTATIONS=true` only on disposable staging targets because it writes VAT
  workpaper rows and refreshes growth-opportunity data.
- For authenticated read-only browser route crawl of a deployed target, run
  `SMOKE_BASE_URL=<url> SMOKE_EMAIL=<email> SMOKE_PASSWORD=<password> SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod:routes`.
  It logs in with the existing smoke user and crawls protected routes without creating accounting
  records. Use `AUTH_CRAWL_PROFILE=firm|customer|all` or `AUTH_CRAWL_ROUTES=/dashboard,/reports`
  to scope the route set.
- `npm run security:verify-prod` requires `DATABASE_URL`; Railway production uses a private
  `postgres.railway.internal` URL, so run this inside the Railway network or through Railway SSH
  after an SSH key is registered. Set `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true` after rotating
  production JWT secrets so the verification run records that acknowledgement.
- `npm run e2e` requires a running app plus `BASE_URL` and `DATABASE_URL`; it registers a
  fresh user, promotes it through Postgres, crawls workspace routes, and posts a balanced journal.
- `npm run e2e:customer` requires a running app and optional `BASE_URL`; it registers a fresh
  SaaS customer without Postgres role promotion, crawls public/launch-critical customer routes,
  reruns mobile checks for invoices, receipts, banking, reports, and VAT, exercises
  journal/invoice/bank-import flows, and verifies NR-only WhatsApp/document-chasing, firm, and
  admin surfaces stay blocked. Full mode refuses non-local `BASE_URL` unless
  `CUSTOMER_E2E_ALLOW_REMOTE_MUTATION=true` is set and either cleanup admin credentials are present
  or `CUSTOMER_E2E_ALLOW_REMOTE_WITHOUT_CLEANUP=true` is explicitly set for an already-disposable
  target. For remote cleanup, set `CUSTOMER_E2E_CLEANUP_ADMIN_EMAIL` and
  `CUSTOMER_E2E_CLEANUP_ADMIN_PASS`; add `CUSTOMER_E2E_CLEANUP_DELETE_USER=true` only when the
  generated user should be deleted too. The runner writes the created user/company IDs to
  `tests/e2e/.artifacts/customer-launch-last-run.json`.
- Broken-path sweep (pre-release, local disposable target only): start a production build on a
  scratch database (`npm run build`, migrate, `NODE_ENV=production ALLOW_LOCAL_STORAGE=true
BASE_URL=http://localhost:<port> CORS_ORIGIN=http://localhost:<port> node dist/index.js`), then
  `BASE_URL=http://localhost:<port> DATABASE_URL=<scratch db> npm run e2e:sweep`. It seeds nine
  personas (`tests/e2e/lib/sweep-personas.mjs`: trial owner, populated owner via the report audit
  fixture, the same books with Arabic data (`ownerAr`, strict Arabic check, nothing excused),
  accountant, viewer, firm staff, NR admin, client-portal user, visitor), loads every
  App.tsx route plus every in-app link it finds in en and ar, clicks every enabled control
  (destructive ones skipped), submits opened dialogs empty, walks the command palette and the
  mobile More sheet, and fails on 4xx/5xx, 404 pages, blank pages, console/page errors, failed
  requests, horizontal scroll, native date/select/file inputs, raw keys / placeholders / UUIDs
  and English in Arabic. Report: `tests/e2e/.artifacts/broken-path-sweep-last-run.json`;
  deliberate exceptions (with reasons) live in `tests/e2e/lib/sweep-allow.mjs`. Delta runs:
  `SWEEP_REUSE=true` reuses the seeded personas; narrow with `SWEEP_PERSONAS`, `SWEEP_LANGS`,
  `SWEEP_ROUTES`, `SWEEP_CLICKS=false`, `SWEEP_MOBILE=false`, `SWEEP_PALETTE=false` (header of
  `tests/e2e/broken-path-sweep.mjs`). A full run takes 2-3 hours on 4 CPUs; run it under the
  heavy-step lock.
- Customer links: `BASE_URL=http://localhost:<port> DATABASE_URL=<app db> npm run e2e:customer-links`
  (`tests/e2e/customer-links-flow.mjs`; local production build with FRONTEND_URL = BASE_URL, no e-mail
  provider, restart the app between runs). Sends invoice, reminder, quote, statement and EmaraTax
  approval mail for an English company, an Arabic company and an Arabic-preferring contact, reads
  it from the outbox, opens every link signed out at iPhone 13 and 1440x900 and checks language,
  absolute links, console, overflow, 44 px targets, PDF/print and no TRN. Route-level twin:
  `tests/db/customer-links-flow.test.ts`. `SHOT_DIR` saves screenshots.
- Per-client e-invoicing: `BASE_URL=http://localhost:<port> DATABASE_URL=<app db> npm run e2e:einvoice-client`
  (`tests/e2e/einvoice-client-flow.mjs`; local production build, no provider credentials). From a
  client's books (company owner, and NR firm staff via "Open books") at iPhone 13, 360 px and
  1440x900 in English and Arabic: settings and provider choice (none pre-selected), generate with
  the two coded buyer issues, the status sheet and XML/PDF download, submit refused without a
  provider, the approval request, the bilingual approver e-mail, the no-login page (done, used,
  expired, revoked, invalid), the outcome in the client's page and the firm column, failing lists,
  and every customer e-mail template rendered at 375/700/1000 px. `SHOT_DIR` saves screenshots.
- Sign-in, recovery, pricing and client portal: same target, `npm run e2e:auth-portal`
  (`tests/e2e/auth-portal-flow.mjs`; also writes a client-portal member through `DATABASE_URL`). For
  iPhone SE, a 360x740 Android, iPhone 13 and 1440x900 in English and Arabic it opens `/login` (empty,
  wrong password, keyboard open), `/forgot-password`, `/reset-password`, `/pricing` and the five
  `/client-portal/*` pages and checks console, requests, overflow, 16 px inputs, 44 px targets, text
  under 12 px, English in Arabic, axe serious/critical, autocomplete attributes, the localized Enterprise
  mailto subject, the light portal root (no signed-in app, motion or socket) and the PDF download and
  its failure message. Restart the app between runs (sign-in throttling); about 15 minutes.
- Accounting pages: same target, `npm run e2e:books-pages` (`tests/e2e/books-pages-flow.mjs`; writes
  the admin flag through `DATABASE_URL`). Seeds a company through the app's APIs (69 journals incl.
  reversed and draft, invoices, a bill, a 45-line bank import with matches and rules), an empty
  company and a platform admin, then opens Journal, entry detail, account ledger, bank
  reconciliation (all tabs), Reports plus 26 report screens and Admin documents at 1440, iPhone 13
  and 360 px in en and ar, with empty, failing-API (route interception) and unknown-id states, and
  checks console, requests, overflow, 44 px targets, raw keys, English in Arabic and axe. About
  20-30 minutes in one process (`E2E_VIEWPORTS`, `E2E_LANGS`, `E2E_ONLY` narrow it). The 360 px
  customer links run is `E2E_VIEWPORTS=android npm run e2e:customer-links` on a restarted app.
- Firm and accountant tools: same target, `npm run e2e:firm-tools` (`tests/e2e/firm-tools-flow.mjs`;
  writes firm roles through `DATABASE_URL`; `CHROMIUM_PATH` falls back to
  `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`). Seeds an NR firm owner whose own company is not
  onboarded, an assigned and an unassigned preparer, 28 clients, assignments, a part-paid invoice and an
  e-invoice state. For an iPhone 13, a 360 px Android and 1440x900 in English and Arabic it opens the
  firm dashboard, client list, "Open books" (must land on the client's `/dashboard`, never `/onboarding`),
  client profile, the invoice list and e-invoicing settings in a client's books, the staff views and
  failing-API variants, and checks console, requests, overflow, raw catalog keys, 44 px targets in the
  content area, English in Arabic, axe serious/critical and that the firm workspace downloads no
  report-catalog or admin chunk. It ends with a first-load budget (iPhone 13, 4x CPU, Slow 4G, cold
  cache, both landing screens, en and ar): served from the firm build, at most 50 requests and 25
  scripts, largest contentful paint under 9 s (about 4.7-5.1 s measured; the margin is for slow
  runners, it is a tripwire for a return to the shared-chunk layout, not the target). Run it on a
  fresh database: the "Unassigned" count assumes the seeded clients are the only ones.
  `SHOT_DIR` saves screenshots.
- Core release flows: same target, `npm run e2e:flows` (`tests/e2e/core-flows.mjs`; `FLOWS=id,..`
  and `FLOWS_LANGS` narrow it). Steps in areas still being built are tagged `wip` and reported as
  "in progress" (`FLOWS_STRICT_WIP=true` makes them fail). Report:
  `tests/e2e/.artifacts/core-flows-last-run.json`. Results of the release run:
  [docs/release/BROKEN-PATH-SWEEP.md](release/BROKEN-PATH-SWEEP.md).
- For read-only production/ad-route customer launch QA, run
  `BASE_URL=<url> npm run e2e:customer:public`; it crawls only public launch routes and does not
  register users or create accounting records. The crawl includes public ad, auth, and legal routes
  such as `/services`, `/register`, and `/privacy`, and fails rendered unsupported launch claims.
  If Playwright cannot find Chromium, install the project browser once with
  `npx playwright-core install chromium` or set `CHROMIUM_PATH` to an existing browser binary.
- Use `npx vitest run tests/unit/public-launch-surface.test.ts` after public marketing, SEO,
  trust, help, migration, or public-route changes to catch unsupported compliance/security claims.
- Use `npx vitest run tests/unit/command-palette-a11y.test.ts` after command palette dialog or
  shortcut shell changes.
- Keep the public sample-data demo workspace routed at `/demo`; after demo, onboarding, or
  claim-copy changes, include `tests/unit/public-launch-surface.test.ts` in the focused run.
- Use `npx vitest run tests/unit/vat201-export.test.ts` after VAT 201 export mapping or workbook
  copy changes.
- Use `npx vitest run tests/unit/page-source-guards.test.ts` after bank statement import or
  reconciliation UX changes, especially sample CSV and duplicate-import messaging.
- Use `npx vitest run tests/unit/bank-statement-import.test.ts` after bank CSV parser/header
  detection changes, especially Arabic headers or amount-plus-Dr/Cr statement formats.
- Use `npx vitest run tests/unit/page-source-guards.test.ts` after mobile layout changes on invoices,
  receipts, banking, VAT, or other launch-critical SaaS screens.
- Use `npx vitest run tests/unit/report-discovery.test.ts` after report tabs, report command
  palette shortcuts/direct delivery queue or retry actions, persona workspaces, report operations
  navigation, report decision-question metadata, decision shortcut paths, automation starter paths,
  report trigger-rule paths, persona report coverage, automation-signal persona scope, automation starter/rule/impact report coverage, role setup paths, report-suite delivery/trigger-rule links/readiness/queue actions, quick-access/saved-view/automation-impact
  profiles/surfaces/navigation/onboarding, delivery subscription paths/settings controls, suite-aware delivery previews/run-history
  timeline filters, delivery recovery summaries, persona command strips/pinned command preferences, workflow finder saved search/gap
  context/share links, command-palette suite queue actions/per-report automation actions, dashboard/command-palette/backend handoff acknowledgements, accountant handoff
  panels/workbook sheets/delivery previews, comparison presets/coverage, scheduled pack/delivery report coverage, report coverage maps, report pack
  templates/exports, or report deep-link behavior changes.
- Use `npx vitest run tests/unit/report-catalog-routes.test.ts` after the authenticated report
  catalog discovery API, typed client, contract guard,
  report-suite/quick-access/saved-view/automation-impact catalog payload, report-suite delivery or
  trigger-rule links, or persona catalog filtering changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts` after shared report launcher/picker
  changes, dashboard next-action ranking, queue/retry actions, delivery-run feedback, or
  dashboard/report-surface integrations that consume the catalog API.
- Use `npx vitest run tests/unit/report-export-helpers.test.ts` after report workbook sheets,
  persona pack workbook sheets, or export-helper mapping changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts tests/unit/report-catalog-routes.test.ts tests/unit/report-export-helpers.test.ts`
  after Cost Center P&L catalog status, profitability API, comparison metrics, report-pack, or
  delivery coverage changes.
- Use `npx vitest run tests/unit/report-discovery.test.ts tests/unit/report-catalog-routes.test.ts tests/unit/report-delivery-routes.test.ts tests/unit/report-delivery-scheduler.test.ts tests/unit/report-export-helpers.test.ts`
  after cross-surface report catalog, API context, launcher/dashboard queue action, delivery
  handoff, scheduler handoff-skip, and workbook export changes land together.
- Use `npx vitest run tests/unit/report-delivery-routes.test.ts` after report delivery
  subscription service, route, persisted settings, persisted automation-command preferences, run
  history/snapshots, suite-aware notification queueing, or failure-retry API/scheduling-plan changes.
- Use `npx vitest run tests/unit/report-delivery-scheduler.test.ts` after report delivery cadence,
  due-scan, handoff-review skips, guardrail, failure recovery, scheduler telemetry, or scheduler
  cron changes.
- Use `npx vitest run tests/unit/whatsapp-boundary.test.ts` after WhatsApp-related changes. The
  WhatsApp surface is NR firm-management-only and must not appear in public or customer SaaS UI.
- Document chasing is also an NR firm-management-only feature. Keep its UI under
  `/firm/document-chasing` and verify with
  `npx vitest run tests/unit/document-chasing-boundary.test.ts` after related route/nav/API changes.
- Customer portal invitations: `tests/db/portal-invitations.test.ts` (DB), `tests/unit/portal-join-page.test.ts`, `portal-product-step5` (unit) and `tests/db/portal-product-step5.test.ts`,
  `portal-invite-email`, `portal-invite-validators`, `csrf-exemptions` after portal, auth-cookie or CSRF changes;
  e2e `FLOWS=portal-invite,portal-invite-phone,portal-invite-existing`. An invitation that was not
  sent keeps no link in `email_outbox` (R5-9), so DB tests install the capturing transport in
  `tests/db/invite-mailbox.ts` and read the delivered mail; the e2e helper
  `tests/e2e/lib/portal-invite-mail.mjs` mints a token for the invitation on a disposable database.
  `tests/unit/portal-r5-ui.test.ts` covers the re-audit UI states (not-sent, removed-access page).
- `npm run test:coverage` is a baseline ratchet, not proof of broad route coverage; raise the
  thresholds as integration and route-level tests land.

## DB-backed tests and guards (moved from platform-rules.md)

- `npm run test:db` runs `tests/db/**/*.test.ts` against the real app and a freshly migrated
  Postgres database per test file (`useHarness()` in `tests/db/harness.ts`; only `harness_*`
  databases are created/dropped, PGlite fallback when `CREATE DATABASE` is not allowed). Use it
  for any persistence, posting, tenancy, or concurrency regression; name tests after issue ids.
  `tests/db/route-matrix.test.ts` is the cross-tenant route matrix; known gaps live as per-issue
  files in `tests/db/route-matrix-allow/` (the directory is absent when there are no gaps).
- `npm run check` ends with `scripts/run-guards.mjs`: `check-raw-body.mjs` (raw `req.body` in
  write routes), `check-ledger-writes.mjs` (any insert/update/delete, `transitionRow` or raw SQL
  write on `journal_entries`/`journal_lines` outside `server/ledger/`; baseline 0), and
  `check-i18n-ratchet.mjs` (hard-coded JSX strings). Baselines in `scripts/guard-baselines/` may
  only move down (`--update` after real progress).

## Firm first load (defect 14)

`npm run build` makes two client bundles of the same sources: `vite build` (public, portal, no-login
links and the whole app) and `FIRM_BUILD=1 vite build` (`client/firm.html` -> `src/firm-main.tsx`,
written to `dist/public/firm.html` and `dist/public/firm-assets/`, never touching the first). In the
firm build the signed-in app and the two landing screens (`/firm/clients`, `/firm/command-center`) are
static imports, so the first load is one entry chunk plus about nine vendor chunks (the main bundle
needed about 45 shared chunks, each a round trip on a phone over HTTP/1.1). `server/vite.ts` serves
`firm.html` for `/firm` and `/firm/*`; on the two landing screens it also preloads the first-screen
catalogs of the language cookie (`muhasib_locale`, set when signed in) and, when a session cookie is
present, starts the first-screen reads from an inline nonce script before any JavaScript arrives
(`client/src/lib/bootFetch.ts` adopts them). `shared/firm-boot.ts` is the one table behind all of it.
`scripts/precompress-assets.mjs` writes brotli (quality 11) twins of every JS/CSS asset and the server
sends them to browsers that accept brotli (about 15% smaller than the on-the-fly stream).

- Unit: `tests/unit/firm-boot.test.ts` (route table, catalog scope, document, brotli middleware),
  `tests/unit/firm-first-screen-keys.test.ts` (no first-screen key outside the first-screen
  catalogs), `tests/unit/first-load-chunks.test.ts` (build output: chunk count and weight of the
  firm entry, no firm chunk reachable from public/portal roots, no framer-motion in the shell). CI runs it, and the i18n code-split bundle check, right after `npm run build`
  with `REQUIRE_BUILD_OUTPUT=1`, which turns a missing build into a failure instead of a skip.
- When a firm landing screen starts reading a catalog key from another namespace, move or copy the
  key into `firm.json` (as was done for the e-invoicing state labels) or add the namespace to
  `FIRM_FIRST_SCREEN_NAMESPACES`; the key test fails otherwise.
- Measure with the Playwright profile in `tests/e2e/firm-tools-flow.mjs` (`firstLoadBudget`).

# Agent Notes

Scope: this file applies to the whole repository.

## Project Layout

- `client/` contains the React/Vite frontend. Vite aliases `@` to `client/src`.
- `client/src/lib/reportCatalog.ts` is the shared source for Reports catalog/workspace metadata,
  automation playbooks, roadmap prerequisites/priorities, automation-health scoring/history, persona
  preference storage, and command-palette report shortcuts; avoid duplicating report labels or deep
  links elsewhere.
- `server/` contains the Express API, middleware, routes, services, and startup code.
- `shared/` contains the Drizzle schema and shared validators. The alias `@shared` points here.
- `migrations/` contains Drizzle migrations. Treat `migrations/meta/` as Drizzle-managed output.
- `tests/` contains Vitest unit tests plus smoke/E2E scripts.
- Do not edit generated or dependency output such as `dist/` and `node_modules/`.

## Commands

- Install dependencies with `npm ci`.
- Start local development with `npm run dev`. The server validates env on startup; copy
  `.env.example` to `.env` and provide at least `DATABASE_URL`, `SESSION_SECRET`, and
  `JWT_SECRET`.
- Build production assets and the server bundle with `npm run build`; run the built app with
  `npm start`.
- Use `npm run build:analyze` when inspecting production bundle size; it writes the Vite
  visualizer report to `dist/bundle-stats.html`.
- Type-check with `npm run check`.
- Run unit tests with `npm test`; use `npm run test:watch` for watch mode and
  `npm run test:coverage` for the baseline coverage ratchet.
- Run the broader readiness sweep with `npm run audit:campaign`; it chains type/contract checks,
  audit inventory, frontend API coverage, production dependency audit, unit tests, and build.
- For a focused API contract gate, run `npm run check:api-contract`; `npm run check` and
  `npm run audit:campaign` already include it.
- Use `npm run audit:api-coverage:strict` when frontend API-reference drift should fail the gate.
- Generate audit evidence with `npm run audit:matrix > docs/audit/audit-matrix.generated.md` and
  `npm run audit:inventory -- --markdown > docs/audit/audit-inventory.generated.md`.
- Lint with `npm run lint`; use `npm run lint:fix` only when you intend to modify files.
- Check formatting with `npm run format:check`; use `npm run format` only when you intend to
  modify files. `migrations/meta/` is generated Drizzle metadata and is ignored by Prettier.
- The full-tree Prettier baseline is not clean yet; for launch-hardening changes, prefer
  `npx prettier --check <changed-files>` plus `npx prettier --write <changed-files>` over
  repo-wide formatting unless a format-only cleanup is intentional.

## Database And Migrations

- Drizzle config reads `shared/schema.ts`, writes migrations to `migrations/`, and requires
  `DATABASE_URL`.
- Use `npm run db:generate`, `npm run db:migrate`, `npm run db:push`, and
  `npm run db:studio` for schema work.
- `AUTO_MIGRATE_ON_BOOT` defaults to `false`. Keep production migrations in the deploy/release
  phase with `npm run db:migrate`; boot-time migration is only for dev/test or single-instance
  setups.
- Before committing migration or auth/test-account changes, run `npm run check:migrations`. It
  blocks bcrypt hash literals and `INSERT INTO users` seed patterns outside the explicit allowlist.

## Testing And Runtime Notes

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
- `npm run security:verify-prod` requires `DATABASE_URL`; Railway production uses a private
  `postgres.railway.internal` URL, so run this inside the Railway network or through Railway SSH
  after an SSH key is registered.
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
  `CUSTOMER_E2E_CLEANUP_ADMIN_PASS`; the runner writes the created customer/company IDs to
  `tests/e2e/.artifacts/customer-launch-last-run.json`.
- For read-only production/ad-route customer launch QA, run
  `BASE_URL=<url> npm run e2e:customer:public`; it crawls only public launch routes and does not
  register users or create accounting records. The crawl includes public ad, auth, and legal routes
  such as `/services`, `/register`, and `/privacy`, and fails rendered unsupported launch claims.
  If Playwright cannot find Chromium, install the project browser once with
  `npx playwright-core install chromium` or set `CHROMIUM_PATH` to an existing browser binary.
- Use `npx vitest run tests/unit/public-launch-surface.test.ts` after public marketing, SEO,
  trust, help, migration, or public-route changes to catch unsupported compliance/security claims.
- Keep the public sample-data demo workspace routed at `/demo`; after demo, onboarding, or
  claim-copy changes, include `tests/unit/public-launch-surface.test.ts` in the focused run.
- Use `npx vitest run tests/unit/vat201-export.test.ts` after VAT 201 export mapping or workbook
  copy changes.
- Use `npx vitest run tests/unit/bank-import-ux.test.ts` after bank statement import or
  reconciliation UX changes, especially sample CSV and duplicate-import messaging.
- Use `npx vitest run tests/unit/bank-statement-import.test.ts` after bank CSV parser/header
  detection changes, especially Arabic headers or amount-plus-Dr/Cr statement formats.
- Use `npx vitest run tests/unit/mobile-launch-ux.test.ts` after mobile layout changes on invoices,
  receipts, banking, VAT, or other launch-critical SaaS screens.
- Use `npx vitest run tests/unit/report-discovery.test.ts` after report tabs, report command
  palette shortcuts, persona workspaces, report operations navigation, report decision-question
  metadata, decision shortcut paths, automation starter paths, report trigger-rule paths, delivery
  subscription paths/settings controls, delivery previews/run history, comparison presets, report
  coverage maps, report pack templates/exports, or report deep-link behavior changes.
- Use `npx vitest run tests/unit/report-export-helpers.test.ts` after report workbook sheets,
  persona pack workbook sheets, or export-helper mapping changes.
- Use `npx vitest run tests/unit/report-delivery-routes.test.ts` after report delivery
  subscription service, route, persisted settings, run history, notification queueing, or
  failure-retry API/scheduling-plan changes.
- Use `npx vitest run tests/unit/report-delivery-scheduler.test.ts` after report delivery cadence,
  due-scan, guardrail, failure recovery, scheduler telemetry, or scheduler cron changes.
- Use `npx vitest run tests/unit/whatsapp-boundary.test.ts` after WhatsApp-related changes. The
  WhatsApp surface is NR firm-management-only and must not appear in public or customer SaaS UI.
- Document chasing is also an NR firm-management-only feature. Keep its UI under
  `/firm/document-chasing` and verify with
  `npx vitest run tests/unit/document-chasing-boundary.test.ts` after related route/nav/API changes.
- `npm run test:coverage` is a baseline ratchet, not proof of broad route coverage; raise the
  thresholds as integration and route-level tests land.

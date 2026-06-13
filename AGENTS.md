# Agent Notes

Scope: this file applies to the whole repository.

## Project Layout

- `client/` contains the React/Vite frontend. Vite aliases `@` to `client/src`.
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
- Use `npm run audit:api-coverage:strict` when frontend API-reference drift should fail the gate.
- Lint with `npm run lint`; use `npm run lint:fix` only when you intend to modify files.
- Check formatting with `npm run format:check`; use `npm run format` only when you intend to
  modify files. `migrations/meta/` is generated Drizzle metadata and is ignored by Prettier.

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
- Vitest and ESLint intentionally exclude `.claude/` worktrees. Do not use those as
  source-of-truth unless the task explicitly targets them.
- In development, `npm run dev` starts Express on `PORT` (default `5000`) and mounts
  Vite in middleware mode; there is no separate client dev script.
- For cookie/session-based state-changing API requests, fetch `/api/csrf-token` and send
  the returned value as `X-CSRF-Token`; Bearer-auth requests are CSRF-exempt.
- The Docker/Railway runtime expects a Node 20.19+ production build because the Vite/Rolldown
  toolchain requires at least Node 20.19. `/health/live` is the cheap liveness probe; `/health`
  is DB-backed readiness/full health.
- For a containerized local stack, `docker compose up --build` starts the app plus Postgres 16
  using `.env` and persists `pgdata`/`uploads` volumes.
- For authenticated endpoint smoke testing, run `bash tests/test-firm-endpoints.sh` with
  `TEST_BASE`, `TEST_EMAIL`, and `TEST_PASS` set explicitly. The script deliberately has no
  production URL or password defaults.
- For read-only production smoke testing, run
  `SMOKE_READ_ONLY=true SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod -- <url>`.
- `npm run e2e` requires a running app plus `BASE_URL` and `DATABASE_URL`; it registers a
  fresh user, promotes it through Postgres, crawls workspace routes, and posts a balanced journal.
- `npm run test:coverage` is a baseline ratchet, not proof of broad route coverage; raise the
  thresholds as integration and route-level tests land.

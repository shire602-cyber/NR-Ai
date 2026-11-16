# Development, QA and smoke-test commands

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

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
- Populate a dedicated synthetic report-audit company with `BASE_URL=... npm run
e2e:report-fixture`; it writes ignored evidence to `tests/e2e/.artifacts/` and should not be
  pointed at real client books.
- For high-volume report behavior checks, run `BASE_URL=... REPORT_STRESS_EMAIL=...
REPORT_STRESS_PASSWORD=... node tests/e2e/report-stress-fixture.mjs`; use a dedicated synthetic
  company only, and keep `REPORT_STRESS_WRITE_DELAY_MS` high enough to avoid production rate limits.
- Run the competitor-grade benchmark audit with `BASE_URL=http://localhost:5000 npm run
e2e:benchmark-audit`; it uses the report fixture by default, refuses production writes unless
  `BENCHMARK_ALLOW_PROD_WRITES=true` is explicitly set, and writes review evidence under
  `docs/qa/<date>-benchmark-audit/`.
- Treat `BENCHMARK_RUN_FIXTURE=false` production runs as read-only deployment crawls only. They can
  verify Railway routes and report shells, but accountant-grade scorecard evidence needs local
  Postgres fixture probes from `scripts/qa/bootstrap-e2e.sh` plus `npm run e2e:benchmark-audit`.
  The bootstrap starts Docker Postgres by default, or uses `E2E_DATABASE_URL`/`DATABASE_URL` when
  pointed at an existing disposable Postgres database.
- Run `npm run e2e:benchmark-preflight -- <base-url>` before local synthetic benchmark work; it
  checks Docker or `E2E_DATABASE_URL`, production write guards, bootstrap shell prerequisites, and
  Chromium availability before the write fixture runs.
- Use `node scripts/qa/run-local-benchmark.mjs` for the no-Docker full local benchmark path; it starts a
  disposable PGlite socket database through an existing `pglite-server`, `PGLITE_SERVER_BIN`, or
  the script's on-demand `npx -p @electric-sql/pglite-socket` fallback, runs migrations, starts the
  app, runs the fixture-backed benchmark audit, and writes evidence to
  `docs/qa/<date>-benchmark-audit-local/` unless `BENCHMARK_OUTPUT_DIR` is set.
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


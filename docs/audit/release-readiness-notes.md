# Release Readiness Notes

## Client Operations Cockpit

Release candidate includes the non-bank client operations cockpit for NRA staff:

- Production Planner: deadline-driven buckets for overdue, weekly, 28-day, close-blocked, and unassigned work.
- Staff Capacity Planner: unassigned intake, overloaded owners, and available capacity.
- Intervention Radar: high-risk escalation, medium-risk watchlist, and collection exposure lanes.
- Service Lane Forecast: VAT cohorts, corporate tax, bookkeeping close, and accounting review cadence.

## Required Release Gate

Before pushing the next main release, run:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev --audit-level=moderate
npm run audit:api-coverage:strict
STAGING_DATABASE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke:credentials
# Or, from a Railway Postgres service env that exposes DATABASE_PUBLIC_URL:
npm run smoke:credentials
SMOKE_BASE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke:staging
```

## Current Evidence

- Verified again on 2026-06-08 from the current audit-remediation worktree.
- `npm ci`, `npm run check`, `npm test` (510 tests), `npm run build`, full `npm audit --audit-level=moderate`, `npm run audit:api-coverage:strict`, and `npm run check:migrations` pass locally.
- Dev audit is clean after the Vite 8 / plugin-react 6 / esbuild 0.28 upgrade and esbuild override for Drizzle Kit's deprecated loader chain.
- Staging credential bootstrap is available via `npm run smoke:credentials`; it creates or updates a firm smoke user without storing secrets in the repo and can use `DATABASE_PUBLIC_URL` from the Railway Postgres service env.
- `scripts/production-smoke.mjs` now verifies `/api/firm/bookkeeper-dashboard` alongside auth session, firm clients, firm health, Value Ops, and command-center checks.
- `npm run lint` exits 0 with no warnings after unused-binding cleanup and removal of production-irrelevant React Compiler/Fast Refresh hints from the lint backlog.
- `npm run build:analyze` passes and writes `dist/bundle-stats.html`; heavy PDF/PDF.js/html2canvas/chart chunks remain on-demand and are not module-preloaded by the initial HTML.
- Production build no longer emits the tracked Tailwind/PostCSS `from` warning after the Vite 8 toolchain upgrade; oversized lazy spreadsheet/PDF chunks remain accepted exceptions for this wave.
- Local browser smoke confirms `/login` and `/register` render Google/Microsoft OAuth buttons, direct OAuth failure displays the generic error, and browser storage does not contain OAuth/session tokens.
- Production deploy from the audit-remediation release branch completed on 2026-06-08; pre-deploy migration completed, the critical schema guard reported `ok=149 failed=0`, and read-only production smoke passed `/health/live`, `/health/ready`, `/api/version`, `/api/auth/oauth/providers`, and invalid-login rejection with `SMOKE_EXPECTED_COMMIT` set to release `HEAD`.
- Staging Postgres was restored on 2026-06-08 by redeploying the existing `Postgres` service from `ghcr.io/railwayapp-templates/postgres-ssl:17` with its preserved `postgres-volume`.
- Staging app deploy `cb9d8e57-fddd-443a-b1ff-cd67b1b718c0` succeeded after the npm 10 lockfile repair, DB SSL config, and VAT duplicate-safe migration; pre-deploy migration completed and schema guard reported `ok=149 failed=0`.
- Authenticated staging smoke passed against `https://nr-ai-staging.up.railway.app` using Railway-stored smoke credentials, including liveness, readiness, version, OAuth providers, login, CSRF, auth session, firm clients, bookkeeper dashboard, firm health/deadlines, comms log, Value Ops, command center, growth opportunities, and VAT workpapers.
- Staging mutation smoke also passed with `SMOKE_WORKSPACE_MUTATIONS=true`, covering growth refresh, VAT workpaper create/open, approved row, OCR draft upload/evidence download, draft exclusion, approval inclusion, and VAT-return generation.
- Cleanup note: temporary `SMOKE_EMAIL` and `SMOKE_PASSWORD` variables were removed from the Railway `Postgres` service after credential bootstrap; the app service retains staging smoke credentials for future staging smoke runs.
- WhatsApp remains a logged-only communication path unless a real delivery provider is configured.

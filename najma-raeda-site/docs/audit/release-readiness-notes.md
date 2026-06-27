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
SMOKE_BASE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke:prod
```

## Current Evidence

- Verified again on 2026-05-17 from `codex/release-readiness` at `7b9013840debfee105a895e348c4a8777b2b9a85`.
- `npm run check`, `npm test` (462 tests), `npm run build`, `npm audit --omit=dev --audit-level=moderate`, `npm run audit:api-coverage:strict`, and `npm run check:migrations` pass locally.
- `scripts/production-smoke.mjs` now verifies `/api/firm/bookkeeper-dashboard` alongside auth session, firm clients, firm health, Value Ops, and command-center checks.
- `npm run lint` exits 0 with 509 warnings remaining; `client/src/pages/firm/ClientPortfolio.tsx` is clean after the release-readiness hook dependency cleanup.
- `npm run build:analyze` passes and writes `dist/bundle-stats.html`; oversized spreadsheet/PDF chunks remain accepted lazy-load exceptions for this wave.
- Production build still emits the tracked Tailwind/PostCSS `from` warning and route chunk-size warnings.
- Local browser smoke in the frontend workspace confirms `/login` and `/register` render Google/Microsoft OAuth buttons, direct OAuth failure displays the generic error, and browser storage does not contain OAuth/session tokens.
- Read-only Railway smoke against `https://nr-ai-production.up.railway.app` passes `/health/live`, `/health/ready`, and `/api/version`, but fails `/api/auth/oauth/providers` with 404 because production is still serving commit `acb16a3512ba4e73539cadccde5d62a86283352e`.
- Authenticated staging smoke is not runnable in this Codex shell until `SMOKE_BASE_URL`, `SMOKE_EMAIL`, and `SMOKE_PASSWORD` are provided as environment variables, so main release promotion remains blocked.
- WhatsApp remains a logged-only communication path unless a real delivery provider is configured.

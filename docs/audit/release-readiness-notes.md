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

- `npm run check`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=moderate`, and `npm run audit:api-coverage:strict` pass locally.
- `scripts/production-smoke.mjs` now verifies `/api/firm/bookkeeper-dashboard` alongside auth session, firm clients, firm health, Value Ops, and command-center checks.
- `npm run lint` exits 0 with 463 warnings remaining; `client/src/pages/firm/ClientPortfolio.tsx` is clean after the release-readiness hook dependency cleanup.
- `npm run build:analyze` passes and writes `dist/bundle-stats.html`; oversized spreadsheet/PDF chunks remain accepted lazy-load exceptions for this wave.
- Production build still emits the tracked Tailwind/PostCSS `from` warning and route chunk-size warnings.
- Authenticated staging smoke is not runnable in this Codex shell until `SMOKE_BASE_URL`, `SMOKE_EMAIL`, and `SMOKE_PASSWORD` are provided as environment variables, so main release promotion remains blocked.
- WhatsApp remains a logged-only communication path unless a real delivery provider is configured.

# Audit Findings

Use this file as the human-readable backlog. Keep one row per finding until it is moved into the issue tracker.

| ID | Severity | Area | Repo | Environment | Role | Finding | Repro Steps | Expected | Actual | Owner | Fix Wave | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | P1 | API coverage | NR-Ai-Backend | local | customer / firm staff | Static API coverage found frontend calls that did not map cleanly to mounted backend routes. | Run `npm run audit:api-coverage:strict`. | Every frontend API reference maps to a mounted backend route or is explicitly parked. | Fixed in branch: strict API coverage now passes with 0 unresolved refs. | TBD | Wave 2 | Fixed |
| AUD-002 | P2 | Performance | NR-Ai-Backend | local | all roles | Production build emits large client chunk warnings. | Run `npm run build`. | Route-level bundles stay below the configured warning threshold or have documented lazy-load exceptions. | Partially mitigated: Vite now separates large vendor families, ExcelJS is lazy-loaded from export/import actions, and `index.html` does not preload the spreadsheet chunk; oversized on-demand spreadsheet/PDF chunks remain documented exceptions. | TBD | Wave 3 | Partially fixed |
| AUD-003 | P3 | Build hygiene | NR-Ai-Backend | local | engineering | Production build emits a PostCSS `from` option warning. | Run `npm run build`. | Build output is free of avoidable toolchain warnings. | Root cause traced to Tailwind 3 internals calling `postcss.parse` without `from`; keep tracked until the Tailwind/PostCSS toolchain is upgraded. | TBD | Wave 3 | Open |
| AUD-004 | P2 | Lint gate | NR-Ai-Backend | local | engineering | `npm run lint` failed on Node audit scripts because ESLint treated `.mjs` scripts as browser globals. | Run `npm run lint`. | Lint exits 0 so CI can use it as a reliable gate. | Fixed in branch: Node globals are configured for scripts/config files. Remaining output is warning-only. | TBD | Wave 3 | Fixed |
| AUD-005 | P3 | Code hygiene | NR-Ai-Backend | local | engineering | Lint reports a large warning backlog. | Run `npm run lint`. | Warning backlog is triaged and reduced over time without blocking release gates. | 509 warnings remain after the 2026-05-17 verification pass; `ClientPortfolio.tsx` now has 0 warnings. | TBD | Wave 3 | Open |
| AUD-006 | P1 | Release readiness | Both repos | staging | firm_owner / firm_admin | Authenticated staging smoke must cover the new client operations cockpit before the next main release. | Run `SMOKE_BASE_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke:prod`. | Health, auth session, firm clients, firm bookkeeper dashboard, firm health, Value Ops, and command center return stable JSON shapes. | Local gates pass and smoke script now includes `/api/firm/bookkeeper-dashboard`; staging execution is blocked in this Codex runtime until smoke env vars are provided outside git/chat. | TBD | Wave 1 | Blocked |
| AUD-007 | P1 | Deployment readiness | Both repos | production | public | Railway production is serving an older commit and does not include the release-branch OAuth/security routes. | Run `SMOKE_READ_ONLY=true npm run smoke:prod -- https://nr-ai-production.up.railway.app` or request `/api/auth/oauth/providers`. | Production/staging target should serve the release commit and expose `/api/auth/oauth/providers` before authenticated OAuth smoke. | `/health/live`, `/health/ready`, and `/api/version` pass, but `/api/auth/oauth/providers` returns 404; `/api/version` reports stale commit `acb16a3512ba4e73539cadccde5d62a86283352e`, while this branch is `7b9013840debfee105a895e348c4a8777b2b9a85`. | TBD | Wave 1 | Blocked |

## Fix Waves

- Wave 1: P0/P1 security, login, onboarding, deploy, firm workflows.
- Wave 2: API mismatch, validation, audit logs, data integrity.
- Wave 3: UX polish, performance, observability, documentation.
- Wave 4: parked/backend-only module triage.

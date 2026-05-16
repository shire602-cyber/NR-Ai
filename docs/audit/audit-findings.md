# Audit Findings

Use this file as the human-readable backlog. Keep one row per finding until it is moved into the issue tracker.

| ID | Severity | Area | Repo | Environment | Role | Finding | Repro Steps | Expected | Actual | Owner | Fix Wave | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | P1 | API coverage | NR-Ai | local | customer / firm staff | Static API coverage found frontend calls that do not map cleanly to mounted backend routes. | Run `npm run audit:api-coverage`. | Every frontend API reference maps to a mounted backend route or is explicitly parked. | 8 unresolved refs remain: AI chat history, advanced analytics KPIs/insights/forecasts/budget-vs-actual, ecommerce transactions, regulatory news, and classifier stats. | TBD | Wave 2 | Open |
| AUD-002 | P2 | Performance | NR-Ai | local | all roles | Production build emits large client chunk warnings. | Run `npm run build`. | Route-level bundles stay below the configured warning threshold or have documented lazy-load exceptions. | Several chunks exceed 800 kB, including spreadsheet/PDF-related vendor chunks. | TBD | Wave 3 | Open |
| AUD-003 | P3 | Build hygiene | NR-Ai | local | engineering | Production build emits a PostCSS `from` option warning. | Run `npm run build`. | Build output is free of avoidable toolchain warnings. | Vite/PostCSS warns that a plugin did not pass the `from` option to `postcss.parse`. | TBD | Wave 3 | Open |

## Fix Waves

- Wave 1: P0/P1 security, login, onboarding, deploy, firm workflows.
- Wave 2: API mismatch, validation, audit logs, data integrity.
- Wave 3: UX polish, performance, observability, documentation.
- Wave 4: parked/backend-only module triage.

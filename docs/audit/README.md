# Comprehensive System Audit Runbook

This audit covers local and staging for both repos: `NR-Ai` and `NR-Ai-Backend`.
Production checks are read-only and run only after staging passes.

## Baseline Commands

Run in each repo:

```bash
npm run audit:campaign -- --skip-build
npm run audit:matrix > docs/audit/audit-matrix.generated.md
npm run audit:inventory -- --markdown > docs/audit/audit-inventory.generated.md
```

Run full gates before release:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev --audit-level=moderate
npm run check:api-contract
npm run audit:api-coverage
```

Run staging smoke when staging credentials exist:

```bash
SMOKE_BASE_URL=https://staging.example.com SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke:prod
```

Run production security verification only with production database access:

```bash
DATABASE_URL=... JWT_SECRET_ROTATED_AFTER_BACKDOOR=true npm run security:verify-prod
```

## Severity Rules

- `P0`: cross-tenant access, data loss, login outage, exposed secret, deploy outage.
- `P1`: broken critical journey, broken firm workflow, failed migration, failed staging smoke.
- `P2`: important feature defect, confusing error state, missing validation, weak logging.
- `P3`: polish, copy, nonblocking inconsistency, minor tech debt.

## Execution Rhythm

- Day 1-2: baseline inventory, CI gates, staging smoke, route/API coverage.
- Day 3-5: auth, onboarding, company, customer accounting journeys.
- Day 6-8: firm/NRA, portal, admin, tenant isolation, mutation safety.
- Day 9-10: security, migrations, dependency audit, observability, reliability.
- Day 11-12: performance, bundle size, bulk paths, OCR/file parsing, background jobs.
- Day 13-14: findings triage, fix waves, release readiness, production read-only smoke.

## Required Evidence

Each finding must include:

- severity,
- affected repo and environment,
- user role,
- reproducible steps,
- expected result,
- actual result,
- logs/screenshots when relevant,
- suspected owning subsystem,
- proposed fix wave.

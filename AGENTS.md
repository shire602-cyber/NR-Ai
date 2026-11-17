# Agent Notes

Scope: this file applies to the whole repository. It is a concise index; detail lives in `docs/`
(links below). Keep this file under 250 lines and move new detail into the linked docs.

## Project layout

- `client/` React/Vite frontend (`@` aliases `client/src`). UI copy lives in namespaced catalogs
  `client/src/locales/{en,ar}/*.json` (`<T k>` / `t["ns.key"]`); use logical CSS properties for RTL.
  Report catalog Arabic is the keyed overlay `client/src/locales/ar-catalog/reportCatalog.json`
  (`useCatalogText()`); `npm run e2e:arabic-runtime` must find 0 English text nodes on the 20
  launch routes in Arabic mode. The i18n ratchet also scans `client/src/lib` and `client/src/hooks`.
- `server/` Express API: `routes/`, `services/`, `middleware/`, `ledger/`, `reporting/`, `tax/`,
  `tenancy/`, `platform/` (service registry, domain events, job registry), `outbox/`, `http/`.
  `server/routes/ai.routes.ts` and `firm.routes.ts` keep every registration (path, middleware
  order) and import handlers from `server/routes/ai/` and `server/routes/firm/`
  (`tests/unit/route-module-split.test.ts` pins the route tables).
- `shared/` Drizzle schema and shared validators (`@shared`); money math uses integer fils via
  `shared/money.ts`. `shared/schema.ts` is a barrel (`export *` only) over the domain modules in
  `shared/schema/<domain>.ts` (column helpers and the drizzle-zod `createInsertSchema` factory in
  the internal `shared/schema/columns.ts`). Client code must not import values from
  `@shared/schema` (it would bundle drizzle/zod); client-safe runtime values live in
  `shared/schema-values.ts` (`import type` from `@shared/schema` is fine).
- `server/storage.ts` is a thin barrel; `DatabaseStorage` is composed from domain classes in
  `server/storage/<domain>.ts` (interface in `server/storage/types.ts`). Method names must be
  unique along the class chain (`tests/unit/schema-storage-split.test.ts`); no split module
  exceeds 1,500 lines.
- `migrations/` Drizzle migrations (`migrations/meta/` is generated; never edit by hand).
- `tests/` Vitest unit tests (`tests/unit`), DB-backed tests (`tests/db`) and smoke/E2E scripts.
- `docs/release/DEPLOY-RUNBOOK.md` deploy runbook: backup, migration 0089-0119 rehearsal, env,
  smoke, rollback.
- `docs/` engineering notes. Do not edit `dist/` or `node_modules/`; `.claude/` and `.claire/`
  worktrees are excluded from Vitest/ESLint and are not a source of truth.
- Reports: `client/src/lib/reportCatalog.ts` is the single source for report catalog, personas,
  automation, comparison metrics and deep links (do not duplicate report labels/links). The Reports
  page is a thin shell over `client/src/pages/reports/` (`useReportsPage` composes ordered stage
  hooks in `hooks/`; comparison rows come from the pure `comparisons/buildComparisonRows`;
  `shared.ts` is a barrel over `model/`; no module there exceeds 1,500 lines,
  `tests/unit/report-page-split.test.ts`); server-rendered PDF/XLSX/pack output is in
  `server/services/report-render/`. Full catalog, metric-definition and domain-engine notes:
  [docs/reporting-metrics.md](docs/reporting-metrics.md).

## Commands

- `npm ci` install; `npm run dev` start (Express + Vite middleware on `PORT`, default 5000; copy
  `.env.example` to `.env` with at least `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`).
- `npm run build` / `npm start`; `npm run build:analyze` for bundle stats.
- `npm run check` type-check + contract check + guards; `npm run lint` (0 warnings allowed);
  `npm run format:check`. Format only changed files (`npx prettier --write <files>`); the
  full-tree baseline is not clean, so avoid repo-wide `format`/`lint:fix`.
- `npm test` unit tests; `npm run test:db` DB-backed tests (see Testing); `npm run test:coverage`
  is a baseline ratchet, not proof of route coverage.
- `npm run audit:campaign` is the broad readiness sweep. QA fixtures, benchmark audit, smoke and
  E2E commands: [docs/dev-commands.md](docs/dev-commands.md) and
  [docs/testing-runtime.md](docs/testing-runtime.md).

## Hard rules

Detail for each rule: [docs/platform-rules.md](docs/platform-rules.md).

- Ledger: every journal write goes through `server/ledger/` (`postJournal`, `reverseEntry`,
  `voidEntry`, `reverseBySource`, `withLedgerTx`; drafts via `deleteDraft`). Never
  `DELETE FROM journal_entries` or add new `storage.createJournalEntry` call sites (ratchet
  `scripts/guard-baselines/ledger-writes.json`).
- Reporting: statements, trial balance, aging, cash flow, dashboard and corporate-tax figures read
  `server/reporting/` (closing entries excluded via `NOT_CLOSING_SQL`). Never load all journal
  lines into Node. VAT 201 comes only from `computeVat201` (`server/tax/vat-engine.ts`).
  Open invoice/bill balances come only from `server/reporting/settlement.ts` (one settlement rule
  that ties to GL 1040 / 2010; see docs/reporting-metrics.md).
- Settlement and bank seams: `invoices.recordPayment/reversePayment`, `bills.recordPayment/
reversePayment` (service registry) and `bank-reconciliation.service.ts` (`applyMatch`,
  `unmatchTransaction`). Do not write `invoice_payments`/`bill_payments` or reconciliation state
  elsewhere. Inventory/COGS changes go through `inventory.on*` registry calls.
- Tenancy: load tenant-owned rows with `server/tenancy` (`scopedGet`/`scopedUpdate`/`scopedDelete`/
  `requireOwned`); another tenant's row is a 404, never a 403.
- RBAC: enforced centrally by `server/middleware/companyRolePolicy.ts` (`POLICY_RULES`,
  `shared/permissions.ts`). Add a rule for each new sensitive route and new row-id path prefixes to
  `RESOURCES`. Fix test fixtures with the right `company_users.role`; never turn enforcement off
  (`RBAC_ENFORCE=enforce` is the default).
- Write routes validate with `strictBody` (`server/http/strict-body.ts`) and shared validators in
  `shared/validators/`; no raw `req.body`. Cross-workstream calls go through `server/platform/`.
- FX: rates are tenant-scoped (a row (X, Y, r) means 1 X = r Y); resolve via `fx.getRate` /
  `fx.convert` with a `companyId`.
- Email goes through the durable outbox (`server/outbox/`); nothing is "sent" without a provider.
  Nothing is transmitted to the FTA/EmaraTax/ASP without an explicit configured boundary.
- WhatsApp and document chasing are NR firm-management-only (`/firm/document-chasing`); they must
  not appear in public or customer SaaS UI.
- Cookie/session state-changing requests need `X-CSRF-Token` from `/api/csrf-token`; Bearer is
  exempt. `TRUST_PROXY_HOPS` sets Express trust proxy (`true` is refused).

## Database and migrations

Detail: [docs/database-migrations.md](docs/database-migrations.md).

- Schema work via `npm run db:generate|db:migrate|db:push|db:studio`; `DATABASE_URL` required.
  `AUTO_MIGRATE_ON_BOOT` defaults to false: production migrates in the release phase.
- Run `npm run check:migrations` before committing migration or auth/test-account changes.
- Migrations `0089`-`0109` are reserved one file per workstream: fill only your own placeholder
  with idempotent SQL (`IF NOT EXISTS`, first-line header naming file and workstream, says
  `Idempotent`); never edit `migrations/meta/_journal.json` or add new numbers.
  `tests/db/migrations.test.ts` enforces this. Every Drizzle column must be created by a migration.
- New tables go in the owning `shared/schema/<domain>.ts` module, directly below their owning
  block (the `shared/schema.ts` barrel only re-exports modules; a new module needs an
  `export * from "./schema/<domain>"` line). New storage methods go in the matching
  `server/storage/<domain>.ts` class and its signature in `server/storage/types.ts`.

## Testing

Detail: [docs/testing-runtime.md](docs/testing-runtime.md).

- `tests/setup.ts` sets `NODE_ENV=test`, `PORT=5001` and a test `DATABASE_URL`.
- `npm run test:db` runs `tests/db/**/*.test.ts` against the real app and a fresh Postgres database
  per file (`useHarness()` in `tests/db/harness.ts`; PGlite fallback). Use it for any persistence,
  posting, tenancy or concurrency regression; name tests after issue ids.
  `tests/db/route-matrix.test.ts` is the cross-tenant route matrix; known gaps would live in
  `tests/db/route-matrix-allow/` (absent = empty; keep it that way).
- Guards run at the end of `npm run check` (`scripts/run-guards.mjs`: raw body, ledger writes,
  i18n ratchet). Baselines in `scripts/guard-baselines/` may only move down.
- Prefer behaviour tests (render, call the function, hit the route) over asserting on source
  text; a source-inspection test needs a comment saying why it cannot be a behaviour test.
- Focused suites to run after related changes (full list with triggers in
  [docs/testing-runtime.md](docs/testing-runtime.md)): `tests/unit/report-discovery.test.ts`,
  `report-catalog-routes`, `report-delivery-routes`, `report-delivery-scheduler`,
  `report-export-helpers`, `public-launch-surface`, `command-palette-a11y`, `vat201-export`,
  `page-source-guards`, `bank-statement-import`, `whatsapp-boundary`, `sidebar-nav-behaviour`,
  `document-chasing-boundary`.
- Runtime: Node 20.19+ on Debian slim (not Alpine); `/health/live` liveness, `/health` readiness;
  Railway deploys from `origin/main` (check `/api/version`). After dependency changes validate
  `npx -p node@20.19.0 -p npm@10.8.2 -c "npm ci --omit=dev --ignore-scripts"`.
- After a merged build refresh the bundle baseline: `node scripts/check-bundle-budget.mjs --update`.

## Docs index

- [docs/reporting-metrics.md](docs/reporting-metrics.md): report catalog rules, comparison metric
  definitions, statements kernel, VAT/CT/inventory/e-invoicing/communications/delivery engines.
- [docs/platform-rules.md](docs/platform-rules.md): ledger, reporting, tenancy, RBAC, payroll,
  banking, FX rules.
- [docs/dev-commands.md](docs/dev-commands.md): QA fixtures, benchmark audit, audit generators.
- [docs/database-migrations.md](docs/database-migrations.md), [docs/testing-runtime.md](docs/testing-runtime.md).
- [docs/release/SELF-HOSTING.md](docs/release/SELF-HOSTING.md): on-prem production (compose prod profile, TLS, backups, monitoring).
- [docs/einvoicing-providers.md](docs/einvoicing-providers.md): the two accredited e-invoicing
  providers (A-Cube, Complyance), `EINVOICE_PROVIDER` switching and the files to delete for each.
- Other: `docs/corporate-tax-rules.md`, `docs/faf-export.md`, `docs/payroll-legal-parameters.md`,
  `docs/api/`, `server/reporting/README`, `server/ledger/README`, `server/services/fx/README.md`.

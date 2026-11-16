# Database and migrations

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- Drizzle config reads `shared/schema.ts`, writes migrations to `migrations/`, and requires
  `DATABASE_URL`.
- Use `npm run db:generate`, `npm run db:migrate`, `npm run db:push`, and
  `npm run db:studio` for schema work.
- `AUTO_MIGRATE_ON_BOOT` defaults to `false`. Keep production migrations in the deploy/release
  phase with `npm run db:migrate`; boot-time migration is only for dev/test or single-instance
  setups.
- Before committing migration or auth/test-account changes, run `npm run check:migrations`. It
  blocks bcrypt hash literals and `INSERT INTO users` seed patterns outside the explicit allowlist.

- Migrations `0089_platform_foundation` (W1 platform: AI usage metering, receipt file metadata,
  `user_onboarding.tour_dismissed_at`, test-credential revocation) through `0109` are reserved,
  one file per remediation workstream (the filename names the owner, e.g. `0090_w2a_ledger_kernel`).
  A workstream replaces only its own placeholder with idempotent SQL; never edit
  `migrations/meta/_journal.json` or add new numbers. `tests/db/migrations.test.ts` enforces: an
  untouched placeholder stays `SELECT 1;` and keeps its "reserved placeholder ... owned by
  workstream" header; a filled file drops that marker, keeps a first-line header naming the file
  and workstream (e.g. `-- 0093_w2d_write_sweep (W2-D): ...`), says `Idempotent`, and uses
  `IF NOT EXISTS` for every CREATE TABLE/INDEX and ADD COLUMN. Because placeholders change content, gates
  run on freshly created databases. New tables in `shared/schema.ts` go directly below their
  owning block, and every Drizzle column must be created by some migration.


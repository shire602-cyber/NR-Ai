# Database and migrations

Moved verbatim from AGENTS.md (indexed there). Lines are normative engineering notes.

- Drizzle config reads `shared/schema.ts` (a barrel over `shared/schema/*.ts`), writes migrations to `migrations/`, and requires
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
  run on freshly created databases. New tables go in the owning domain module
  `shared/schema/<domain>.ts`, directly below their owning block (`shared/schema.ts` is only an
  `export *` barrel over those modules; add a barrel line for a new module, and keep column helpers
  and `createInsertSchema` imported from the internal `shared/schema/columns.ts`), and every
  Drizzle column must be created by some migration. Storage methods for a new table go in the
  matching `server/storage/<domain>.ts` class, with the signature added to
  `server/storage/types.ts` (`IStorage`).
- PR #68 originally used migration 0136 for the owner-approved settlement indexes. #67 used the
  same journal timestamp for portal invitations. The combined branch keeps #67's 0136 and applies
  both changes idempotently in `0137_combine_portal_invitations_and_settlement_indexes`, including
  on databases that already ran either 0136.

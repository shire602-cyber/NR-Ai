# Platform owner access (S-H3): migration 0054 neutralised, opt-in grant

## What changed

`migrations/0054_promote_shire602_firm_owner.sql` used to promote one hardcoded personal account
(`is_admin`, `user_type = 'admin'`, `firm_role = 'firm_owner'`) in every database that ran the chain:
fresh installs, staging, demo, CI and any third-party deployment. It is now a documented no-op
(`SELECT 1;`). Nothing in the migration chain grants admin to anyone.

## Why editing an applied migration is safe here

- The migrator (`npm run db:migrate` = `drizzle-kit migrate`, and `runMigrations` in `server/db.ts`;
  drizzle-orm 0.45.2) decides what to run by comparing each journal entry's `when` with the newest
  `created_at` in `drizzle.__drizzle_migrations`. It never re-reads or verifies the stored `hash`. A
  database that already applied 0054 does not re-run it and is not rejected. Its promotion stays exactly
  as it was, so the owner's production keeps its admin and nobody is locked out.
- The journal entry (tag, `when`) is unchanged; `meta/_journal.json` is not edited. The legacy baseline
  cutoff in `server/db.ts` keys off 0054's `when`, not its content.
- `tests/db/platform-owner.test.ts` pins both halves:
  - Running the new 0054 promotes nobody.
  - On a database whose ledger carries the ORIGINAL 0054 hash, a re-run of the migrator succeeds. The
    ledger row count and the old hash stay as they were, and the promoted account is untouched.
- If a future drizzle upgrade starts verifying hashes, that test fails before release.
- The migration rehearsal ([MIGRATION-REHEARSAL.md](MIGRATION-REHEARSAL.md)) confirms the same on a
  main-shaped database: the promoted account is unchanged after 0089-0123.

## Granting the production owner (explicit, opt-in, once per environment)

The account must exist first (sign up normally). No user or password is created. Take a backup first.

```bash
DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email owner@example.com
```

```bash
DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email owner@example.com --grant --confirm owner@example.com
```

- With no action flag the command is read-only and prints the account's current state.
- `--grant` sets `is_admin`, `user_type = 'admin'` and `users.firm_role = 'firm_owner'`, and upserts the
  NR `firm_members` row as `firm_owner`.
- It refuses when:
  - `--confirm` does not repeat the email (`CONFIRMATION_MISMATCH`);
  - the account does not exist (`USER_NOT_FOUND`);
  - two accounts differ only by email case (`AMBIGUOUS_EMAIL`);
  - the account is staff of another accounting firm (`MEMBER_OF_OTHER_FIRM`), which is never moved
    into the NR firm silently.
- It is idempotent and writes a chained audit row (`platform_owner.grant`).

The owner's existing production already has the role from the old 0054, so it needs nothing.

## Revoking in non-owner environments that already applied the old 0054

Staging, demo, forks and any copy restored from production carry the old promotion. There, run:

```bash
DATABASE_URL=... npx tsx scripts/ops/platform-owner.ts --email shire602@gmail.com --revoke --confirm shire602@gmail.com
```

This clears `is_admin`, resets `user_type` to `customer`, clears `firm_role` and removes the NR
`firm_members` row, with an audit row (`platform_owner.revoke`). Company memberships the account holds
are reported, not deleted; remove them per tenant if they are unwanted.

## Decision on `docs/proposed-migrations/revoke-shire602-admin.sql`

**It does not become a migration, and it has been removed.** It has been replaced by the `--revoke`
command above. The reasons:

1. **A migration cannot tell the owner's production from any other database.** As a migration, the
   revoke would run in the owner's production too and lock the owner out of all-tenant admin. That is
   the lock-out risk its own header warns about. The only safe production behaviour is "leave the
   applied state alone", which the neutralised 0054 already gives.
2. **The repo's migration rules forbid adding numbers or editing `meta/_journal.json`** on this line
   (AGENTS.md; `tests/db/migrations.test.ts`). Another session is also adding migrations to
   `claude/eloquent-maxwell-kjxxjc`, so a new number here would risk a collision.
3. **The draft's optional `DELETE FROM company_users` is a per-tenant decision.** It would silently
   remove real memberships, so the command reports them instead.

Owner actions:

- **(a)** Nothing in your own production.
- **(b)** Run `--revoke` in every other environment that ran the old chain.
- **(c)** Use `--grant` when you stand up a new production or a fresh self-hosted install.

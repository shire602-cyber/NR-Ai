# Deploy runbook: branch `claude/eloquent-maxwell-kjxxjc` (migrations 0089 to 0116)

Owner-run. The first deploy of this branch applies 28 migrations that rewrite some production data
(users, roles, FX rates, reconciliation rules, portal tokens, audit chain, subscriptions). Do not
merge or deploy until sections 1 to 3 are complete and signed off. Doc-derived or external items
(A-Cube, email, Stripe, WPS, GPSSA, FAF) are listed in section 9 and stay off until proven.

## 1. Pre-deploy: verified backup

1. Confirm Railway Postgres snapshots are enabled; note the retention window.
2. Immediately before deploy take a manual dump and verify it restores (see
   [docs/BACKUP_RESTORE_DRILL.md](../BACKUP_RESTORE_DRILL.md)):
   ```
   pg_dump "$DATABASE_URL" -Fc -f prod-pre-0089-$(date +%Y%m%d-%H%M).dump
   pg_restore --list prod-pre-0089-*.dump | head      # readable archive
   createdb restore_check && pg_restore -d restore_check prod-pre-0089-*.dump
   psql restore_check -c "SELECT count(*) FROM companies"   # matches production
   ```
3. Record the dump name, size, checksum and the production row counts for `companies`, `users`,
   `company_users`, `journal_entries`, `invoices`. Keep the dump until the post-deploy smoke passes
   and the findings review (section 3) is signed off. Never commit dumps.

## 2. Migration rehearsal on a restored production snapshot

Restore the dump from section 1 (or a Railway snapshot) into a scratch database, never production:

```
export DATABASE_URL=postgres://.../rehearsal   # the restored copy
\timing on                                     # in psql; or time the command below
time npm run db:migrate                         # applies 0089-0116; record total and slowest file
npm run build && PORT=<free port> npm start     # boot check: /health/ready 200, /api/version
```

Record timings per migration (the migrate log) and fail the rehearsal on any error or boot failure.

### 2a. Capture BEFORE migrating (pre-state counts)

Run on the restored snapshot before `db:migrate`:

```sql
-- 0092: placeholder users that become pending invitations / are deleted
SELECT count(*) AS placeholder_users FROM users WHERE password_hash = '';
SELECT count(*) AS placeholder_memberships FROM company_users cu
  JOIN users u ON u.id = cu.user_id WHERE u.password_hash = '';
-- 0092: company_users roles that will be rewritten, and how many map to employee
SELECT role, count(*) FROM company_users
 WHERE role NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer')
 GROUP BY role ORDER BY 2 DESC;
SELECT count(*) AS roles_mapping_to_employee FROM company_users
 WHERE role NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer')
   AND lower(trim(role)) NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer',
                                 'cfo','manager','readonly','read_only','read-only');
-- 0092: accounts that differ only by email case
SELECT count(*) FROM (SELECT lower(trim(email)) FROM users GROUP BY 1 HAVING count(*) > 1) d;
-- 0094: non-FTA FX rows and how many companies exist (one company = assigned, else legacy_unscoped)
SELECT (SELECT count(*) FROM companies) AS companies,
       count(*) FILTER (WHERE source <> 'fta') AS non_fta_rates,
       count(*) FILTER (WHERE source = 'manual') AS manual_rates
  FROM exchange_rates;
-- 0097: reconciliation rules that will be switched off
SELECT count(*) FILTER (WHERE match_type NOT IN ('exact','contains','starts_with','regex','equals','equal','is')) AS bad_match_type,
       count(*) FILTER (WHERE account_id IS NULL AND is_active) AS active_without_account
  FROM reconciliation_rules;
-- 0103: plaintext portal tokens that will be hashed (links then expire within 90 days)
SELECT count(*) FROM customer_contacts WHERE portal_access_token IS NOT NULL;
-- 0113: companies that get a Free subscription row
SELECT count(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);
-- 0109: audit rows that will be chained as legacy
SELECT count(*) FROM audit_logs;
```

### 2b. Capture AFTER migrating (post-state counts and findings)

```sql
-- 0090 and 0092 findings: read every row; the owner signs off the list
SELECT kind, count(*) FROM ledger_repair_findings GROUP BY kind ORDER BY 2 DESC;
SELECT kind, count(*) FROM identity_migration_findings GROUP BY kind ORDER BY 2 DESC;
SELECT * FROM ledger_repair_findings ORDER BY found_at LIMIT 200;
SELECT * FROM identity_migration_findings ORDER BY created_at;
-- 0092: invitations created from placeholders (users to re-invite)
SELECT count(*) FROM company_invitations WHERE status = 'pending';
-- 0094: rates ignored by lookups, and inverted rows rewritten
SELECT count(*) FILTER (WHERE legacy_unscoped) AS legacy_unscoped,
       count(*) FILTER (WHERE legacy_inverted) AS legacy_inverted FROM exchange_rates;
-- 0097: deactivated rules (tenants must review)
SELECT count(*) FROM reconciliation_rules WHERE NOT is_active;
-- 0103: hashed portal tokens, and contacts the contact_id backfill could not resolve
SELECT count(*) FROM portal_access_tokens WHERE kind = 'link';
SELECT count(*) FROM portal_contact_backfill_findings;
-- 0108: NR firm seeded and existing data backfilled
SELECT (SELECT count(*) FROM firms) AS firms, (SELECT count(*) FROM firm_members) AS firm_members,
       (SELECT count(*) FROM firm_client_links) AS client_links,
       (SELECT count(*) FROM firm_company_grants) AS company_grants;
-- 0109: audit chain sealed
SELECT count(*) FILTER (WHERE legacy) AS legacy_chained, count(*) AS total FROM audit_logs;
-- 0113: Free backfill (must equal the pre-state figure) and no company left without a row
SELECT count(*) FROM subscriptions WHERE plan_id = 'free';
SELECT count(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);
```

### 2c. Read-only scripts (`scripts/qa/`, READ ONLY transactions, safe on the snapshot or production)

```
DATABASE_URL=... node scripts/qa/find-bad-closing-entries.mjs --json    > findings-closing.json
DATABASE_URL=... node scripts/qa/find-inverted-rates.mjs                > findings-rates.txt
DATABASE_URL=... node scripts/qa/find-sales-ledger-drift.mjs            > findings-sales.txt
DATABASE_URL=... node scripts/qa/find-purchases-ledger-drift.mjs        > findings-purchases.txt
```

Run them on the pre-migration snapshot as well, so the owner can compare. Rehearsal table to fill in
and attach to the PR:

| Item                                                          | Migration   | Pre | Post |
| ------------------------------------------------------------- | ----------- | --- | ---- |
| Placeholder users removed or converted to invitations         | 0092        |     |      |
| `company_users` roles mapped to employee                      | 0092        |     |      |
| Rates flagged `legacy_unscoped` / `legacy_inverted`           | 0094        |     |      |
| Reconciliation rules deactivated                              | 0097        |     |      |
| Portal tokens hashed                                          | 0103        |     |      |
| Firm backfill (firms, members, links, grants)                 | 0108        |     |      |
| Audit rows chained as legacy                                  | 0109        |     |      |
| Free subscription rows backfilled                             | 0113        |     |      |
| `ledger_repair_findings` / `identity_migration_findings` rows | 0090 / 0092 |     |      |
| Total migrate time, slowest file                              | all         |     |      |

The owner reviews and signs off the findings before the deploy. Findings are flagged, not repaired:
historic unbalanced entries and duplicate reversals need accountant review per tenant afterwards.

## 3. Environment to set on Railway BEFORE the deploy

| Variable                                       | Value / reason                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_ENCRYPTION_KEY`                         | Random 32+ byte secret, **separate from `SESSION_SECRET`**. The secret vault falls back to `SESSION_SECRET` when unset (`server/services/secret-vault.ts`); set it before any secrets are stored, because rotating it later makes stored secrets unreadable.                                                                                                                                              |
| `TRUST_PROXY_HOPS`                             | Number of proxies in front of the app (Railway: normally `1`). Needed for `req.ip` and per-IP rate limits; the server warns in production when unset and refuses `true`.                                                                                                                                                                                                                                  |
| `RBAC_ENFORCE`                                 | `enforce` (default). Do not start on `report`: it reopens the audited R01-02 role hole. Keep `report` only as the rollback in section 7.                                                                                                                                                                                                                                                                  |
| Durable file storage                           | Either S3 (`S3_BUCKET` and its credentials) or Vercel Blob (`BLOB_READ_WRITE_TOKEN`), with `STORAGE_STRICT=true` so the server refuses to start without it, or a Railway volume mounted at the uploads path. Without it receipts and report artifacts do not survive a redeploy. A production boot on plain local disk is refused unless `ALLOW_LOCAL_STORAGE=true`; do not set that on the live service. |
| `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL` | Already required. `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true` only after rotation.                                                                                                                                                                                                                                                                                                                           |
| `AUTH_PUBLIC_URL`                              | Public base URL used in emails and webhooks.                                                                                                                                                                                                                                                                                                                                                              |
| `AUTO_MIGRATE_ON_BOOT`                         | Leave `false`; migrate in the release phase (`npm run db:migrate`).                                                                                                                                                                                                                                                                                                                                       |
| Commit SHA on `/api/version`                   | See below.                                                                                                                                                                                                                                                                                                                                                                                                |

**Commit SHA.** `/api/version` returns `commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null`
(`server/index.ts`). Railway injects `RAILWAY_GIT_COMMIT_SHA` for GitHub-triggered deploys, and the
Dockerfile re-exports it as a build ARG. It is `null` on a local build and on a CLI deploy (`railway up`)
that has no git metadata. If it is `null` after deploy, set `COMMIT_SHA=<full or short sha>` as a service
variable and redeploy. The smoke test below fails when the SHA does not match, so confirm it first.

Feature variables stay unset until proven (section 9): `EINVOICE_PROVIDER`, `ACUBE_*`, `COMPLYANCE_*`,
`EINVOICE_INBOUND_WEBHOOK_SECRET`, Stripe keys, email provider, `ZATCA_ENV`.

## 4. Deploy

1. Green CI on the PR (check, lint, coverage ratchet, audit gate, Railway install path, strict API
   coverage, build, bundle budget, `test:db`, boot gate, perf budget).
2. Take the verified backup (section 1) immediately before.
3. Merge to `main` (Railway deploys from `origin/main`). Run `npm run db:migrate` in the release phase.
4. Watch the deploy log for migration errors; `/health/live` then `/health/ready` must be 200.

## 5. Post-deploy checks

```
curl -s https://<host>/api/version                 # commit must equal the merged sha
SMOKE_READ_ONLY=true SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod -- https://<host>
SMOKE_BASE_URL=https://<host> SMOKE_EMAIL=<smoke user> SMOKE_PASSWORD=<password> \
  SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod:routes
```

The route crawl is read-only and creates no accounting records. Then re-run the section 2b queries on
production and compare with the rehearsal. Run `npm run security:verify-prod` inside the Railway
network (SSH) once a key is registered.

## 6. Tenant communications (deploy day)

- **FX rates (0094):** rates entered before the migration on a multi-company database are
  `legacy_unscoped` and ignored by lookups. Tell tenants to re-enter their exchange rates; inverted
  manual rows were rewritten.
- **Invitations (0092):** placeholder users created by the old team invite became pending
  invitations with a new token that is never shown. Inviters must re-send pending invitations.
- **Reconciliation rules (0097):** rules with an unknown match type or no GL account were
  deactivated. Tenants review them in Banking and re-enable.
- **Customer portal links (0103):** existing links keep working but expire within 90 days.
- **Roles (0092):** free-text roles were mapped (`cfo`/`manager` to admin, read-only to viewer,
  anything else to employee). Tell owners to review team roles.
- **Free plan:** the Free plan allows 20 invoices a month (the gate, the 0113 row and public copy agree).

## 7. Rollback

- **Authorization surprises** (a legitimate user is denied): set `RBAC_ENFORCE=report` and redeploy or
  restart. This is a one-variable rollback; it logs would-be denials instead of blocking, so use it
  only briefly and set it back to `enforce`.
- **Application regression without data damage:** redeploy the previous Railway release. The
  migrations are additive and idempotent; the previous code runs against the new schema only where
  columns were added, so check before relying on it.
- **Data damage or a failed migration:** stop the app, restore the verified backup from section 1
  (`pg_restore` into a fresh database, switch `DATABASE_URL`, redeploy the previous release). Data
  written after the backup is lost; capture it first if needed. Verify with the section 5 smoke tests.

## 8. Findings review after deploy

Work `ledger_repair_findings` per tenant with an accountant; they are flagged, not repaired.

## 9. Doc-derived or external, not certified by this deploy

A-Cube e-invoicing (built from documentation only; stays off until proven in the A-Cube sandbox with
owner credentials), email provider (runs stay `blocked_no_provider` until configured), Stripe billing
and online payments, WPS SIF (bank acceptance), GPSSA, gratuity and corporate-tax rules (adviser
sign-off), FAF export (check against the current FTA specification), ZATCA. The e-invoice mandate dates
and the 14-day reporting window are assumptions shown as guidance in the UI; confirm them with the MoF
and FTA. The PR description must say so, so "394 fixed" is not read as "certified".

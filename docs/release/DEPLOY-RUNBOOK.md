# Deploy runbook: branch `claude/eloquent-maxwell-kjxxjc` (migrations 0089 through 0159)

Hosting on your own server instead of Railway: see [SELF-HOSTING.md](SELF-HOSTING.md).

For the Vercel production deployment, follow the [Vercel and UAE PostgreSQL runbook](vercel-uae-production-config.md).

Owner-run. The first deploy of this branch applies 72 journal entries (0089 through 0159) that rewrite some production data
(users, roles, FX rates, bank GL links and reconciliation rules, portal tokens, audit chain, subscriptions). Do not
merge or deploy until sections 1 to 3 are complete and signed off. Doc-derived or external items
(A-Cube, email, Stripe, WPS, GPSSA, FAF) are listed in section 9 and stay off until proven.

## 1. Pre-deploy: verified backup

1. Confirm Railway Postgres snapshots are enabled; note the retention window.
2. Immediately before deploy take a manual dump and verify it restores (see
   [docs/BACKUP_RESTORE_DRILL.md](../BACKUP_RESTORE_DRILL.md)):
   ```
   archive="prod-pre-0089-$(date +%Y%m%d-%H%M).dump"
   pg_dump "$DATABASE_URL" -Fc -f "$archive" &&
     pg_restore --list "$archive" > archive.list
   ```
   Verify the restore on the disposable cluster using section 2e.
3. Record the dump name, size, checksum and the production row counts for `companies`, `users`,
   `company_users`, `journal_entries`, `invoices`. Keep the dump until the post-deploy smoke passes
   and the findings review (section 3) is signed off. Never commit dumps.

## 2. Migration rehearsal on a restored production snapshot

Run the driver in section 2e with the custom-format archive from section 1. It restores the
archive into a fresh database on the verified disposable cluster. Keep the per-file timings,
release log and boot results with the rehearsal record.

Use a direct PostgreSQL connection for the release runner. The release schema guard verifies the
definition and validity of the VAT-group audit membership index. It uses a dedicated session with
at least five minutes for each statement and an advisory lock to serialize retries. A failed build
exits the release command with a nonzero status.

### 2a. Capture BEFORE migrating (pre-state counts)

Run these checks on the restored snapshot before the release migration.

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
-- 0097: reconciliation rules that will be switched off. account_id does not exist before 0097, so
-- on a main schema every active rule counts as "without account" and is deactivated.
SELECT count(*) FILTER (WHERE match_type NOT IN ('exact','contains','starts_with','regex','equals','equal','is')) AS bad_match_type,
       count(*) FILTER (WHERE is_active) AS active_rules_all_deactivated_by_0097
  FROM reconciliation_rules;
-- 0103: plaintext portal tokens that will be hashed (links then expire within 90 days)
SELECT count(*) FROM customer_contacts WHERE portal_access_token IS NOT NULL;
-- 0113: record both totals for the post-migration comparison
SELECT count(*) AS free_rows_before FROM subscriptions WHERE plan_id = 'free';
SELECT count(*) AS companies_without_subscription_before FROM companies c
 WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);
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
-- 0113: subtract free_rows_before from free_rows_after
SELECT count(*) AS free_rows_after FROM subscriptions WHERE plan_id = 'free';
SELECT count(*) AS companies_without_subscription_after FROM companies c
 WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);
```

The increase in Free rows must equal `companies_without_subscription_before`.
The post-migration `companies_without_subscription_after` count must be zero.

### 2c. Read-only scripts (`scripts/qa/`, READ ONLY transactions, safe on the snapshot or production)

```
DATABASE_URL=... node scripts/qa/find-bad-closing-entries.mjs --json    > findings-closing.json
DATABASE_URL=... node scripts/qa/find-inverted-rates.mjs                > findings-rates.txt
DATABASE_URL=... node scripts/qa/find-sales-ledger-drift.mjs            > findings-sales.txt
DATABASE_URL=... node scripts/qa/find-purchases-ledger-drift.mjs        > findings-purchases.txt
DATABASE_URL=... npx tsx scripts/qa/repair-misposted-payments.ts --json > findings-payment-accounts.json
```

`repair-misposted-payments.ts` (X5) lists bill and invoice payments posted to a header account or
to the generic `1020 Bank Accounts` while the company has its own bank account GL (those bank lines
could never be matched). It is read-only unless `--apply --company <uuid>` is passed; the repair
reverses each unmatched payment through `bills.reversePayment` / `invoices.reversePayment` and
records it again (same date, amount, rate, reference) on the primary bank account GL. Payments
already matched to a bank line, or dated in a locked period, are skipped and reported. Run the
repair only after the owner has reviewed the findings, with a fresh backup.

Pre-deploy SQL check (read-only): parent/child posting accounts. `accounts.parent_id` is created by
0093, so on a pre-0089 (main) schema this script errors; run it on the MIGRATED rehearsal copy before
the deploy (rehearsal: [MIGRATION-REHEARSAL.md](MIGRATION-REHEARSAL.md), finding 4). Any parent (header) account that already carries posted journal lines needs an
owner decision before a build that refuses posting to parent accounts goes live:

```
psql "$DATABASE_URL" -f scripts/qa/find-header-posting-accounts.sql
```

Zero rows means clear. Attach the output (even when empty) to the rehearsal record.

Pre-deploy SQL check for the STEP2 removal of Saudi ZATCA and the 15% KSA VAT rate (migration 0133;
read-only, run on production or the snapshot BEFORE the deploy):

```
psql "$DATABASE_URL" -f scripts/qa/find-ksa-zatca-data.sql
```

All counts 0 means clear. Stop rule: a non-zero `zatca_egs_units` / `zatca_documents` count blocks
migration 0133 (it refuses to drop a table that holds rows; export it and get owner sign-off first).
A non-zero count of POSTED 15% documents needs an owner decision before the deploy: their stored
totals and the ledger stay as posted, but re-rendering a stored 15% line (PDF, e-invoice) would
recompute it at 5%. Draft 15% documents, 15% company defaults (reset to 5% by 0133) and
Saudi-address companies are informational.

Pre-deploy SQL check for the STEP3 removal of the unused admin price editor (migration 0134;
read-only, run on production or the snapshot BEFORE the deploy):

```
psql "$DATABASE_URL" -f scripts/qa/find-price-editor-data.sql
```

Both counts 0 means clear. Stop rule: a non-zero `subscription_plans` / `user_subscriptions` count
blocks migration 0134 (it refuses to drop a table that holds rows). Export it
(`\copy subscription_plans TO 'subscription_plans.csv' CSV HEADER`), get owner sign-off, `TRUNCATE`,
then deploy. Those rows never affected any price: plan prices live only in `shared/plans.ts`.

### 2d. Post-migrate checks

After migrating, confirm migration 0133 removed both Saudi ZATCA tables (expect zero rows):

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'zatca\_%';
```

After migrating, confirm migration 0134 removed both price-editor tables (expect zero rows):

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('subscription_plans', 'user_subscriptions');
```

#### Customer portal invitations (0136) and settlement indexes (0137)

Migration `0137_combine_portal_invitations_and_settlement_indexes.sql` applies the settlement
indexes and replays the portal invitation migration for databases that previously applied the
settlement-only version of 0136.

Migration `0136_step5_portal_invitations.sql` creates `customer_portal_invitations`, adds
`invitation_id`, `last_seen_at` and `revoked_by` to `customer_portal_accounts`, and DELETES every
`company_users` row of a `client_portal` user (portal customers are never company members; their
access comes only from `customer_portal_accounts`). It is idempotent. Before migrating, list what
will be removed (expect only stray rows from the old staff bind flow):

```sql
SELECT cu.company_id, u.email FROM company_users cu JOIN users u ON u.id = cu.user_id
 WHERE u.user_type = 'client_portal';
```

#### Bank GL links, invoice payment claims, and journal provenance (0138–0141)

Migration `0138` repairs eligible bank GL links, including on databases that already recorded
`0097`. Migration `0139` reports invalid GL references and unsafe invoice payment links, including
on databases that already recorded `0138`. Review the linked journals before resolving shared,
ambiguous, mismatched, or competing payments. Migration `0140` restores the bank-created
journal flag on provable legacy receipt allocations and reports competing claims when an earlier
`0139` is already recorded. Migration `0141` restores the bank-created flag for legacy
invoice-linked journals that point back to the same bank transaction and have no payment.
The posted journals and external payment links are preserved during migration.
[Bank GL findings query](../migration-rehearsal.md#review-bank-gl-findings)

For pre-`0097` manual invoice matches, review the payment, journal, and scoped audit records
together. A legacy match to an already-paid invoice may carry no payment or journal pointer.
The unmatch service checks the current receivable balance before clearing that link. The
migration finding still records the missing pointers for operator review.
[Legacy invoice payment evidence](../migration-rehearsal.md#legacy-invoice-payment-evidence)

#### Skipped `uq_employees_*` unique indexes (0118)

Migration `0118_x4_payroll.sql` can skip a partial unique index when it finds duplicate
employee data. The driver checks that each index is valid and unique on `public.employees`
and matches the expressions and partial predicate in the migration. A name collision can
also leave an incorrect definition in place.

If the check fails, inspect the existing definition and search the migration log for
`0118: duplicate employee`. Use the expressions and predicates in the migration to find
duplicates, then have the owner review any data or index corrections. Require a passing
rehearsal before sign-off.

Rehearsal table to fill in
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
| Total Free subscription rows                                  | 0113        |     |      |
| Companies without a subscription                              | 0113        |     |      |
| `ledger_repair_findings` / `identity_migration_findings` rows | 0090 / 0092 |     |      |
| Total migrate time, slowest file                              | all         |     |      |

The owner reviews and signs off the findings before the deploy. Findings are flagged, not repaired:
historic unbalanced entries and duplicate reversals need accountant review per tenant afterwards.

### 2e. Scripted rehearsal and the 2026-11-18 record

Build the candidate with `npm run build`. Start a dedicated PostgreSQL cluster bound to
`127.0.0.1` on a dedicated port. Obtain its system identifier from inside the disposable
instance (for example, run `SELECT system_identifier FROM pg_control_system();` through its
local admin connection). Use a local role that can read the control information and create
databases. Configure passwordless access for that role on the disposable cluster's loopback
listener. The driver verifies the identifier against the TCP connection before creating databases.

Run the boot check in an isolated environment with a disposable Redis instance bound to loopback
and `redis-cli` on the path. Production startup requires the shared throttle backend. The rehearsal uses local receipt
storage. Set `cluster_id` to the identifier you recorded and run from the repository root:

```bash
PGURL=postgres://rehearsal@127.0.0.1:55432 \
  REHEARSAL_CLUSTER_ID="$cluster_id" \
  REHEARSAL_REDIS_URL=redis://127.0.0.1:56379 \
  SNAPSHOT_FILE=./pre-release.dump OUT=./rehearsal-out \
  bash docs/release/rehearsal/rehearse.sh
```

Use a fresh `OUT` path and a trusted custom-format archive created with `pg_dump -Fc`. The
driver restores it into a new database and creates fresh backup-restore, timing, rerun and
rollback databases. Each run has a random database name prefix recorded in `steps.log`.
Dispose of the PostgreSQL and Redis instances after collecting the evidence.

The driver checks the backup and both restores, the two migration paths and their schema
equivalence, required post-migration schema, and idempotency in journal order. It runs the
production release command, pings Redis and starts the built server on a free port. It checks
both the HTTP status and response bodies from `/health/ready` and `/api/version`. A failed gate
returns a nonzero exit. Review the gate statuses in `steps.log`, the individual logs and
`schema.diff` in `OUT`, and the QA findings
before signing off. The earlier production-like run and its findings are in
[MIGRATION-REHEARSAL.md](MIGRATION-REHEARSAL.md).

## 3. Environment to set on Railway BEFORE the deploy

| Variable                                                                | Value / reason                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_ENCRYPTION_KEY`                                                  | Random 32+ byte secret, **separate from `SESSION_SECRET`**. The secret vault falls back to `SESSION_SECRET` when unset (`server/services/secret-vault.ts`); set it before any secrets are stored, because rotating it later makes stored secrets unreadable.                                                                                                                                                         |
| `TRUST_PROXY_HOPS`                                                      | Number of proxies in front of the app (Railway: normally `1`). Needed for `req.ip` and per-IP rate limits; the server warns in production when unset and refuses `true`.                                                                                                                                                                                                                                             |
| `RBAC_ENFORCE`                                                          | `enforce` (default). Do not start on `report`: it reopens the audited R01-02 role hole. Keep `report` only as the rollback in section 7.                                                                                                                                                                                                                                                                             |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `REDIS_URL` | Required on every production instance. Prefer the HTTPS REST URL and writable token (Upstash-compatible). Railway can use the TCP Redis URL (`redis://` or `rediss://`, for example `${{ Redis.REDIS_URL }}`). Missing configuration blocks startup. A Redis outage causes throttled requests to fail closed. Memory fallback is available only in development and test.                                             |
| Durable file storage                                                    | Configure a private object store as described below and set `STORAGE_STRICT=true` to require durable storage at startup.                                                                                                                                                                                                                                                                                             |
| `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL`                          | Already required. `JWT_SECRET_ROTATED_AFTER_BACKDOOR=true` only after rotation.                                                                                                                                                                                                                                                                                                                                      |
| `AUTH_PUBLIC_URL`                                                       | Public base URL used in emails and webhooks.                                                                                                                                                                                                                                                                                                                                                                         |
| `FRONTEND_URL`                                                          | The public origin of the app (for example `https://app.example.com`), comma-separated extras in `CORS_ORIGIN`. In production the server refuses any request whose `Origin` is not listed (403 `ORIGIN_NOT_ALLOWED`), and browsers send `Origin` for module scripts, so **unset means every page loads blank** (all JS/CSS assets 403). `curl`-based checks do not catch it; open the site in a browser after deploy. |
| `AUTO_MIGRATE_ON_BOOT`                                                  | Keep `false` and run `node dist/migrate.js` in the release phase.                                                                                                                                                                                                                                                                                                                                                    |
| `BACKGROUND_JOBS_ENABLED`                                               | Unset (on) in production. Only the exact value `false` stops the cron scheduler and the outbox pollers. Staging sets it to `false` (with `sleepApplication: true` from the `staging` override in `railway.json`) so the service can sleep when idle; the first request after sleeping takes a few seconds. HTTP serving is unaffected.                                                                               |
| Commit SHA on `/api/version`                                            | See below.                                                                                                                                                                                                                                                                                                                                                                                                           |

**File storage.** Firm VAT evidence uploads and downloads require a private object store. Set
`BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store, or set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and
`S3_SECRET_ACCESS_KEY` with `S3_REGION` for AWS S3 or `S3_ENDPOINT` for an S3-compatible service such as
R2. A Railway volume alone cannot serve firm VAT evidence.

Before switching traffic, copy existing `uploads/vat-workpapers/` files into the private store.
Preserve the stored object keys with S3-compatible storage, or update the attachment references to
the corresponding private Blob URLs. Verify downloads of existing evidence through the authorized
VAT workpaper route.

**Time zone.** The server process always runs in `TZ=UTC` (the Dockerfile and both compose files set
it, and `server/config/pin-timezone.ts` pins it at startup even when the host says otherwise).
Timestamp columns carry no zone and node-pg reads them in the process zone, so any other zone shifts
every trial end by hours. Dates people read are formatted in `Asia/Dubai` explicitly. Do not set
`TZ` to anything else on Railway.

**Commit SHA.** `/api/version` returns `commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null`
(`server/index.ts`). Railway injects `RAILWAY_GIT_COMMIT_SHA` for GitHub-triggered deploys, and the
Dockerfile re-exports it as a build ARG. It is `null` on a local build and on a CLI deploy (`railway up`)
that has no git metadata. If it is `null` after deploy, set `COMMIT_SHA=<full or short sha>` as a service
variable and redeploy. The smoke test below fails when the SHA does not match, so confirm it first.

Feature variables stay unset until proven (section 9): `EINVOICE_PROVIDER`, `ACUBE_*`, `COMPLYANCE_*`,
`EINVOICE_INBOUND_WEBHOOK_SECRET`, Stripe keys, email provider. Unset any `ZATCA_*` variables: Saudi ZATCA was removed in STEP2 and
nothing reads them any more.

## 4. Deploy

1. Green CI on the PR (check, lint, coverage ratchet, audit gate, Railway install path, strict API
   coverage, build, bundle budget, `test:db`, boot gate, perf budget).
2. Take the verified backup (section 1) immediately before.
3. Merge to `main` (Railway deploys from `origin/main`). Railway runs `node dist/migrate.js` in the release phase.
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
  deactivated. Rules created before this release have no GL account, so on the first deploy that is
  every active rule. Tenants choose an account for each in Banking and re-enable it. Customer notice (EN and AR, owner
  sends; draft only): [CUSTOMER-NOTICE-0097.md](CUSTOMER-NOTICE-0097.md).
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
sign-off), FAF export (check against the current FTA specification). The e-invoice mandate dates
and the 14-day reporting window are assumptions shown as guidance in the UI; confirm them with the MoF
and FTA. The PR description must say so, so "394 fixed" is not read as "certified".

**STEP4 checkout.** Stripe uses the company's existing product trial deadline when at least 48
hours remain. Otherwise checkout starts a paid subscription immediately. A qualifying referral
still discounts the first paid invoice even if the trial has expired.

**Production registration.** Set `TURNSTILE_SECRET_KEY` and the corresponding public
`TURNSTILE_SITE_KEY` in the deployment environment before opening signup. When the secret is
missing, the server starts with a warning and registration and password reset accept requests
without a CAPTCHA.

### 9a. Migration 0117 and the e-invoice provider switch

Migration `0117_e2_einvoice_complyance.sql` (journal idx 116) adds the nullable column
`einvoice_legal_entities.provider_details jsonb`. It is additive and idempotent (`IF NOT EXISTS`);
safe to re-run, no data rewrite, no lock beyond a brief catalog change. Rehearse it with the rest of
0089 through 0159 in journal order, then run it a second time to confirm it is a no-op.

One provider is active at a time, selected by `EINVOICE_PROVIDER` (unset = e-invoicing off; a
provider that is selected but not fully configured stays hidden/"Not connected"):

| `EINVOICE_PROVIDER` | Required env                                                                                                                                                                   | Optional env                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acube`             | `ACUBE_ENV` (`sandbox` or `production`), `ACUBE_EMAIL`, `ACUBE_PASSWORD`                                                                                                       | `ACUBE_WEBHOOK_BASE_URL`, `ACUBE_WEBHOOK_TOKEN`, `ACUBE_WEBHOOK_TOKEN_HEADER`, `ACUBE_SIGNATURE_PUBLIC_KEY`, `ACUBE_WEBHOOK_MAX_AGE_SECONDS`, `ACUBE_INVOICE_SUBMIT_PATH`, `ACUBE_CREDIT_NOTE_SUBMIT_PATH`, `ACUBE_TIMEOUT_MS`                                                                           |
| `complyance`        | `COMPLYANCE_ENV` (`sandbox` or `production`), `COMPLYANCE_API_KEY`, `COMPLYANCE_WEBHOOK_SECRET` (without it the webhook answers 503 and the poll job is the only inbound path) | `COMPLYANCE_BASE_URL`, `COMPLYANCE_SUBMIT_FORMAT` (`gets`/`xml`), `COMPLYANCE_SOURCE_PREFIX`, `COMPLYANCE_SOURCE_VERSION`, `COMPLYANCE_USER_AGENT`, `COMPLYANCE_TIMEOUT_MS`, `COMPLYANCE_POLL_DAYS`, `COMPLYANCE_WEBHOOK_BASE_URL`, `COMPLYANCE_WEBHOOK_ALGORITHM`, `COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS` |

Keep secrets (`ACUBE_PASSWORD`, `COMPLYANCE_API_KEY`, `COMPLYANCE_WEBHOOK_SECRET`) in the secret store.
Complyance (MoF register no. 112219) is doc-derived: verify in its sandbox before production (list in
`docs/einvoicing-complyance.md`); sandbox onboarding needs a real authorised TIN. The Complyance
webhook is `/api/webhooks/einvoice/complyance` (HMAC signed, raw body); the poll job is
`einvoice.complyancePoll`. To switch provider: change `EINVOICE_PROVIDER`, restart; existing
submissions keep their stored provider id and are not migrated.

To remove the provider that was not signed, follow `docs/einvoicing-providers.md` ("Discarding A-Cube"
or "Discarding Complyance"): delete the listed files, edit the listed registrations, locale keys and
env, and unset that provider's env vars. Migrations stay (0117 is kept either way).

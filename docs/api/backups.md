# Company backups and restore

Implementation: `server/services/backup.service.ts`, routes in `server/routes/backups.routes.ts`.
All backup routes need the `backups.manage` permission (owners and admins).

## What a backup contains

The manifest is derived from the live database schema: every table with a `company_id` column and
every table reachable from those through a foreign key (journal lines, invoice lines, bill lines,
bill payments, payroll items, budget lines, claim items, …). Raw-SQL tables are included the same
way. `GET /api/companies/{id}/backups/manifest` lists what is captured and what is excluded, with
the reason. Excluded on purpose: audit trails (`activity_logs`, `audit_*`), access control
(`company_users`, invitations), credentials (API keys, portal tokens), billing state
(subscriptions, usage counters, billing credits/documents), delivery queues and logs (email outbox,
webhook deliveries) and NR firm-workspace tables. `tests/db/backup-full-restore.test.ts` fails when
a company-scoped table is neither captured nor excluded.

## At rest

The snapshot is the JSON rendering of each row (`to_jsonb`), gzip-compressed and encrypted with
AES-256-GCM through the secret vault (key from `TOKEN_ENCRYPTION_KEY`, else derived from
`SESSION_SECRET`). A SHA-256 checksum of the plaintext is stored and verified before every restore.
`GET /api/backups/{id}/download` returns the decrypted JSON export (full-company data portability);
`?format=encrypted` returns a sealed file, including for legacy snapshots stored as plaintext.
Downloads of older snapshots omit operator-only
bank migration findings if present. A filtered JSON download includes a `Content-Digest` header
with the Base64-encoded SHA-256 of the response body. The stored checksum continues to verify the
original archived snapshot.

## Restore

`POST /api/backups/{id}/restore-preview { "mode": "merge" | "replace" }` is a dry run: the restore is
executed in a transaction and rolled back, returning per-table insert / update / delete counts.

`POST /api/backups/{id}/restore`

- `merge` — rows that are missing are added back; existing rows keep their current values; nothing is
  deleted.
- `replace` — requires `confirmName` (the backup name). An automatic pre-restore backup is taken,
  then rows created after the snapshot are deleted (reverse FK order) and every snapshot row is
  upserted (FK order). The company's data then equals the snapshot.

Both run in one transaction under a per-company advisory lock. Append-only tables
(`einvoice_archive`, `tax_return_archive`) are only ever topped up. The audit entry (with the mode
and counts) is written after the transaction commits; a failed restore (checksum mismatch, FK
conflict) changes nothing and writes no success entry.

## Schedules

`PUT /api/companies/{id}/backups/schedule { "frequency": "daily" | "weekly" | "monthly" | "off",
"retentionDays": 90 }`. The `backups.scheduled` job (02:17 UAE) runs due schedules and deletes
scheduled backups past their retention.

## External actions (not done by the app)

- **Point-in-time recovery**: enable WAL archiving / PITR on the managed Postgres (Railway, RDS,
  Neon). This is the disaster-recovery layer for the whole database.
- **Off-site copy**: snapshots live in the application database. For an off-site copy, schedule a
  download of the encrypted file (`?format=encrypted`) to a separate bucket or rely on the database
  host's backup replication.
- UAE FTA record retention (5 years) is met by the ledger itself plus the tax archive; backups
  default to 90-day retention.

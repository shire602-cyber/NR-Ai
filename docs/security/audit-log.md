# Tamper-evident audit log (W5-E / R02-17, R17-23)

## Model

- One chain per company (`audit_logs.chain_key` = company id) plus a `global` chain for
  account events without a company (sign-in, MFA, password).
- Migration `0109_w5e_security` adds `company_id`, `chain_key`, `seq`, `prev_hash`, `hash`,
  `legacy`, chains every pre-existing row in `(created_at, id)` order (marked
  `legacy = true`), and installs two triggers:
  - `audit_logs_chain_insert` (BEFORE INSERT): takes `pg_advisory_xact_lock` for the chain,
    reads the chain head, sets `seq = head + 1`, `prev_hash = head.hash` and
    `hash = sha256(canonical(row) | prev_hash)`. It runs inside the inserting transaction,
    so every writer (storage, the ledger kernel, raw SQL) is covered and concurrent inserts
    form one chain (unique index on `(chain_key, seq)`).
  - `audit_logs_append_only` (BEFORE UPDATE/DELETE): refuses changes unless a reviewed
    maintenance transaction runs `SET LOCAL muhasib.audit_maintenance = 'on'`.
- Canonical form: each field length-prefixed in octets (`n:value`, NULL = `-1:`), joined by
  `|`: chain_key, seq, id, user_id, action, resource_type, resource_id, details, ip,
  user agent, created_at (epoch ms), prev_hash. `server/services/audit-chain.service.ts`
  re-implements it in Node for verification.

### Never blocking on the chain lock

The insert trigger only _tries_ the advisory lock. A transaction that already holds it (for
example a ledger posting that wrote its own audit row and is still open) would otherwise
deadlock against an audit insert made on another connection inside that same request. Such
a row is stored unsealed (`seq`/`hash` NULL) and `audit_seal_pending(chain)` appends it in
`(created_at, id)` order as soon as the lock is free: right after the insert
(`storage.createAuditLog`), from the minute job `audit.sealChains`, and before every verify
or export. The verify response reports `pendingRows`. The sealer may only fill
`seq`/`prev_hash`/`hash` of an unsealed row; any content change is still refused.

## Endpoints

- `GET /api/companies/:companyId/audit-log` — filter by category/action/user/date.
- `GET /api/companies/:companyId/audit-log/verify` — first broken link
  (`hash_mismatch`, `prev_hash_mismatch`, `sequence_gap`, `missing_hash`).
- `GET /api/companies/:companyId/audit-log/export?format=csv|json` — rows with hashes and
  before/after values; the export itself is audited.
- `GET /api/admin/audit-log/verify` — the global chain (platform admins).

## Limits (honest)

- Tamper _evidence_, not tamper _proof_: a database superuser can disable the triggers and
  rewrite every later hash. Publishing or anchoring the chain head outside the database
  (e.g. periodic signed head export to write-once storage) is future work.
- `created_at` is truncated to milliseconds on insert.
- Rows written before 0109 are chained as `legacy`: their order is reconstructed from
  timestamps, and their content before 0109 was not protected.

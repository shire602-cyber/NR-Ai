# Phase 8 design — D5 Platform, security and experience (lead L5, 2026-10-02)

Implementers S9 (backend), S10 (frontend). Migrations 0118-0121. Suite `tests/integration/phase8-platform.test.mjs`.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## 0. Verified findings that correct the plan or VP doc

| # | Finding (file:line) | Consequence |
|---|---|---|
| F1 | `refresh_sessions` (`shared/schema.ts:155-180`) is never read or written; only DDL (`server/db.ts:723`). Refresh is a stateless 7-day JWT plus jti denylist (`auth.routes.ts:462-498`) | Sessions must become real rows |
| F2 | `authMiddleware` (`middleware/auth.ts:73`) never checks `type`, so a refresh token (`:260`, `type:"refresh"`) works as a 7-day access token | HIGH; fixed first |
| F3 | No change-password route; reset-password (`auth.routes.ts:578-612`) revokes nothing | Build both |
| F4 | `api_keys.scopes` is `text default 'read'` (`schema.ts:1550`), not jsonb; DELETE is a hard delete via an N+1 company loop (`api-keys.routes.ts:71-95`) | Keep text (space-separated), soft revoke |
| F5 | `hasCompanyAccess` → `getUserRole` ignores `deleted_at` (`storage.ts:1442-1448, 1213-1219`): direct members reach soft-deleted companies | Fix with deletion |
| F6 | `getAccountsWithBalances` = one query per account, all lines loaded, dates filtered in JS (`storage.ts:1638-1680`) | One GROUP BY |
| F7 | No `journal_lines(account_id)` index; no pagination helper (`X-Total-Count` exists only in the CORS list, `security.ts:146`) | 0121 indexes, `server/lib/pagination.ts` |
| F8 | Invoice create spreads the raw body into the insert (`invoices.routes.ts:404, 513`) | v1 schemas are strict whitelists |
| F9 | `apiAccess` is Enterprise-only (`featureGate.ts:27,78`) | Owner decision |
| F10 | `postOpeningBalance` already takes TB rows + open invoices + open bills (`opening-balance.service.ts:52-68, 293-380`) | Wizard's financial import reuses it |
| F11 | `archiver@5.3.2` is installed via exceljs; zod `3.25.76` ships `zod/v4` with `z.toJSONSchema` (checked at runtime) | No new downloads |
| F12 | Drizzle's migrator skips an entry whose `when` is older than the last applied one | All leads need monotonic `when` |

## 1. Scope

A. Auth: TOTP (RFC 6238) + 10 recovery codes, login challenge, session rows with list/revoke, change password, revoke-on-events, new-device email, company "require 2FA", F2 fix.
B. API v1: scoped keys `muh_<8>_<32>`, per-key limits, idempotency, request log, REST over contacts/items/invoices/bills/payments/journals/reports, OpenAPI 3.1, docs page.
C. Data lifecycle: export ZIP, 30-day soft deletion with restore, purge/anonymise job, firm-owner confirmation for client companies.
D. Migration wizard: Zoho/QuickBooks/Xero CSV or XLSX presets for contacts, items, chart, opening TB, open invoices, open bills; preview → mapping → dry run → commit.
E. Experience: 375 px audit of 25 screens, camera receipt capture, a11y gate, help centre (markdown en/ar, search, contextual links), performance.

Cuts: OAuth2 (VP §5); `webhooks:manage` scope (no v1 webhook routes); Redis; **closed historical invoices/bills** (posting them re-declares revenue and VAT already filed elsewhere — we import open items at go-live); Sage/Wave presets (generic mapping); pagination inside other domains' files moves to a wave-3 sweep after D1-D4 merge.

## 2. Data

Idempotent SQL (`IF NOT EXISTS`, constraints in `DO $$ … EXCEPTION WHEN duplicate_object`). Drizzle definitions in one anchored block after `apiKeys` (`schema.ts:1564`).

**0118_two_factor_sessions.sql** (user-scoped)
- `user_totp(user_id uuid PK → users ON DELETE CASCADE, secret_enc text NOT NULL, enabled_at timestamp, last_used_step bigint, created_at)`. Secret via `secret-vault.ts` `encryptSecret` (AES-256-GCM).
- `user_recovery_codes(id, user_id → users CASCADE, code_hash text, used_at, created_at)`, unique `(user_id, code_hash)`. Codes are 10 base32 chars (50 bits) stored as HMAC-SHA256 under a key derived from `JWT_SECRET` — not bcrypt as the VP wrote: high-entropy codes need one indexed lookup, and ten bcrypt compares per attempt is a CPU DoS lever.
- `refresh_sessions` + `device_hash text`, `revoked_reason text`; index `(user_id, device_hash)`. One row = one logical session; rotation updates `token_hash`.
- `companies.require_two_factor boolean NOT NULL DEFAULT false`.

**0119_public_api.sql** (company-scoped)
- `api_keys` + `expires_at`, `revoked_at`, `revoked_by`, `rate_limit_per_minute int DEFAULT 60`, `rate_limit_per_day int DEFAULT 5000`; unique index on `key_prefix`; backfill: revoke existing rows (pre-v1 keys never authenticated anything).
- `idempotency_keys(id, company_id → companies CASCADE, api_key_id → api_keys CASCADE, idem_key, method, path, request_hash, status in_flight|completed, response_status, response_body jsonb, response_location, created_at, expires_at)`, unique `(api_key_id, idem_key, method, path)`. The CTO name wins over the VP's `api_idempotency_keys`.
- `api_request_log(id bigserial, api_key_id → SET NULL, company_id, method, path, status, duration_ms, ip, created_at)`, index `(api_key_id, created_at)`; 90-day purge. Writes also get an `activity_logs` row with `metadata.apiKeyId`.

**0120_company_data_lifecycle.sql** (company-scoped; reuses `companies.deleted_at`, `schema.ts:367`)
- `company_data_exports(id, company_id, requested_by, status queued|running|ready|failed|expired, stored_file_id → stored_files, sha256, size_bytes, manifest jsonb, error, created_at, completed_at, expires_at)`; partial unique `(company_id) WHERE status IN ('queued','running')`.
- `company_deletion_requests(id, company_id, requested_by, status awaiting_firm|pending|restored|purged|erased|cancelled, reason, firm_confirmed_by, requested_at, purge_after, restored_at, purged_at, retention_expires_at)`; partial unique `(company_id) WHERE status IN ('awaiting_firm','pending')`.

**0121_import_jobs_and_indexes.sql**
- `import_jobs(id, company_id, created_by, source zoho|quickbooks|xero|generic, entity contacts|items|accounts|opening_tb|open_invoices|open_bills, status uploaded|mapped|validated|committing|committed|failed, stored_file_id, filename, mapping jsonb, options jsonb, row_count, error_count, result jsonb, created_at, committed_at)`, index `(company_id, created_at DESC)`.
- `import_job_rows(id, job_id → CASCADE, row_number, raw jsonb, normalized jsonb, errors jsonb, action create|skip_duplicate|error, created_entity_id)`, unique `(job_id, row_number)`.
- Indexes: `journal_lines(account_id, entry_id)`, `activity_logs(company_id, created_at DESC)`, and `(company_id, created_at DESC, id)` on `invoices`, `customer_contacts`, `products`, `journal_entries`, `vendor_bills` (v1 cursors). Further indexes only with EXPLAIN before/after in the load report.

## 3. Posting rules

D5 creates **no new journal source**.

| Path | Journal | Locks |
|---|---|---|
| v1 invoice, payment, bill, bill payment, manual journal | Exactly what the internal route posts (v1 dispatches to it, §5), sources `invoice`, `payment`, `bill`, `bill_payment`, `manual` | `assertPeriodNotLocked`, posting-lock, VAT filing lock, D2 approvals all apply because the same handler runs. v1 journals have no `source` field, so system sources stay unreachable (`journal-entry-protection.ts:60-85`) |
| Wizard opening position | `postOpeningBalance`: each TB account Dr/Cr at its balance, difference to 3040 Opening Balance Equity, dated the day before go-live, source `opening_balance`; open invoices/bills post nothing and no VAT (`opening-balance.service.ts:343-380`); FX at each document's rate | `assertFilingPermission`; 409 if one exists; `reconcileSubledgers` ties AR/AP control to open items; undo = `reverseOpeningBalance` |
| Export, deletion, purge | None; purge never touches journals, invoices, bills, filings, evidence | — |

## 4. State machines and invariants

- **TOTP**: pending → enabled → removed. SHA-1, 6 digits, 30 s, ±1 step, 160-bit secret. Atomic replay guard: `UPDATE user_totp SET last_used_step=$s WHERE user_id=$u AND enabled_at IS NOT NULL AND (last_used_step IS NULL OR last_used_step<$s) RETURNING 1`; no row → `TOTP_REPLAYED`.
- **Recovery code**: `UPDATE … SET used_at=now() WHERE user_id=$u AND code_hash=$h AND used_at IS NULL RETURNING id`.
- **Login challenge**: password OK + TOTP → signed JWT `{type:"2fa_challenge", userId, jti}` (5 min) in JSON and an httpOnly cookie scoped to `/api/auth/2fa`; no access cookie. Success denylists the jti (`token_blacklist`). `buildLimiter` keyed `2fa:<userId>`, 5/min. The OAuth callback (`auth.routes.ts:429-450`) takes the same path and redirects to `/login?step=2fa`.
- **Sessions**: `issueAuthTokens` (`auth.routes.ts:168`, the single issuance point) inserts a row and puts `sid` in both JWTs. Rotation: `UPDATE refresh_sessions SET token_hash=$new, last_used_at=now() WHERE id=$sid AND token_hash=$old AND revoked_at IS NULL AND expires_at>now()`; zero rows while the row exists under another hash = reuse → revoke. `authMiddleware` rejects `type:"refresh"` (F2) and a revoked `sid` (PK lookup). Pre-deploy tokens without `sid` live out their expiry; a legacy refresh creates a row. Revoke others on password change, 2FA enable/disable, recovery regeneration; revoke all on reset and deactivation.
- **Require 2FA**: owner/accountant/cfo of a company with `require_two_factor` and no TOTP gets `scope:"2fa_enrol"` tokens confined to `/api/auth/*` (portal-confinement pattern, `auth.ts:98`).
- **New device**: `device_hash = sha256(userId|browser family+major|OS|IPv4 /24 or IPv6 /48)`; email when unseen for 180 days and the user has earlier sessions; `sendGenericEmail`, skipped when `hasEmailProvider()` is false.
- **API key**: active → revoked | expired. Find by unique prefix, `timingSafeEqual` on SHA-256; require active, unexpired, company not deleted, creator active and still owner/accountant/cfo. Else 401 `API_KEY_INVALID` + request-log row.
- **Tenant pin**: dispatch runs as the creator, who may own other companies, so every by-id v1 route first runs `SELECT company_id FROM <table> WHERE id=$1`; mismatch → 404.
- **Idempotency**: `INSERT … ON CONFLICT DO NOTHING RETURNING id`; on conflict: in-flight < 60 s → 409 `IDEMPOTENCY_IN_FLIGHT` (older: conditional takeover); hash differs → 422 `IDEMPOTENCY_KEY_REUSED`; completed → replay with `Idempotent-Replayed: true`. Store 2xx and 4xx (not 409/429); 5xx deletes the row. TTL 24 h.
- **Export**: queued → running → ready → expired | failed; one live job per company (409 `EXPORT_IN_PROGRESS`); in-process after the 202; stale `running` (>30 min) → failed at boot; link 24 h.
- **Deletion**: request → `awaiting_firm` (client companies; firm_owner confirms) → `pending` (`deleted_at` set, `purge_after`=+30 d, company keys revoked) → `restored` | `purged` → `erased`. Purge (daily): anonymise `customer_contacts` and employee contact fields; remove `company_users`; deactivate/anonymise users whose only membership this was (never admins or firm staff); delete webhooks, push subscriptions, integration and bank tokens; `retention_expires_at` = latest filing period end or journal date + `RETENTION_YEARS` (`retention.service.ts:2`). Erase cascades when due. While deleted: F5 fix denies members; recurring invoices, chasing, report delivery, reminders and bank sync skip the company.
- **Import**: uploaded → mapped → validated → committing → committed | failed. Commit locks the job `FOR UPDATE` and moves validated→committing conditionally (else 409 `IMPORT_ALREADY_COMMITTED`); rows commit with `created_entity_id`, so a crash resumes without duplicates. Duplicates: contacts by TRN else name+email, items by SKU else name, accounts by code.

## 5. API contract

Errors: 400 validation, 401 auth, 403 role/scope, 404 missing or foreign, 409 state, 410 expired, 422 business rule with `code`, 429 with `Retry-After`. v1 envelope `{success, data, error:{code,message,details}, meta}`.

**Auth** (`auth.routes.ts`, new `two-factor.routes.ts`); `passwordSchema` (`auth.routes.ts:227`) gains `.max(128)`.

| Route | Body | Result |
|---|---|---|
| POST /api/auth/login (`:365`) | unchanged | tokens or `{twoFactorRequired, challengeToken, methods}` |
| POST /api/auth/2fa/verify | `{challengeToken?, code? \d{6} \| recoveryCode?}` | tokens; 401 `TOTP_INVALID`/`TOTP_REPLAYED`/`RECOVERY_CODE_INVALID`/`CHALLENGE_EXPIRED`; 429 |
| GET /api/auth/2fa/status | — | `{enabled, recoveryCodesRemaining, requiredByCompanies}` |
| POST /api/auth/2fa/enrol | — | `{secret, otpauthUrl, qrDataUrl}`; 409 `TOTP_ALREADY_ENABLED` |
| POST /api/auth/2fa/enrol/verify | `{code}` | `{enabled, recoveryCodes[10]}`; audit |
| POST /api/auth/2fa/disable, /recovery-codes | `{password, code}` | 200; 401; 403 `TWO_FACTOR_REQUIRED_BY_COMPANY` |
| GET /api/auth/sessions | — | `[{id,userAgent,ipAddress,createdAt,lastUsedAt,current}]` |
| DELETE /api/auth/sessions/:id, DELETE /api/auth/sessions | — | 204 / `{revoked}` |
| POST /api/auth/change-password | `{currentPassword, newPassword, code?}` | 200, others revoked |
| PATCH /api/companies/:companyId/security (`requireRole("owner")`) | `{requireTwoFactor}` | 200 |

**API keys** (`api-keys.routes.ts`): GET list (owner/accountant/cfo); POST with `requireRole("owner","accountant")` + `requireFeature("apiAccess")`, body `{name, scopes[] ⊆ read|write × contacts,items,invoices,bills,payments,journals + read:reports, expiresInDays? ≤730, ratePerMinute? ≤600, ratePerDay?}` → 201 with the key once; `DELETE /api/companies/:companyId/api-keys/:id` soft revoke; old `DELETE /api/api-keys/:id` kept as an alias (one query).

**v1** (`server/api-v1/`), mounted first in `server/routes.ts`: `apiKeyAuth → per-key limiter (minute + day, keyed on key id, draft-7 headers) → requireScope → idempotency → zod v4 strict body → tenant pin → handler`. Reads are company-pinned queries with cursor pagination (`limit≤200`, cursor over `(created_at,id)`). Writes and reports **dispatch**: rewrite `req.url` to the internal route and `next()`, with `req.user` = creator and a Symbol flag `authMiddleware` accepts (clients cannot set it). A `res.json` interceptor maps bodies through v1 serializers (money as 2-dp strings + `currency`, ISO dates) and errors into the envelope, keeping `code`. `/api/v1/` is excluded from the general limiters (`security.ts:178-191`). Writes require `Idempotency-Key` (400 `IDEMPOTENCY_KEY_REQUIRED`); missing scope → 403 `SCOPE_MISSING`.

| v1 route | Scope | Target |
|---|---|---|
| GET /contacts[/:id]; POST /contacts, PATCH /contacts/:id | read/write:contacts | query; `/api/companies/:c/customer-contacts[/:id]` |
| GET /items[/:id]; POST, PATCH | read/write:items | query; `/api/companies/:c/products`, `/api/products/:id` |
| GET /invoices[/:id]; POST /invoices; POST /invoices/:id/post | read/write:invoices | query; `/api/companies/:c/invoices`; `/api/invoices/:id/post` |
| GET/POST /invoices/:id/payments | read/write:payments | `/api/companies/:c/invoices/:id/payments` |
| GET /bills[/:id]; POST /bills; POST /bills/:id/approve; POST /bills/:id/payments | read/write:bills, write:payments | query; bill-pay routes |
| GET /payments?direction=received\|made | read:payments | `invoice_payments` ∪ `bill_payments` |
| GET /journals[/:id]; POST /journals; POST /journals/:id/post | read/write:journals | query; `/api/companies/:c/journal`; `/api/journal/:id/post` |
| GET /reports/{trial-balance, profit-and-loss, balance-sheet, aged-receivables, aged-payables} | read:reports | existing report routes |
| GET /openapi.json | public | `z.toJSONSchema` of the same schemas, cached |

**Data lifecycle** (`company-lifecycle.routes.ts`): `POST /api/companies/:companyId/exports` (owner/accountant) → 202; `GET …/exports[/:id]`; `GET …/exports/:id/download` (410 `EXPORT_EXPIRED`). `DELETE /api/companies/:companyId` (owner) `{password, code?, confirmName}` → 202 `{requestId, status, purgeAfter}`; 401 `REAUTH_REQUIRED`/`PASSWORD_INVALID`/`TOTP_INVALID`; 422 `CONFIRM_NAME_MISMATCH`; 409 `DELETION_ALREADY_REQUESTED`. `GET /api/me/company-deletions`; `POST /api/company-deletions/:id/restore` (410 `RESTORE_WINDOW_CLOSED`); `POST /api/firm/company-deletions/:id/confirm` (`requireFirmOwner`). ZIP: one CSV per allowlisted table (≥ 30; children joined through the parent's company), `documents/` from `documents.file_url`, `receipts.image_path|image_data`, `stored_files` and tax evidence, `manifest.json` (row counts, SHA-256 per file); secret columns denylisted; cells starting `= + - @` prefixed with `'`. ZIP via `archiver` promoted to a direct dependency.

**Import** (`import-jobs.routes.ts`, owner/accountant): `POST /api/companies/:companyId/import-jobs` `{source, entity, filename, contentBase64 ≤5 MB}` → 201 `{job, detectedColumns, suggestedMapping, sampleRows}`; `PUT …/:id/mapping` `{mapping, options:{dateFormat, goLiveDate, currency}}`; `POST …/:id/dry-run`; `POST …/:id/commit`; `GET …/import-jobs`, `GET …/:id/rows?status=error`; `POST /api/companies/:companyId/import-opening` `{tbJobId, invoicesJobId?, billsJobId?}` previews, `?commit=1` calls `postOpeningBalance`. Presets: `server/services/import/presets/{zoho,quickbooks,xero}.ts`.

**Pagination**: opt-in `?page&perPage≤200` sets `X-Total-Count`, `X-Page`, `X-Per-Page`; without params responses are unchanged.

## 6. UI (S10)

| Item | Files | Nav |
|---|---|---|
| Login 2FA step | `components/auth/LoginForm.tsx`, `TwoFactorStep.tsx` | — |
| Security: enrol with QR, recovery codes, sessions, change password, require-2FA switch | `pages/SecuritySettings.tsx` | Settings: `/settings/security` (29/40) |
| API keys tab, scopes picker, one-time key dialog | `pages/DeveloperSettings.tsx` | "Developers" in More; drop `"/api-keys"` from `HIDDEN_FEATURE_ROUTES` |
| Public API docs rendering openapi.json | `pages/ApiDocs.tsx`, `/developers/api` | footer link |
| Data & privacy: exports, deletion with re-auth, restore banner | `pages/DataPrivacy.tsx` | More: `/settings/data` |
| Import wizard: source → entity → upload → mapping → dry-run grid → commit → opening step | `pages/ImportWizard.tsx`, `components/import/*`; links from `MigrationGuides.tsx` | More: `/import` |
| Help: ≥ 30 articles `client/src/help/{en,ar}/*.md`, search with Arabic normalisation, `HelpLink` in headers | `HelpCenter.tsx`, `HelpArticle.tsx` (`/help/:slug`), `components/HelpLink.tsx`, `lib/help/*` | `/help` exists |
| Camera: `capture="environment"`, downscale to 2000 px JPEG | `components/CameraCapture.tsx`, `lib/image-downscale.ts`; in `Receipts.tsx:1402`, later `ReceiptUploadField.tsx:67` (after D2) | — |
| Paged tables | `hooks/usePagedList.ts`, `components/PagedTableFooter.tsx` | wave 3 |

`markdown-lite` renders a safe subset to React elements (no `dangerouslySetInnerHTML`). Page strings use `*.i18n.ts`; markdown parity is unit-tested. No PDFs.

Mobile/a11y: the 25 screens are Dashboard, Invoices, invoice create, PublicInvoiceView, Quotes, Receipts, ExpenseClaims, BillPay, CustomerContacts, Inventory, Journal, JournalEntryDetail, ChartOfAccounts, AccountLedger, BankReconciliation, Reports, FinancialStatements, VATFiling, Payroll, CompanySettings, TeamManagement, Notifications, Login, HelpCenter, SecuritySettings. `tests/e2e/mobile-audit.mjs` (playwright-core, 375×812, en and ar): no horizontal overflow, targets ≥ 24 px, inputs ≥ 16 px, one `h1`, `main` landmark, named buttons, labelled inputs. `scripts/check-a11y-basics.mjs` (icon buttons without `aria-label`, `img` without `alt`) with a ratchet allowlist like the i18n gate.

## 7. Tests

Pattern of `phase6-refunds-aging.test.mjs`; TOTP computed in-test; helpers `run-company-purge.ts`, `run-export.ts` (like `helpers/run-recurring.ts`); clock mocked by moving `purge_after` in the DB. ACs 1-10 belong to D4.

| AC | Test (S9 unless noted) |
|---|---|
| 11 | enrol → verify → 10 codes once; audit row |
| 12 | 2FA login returns challenge, no access cookie |
| 13 | replay → 401 `TOTP_REPLAYED`; 10 parallel verifies → one 200 |
| 14 | recovery code twice → 200, 401; 9 remain |
| 15 | 6 wrong codes → 429 + `Retry-After` |
| 16 | two sessions, `current` flagged; revoked one's refresh **and** access → 401 |
| 17 | change password → others revoked, current works |
| 18 | `read:invoices`: GET 200, POST 403 `SCOPE_MISSING`, /contacts 403 |
| 19 | 61st/min → 429, `RateLimit-Remaining: 0`; key 2 unaffected |
| 20-22 | replay identical + header, one row; other body 422; no key 400 |
| 23 | openapi 3.1 lists every mounted v1 route (router introspection; unit + integration) |
| 24 | revoked/expired → 401 + log row |
| 25-26 | accountant export: ≥ 15 CSVs, documents, manifest hashes, no foreign `company_id`, no secret columns; employee 403 |
| 27 | DELETE without re-auth 401; with password+TOTP hidden, members 403, restore works |
| 28 | after purge: contacts anonymised, admin reads invoices/journals, TB identical, `DELETE /api/invoices/:id` 409 `RETENTION_NOT_EXPIRED` |
| 29 | Zoho contacts with 2 bad rows: preview 2 errors, dry run 0 rows, commit N−2, recommit 409 |
| 30 | help search "VAT" in ar ≥ 1; every nav route maps to an article (S10, unit) |

Extra probes (S9): refresh token as Bearer → 401; company-A key on B's ids → 404; v1 invoice with `isOpeningBalance/companyId/status/number` → 400; locked-period v1 invoice → 422 with `code`; v1 and UI invoices give identical journal lines and VAT box 1; deleted company skipped by recurring/chasing jobs; opening import posts one balanced entry and sub-ledger equals control.

Unit (vitest) — S9: `totp` (RFC 6238 App. B SHA-1 vectors at 6 digits, base32), idempotency hash, key format, device hash, pagination, import presets (`dd/MM/yyyy` vs `MM/dd/yyyy`, `1,234.50`, `(100.00)`), CSV escape, `getAccountsWithBalances` golden (old vs new). S10: help parity and route map, `markdown-lite` injection, `navigation-config.test.ts`, downscale.

## 8. Work split

**S9**: `migrations/0118-0121*` and `_journal.json` entries; D5 block in `shared/schema.ts`; `server/middleware/auth.ts`; `server/routes/{auth,two-factor,api-keys,company-lifecycle,import-jobs}.routes.ts`; `server/api-v1/**`; `server/services/{totp,two-factor,sessions,new-device,company-export,company-deletion}.ts`, `server/services/import/**`; `server/lib/pagination.ts`; anchored edits to `server/routes.ts`, `server/storage.ts` (F5, F6), `middleware/security.ts`, `middleware/csrf.ts` (2FA verify exemption), `services/scheduler.service.ts` (purges, deleted-company skip), `services/auth-tokens.service.ts`, `package.json`; `scripts/load/**`; integration suite, helpers, server unit tests.
**S10**: everything in §6, `client/src/help/**`, `tests/e2e/mobile-audit.mjs`, `scripts/check-a11y-basics.mjs`, client unit tests; anchored edits to `App.tsx`, `nav-config.ts`, `tests/unit/navigation-config.test.ts`.

Order — S9: (1) F2, 0118, sessions, TOTP, change password; (2) 0119, keys, v1, OpenAPI; (3) 0120; (4) 0121, import; (5) F6, indexes, pagination, `scripts/load/run-load.mjs` (fetch + p-limit, seeded by `tests/e2e/report-stress-fixture.mjs`, p50/p95/p99; budget p95 < 500 ms at 10k invoices / 50k journal lines). S10: (1) 2FA login + Security; (2) API keys + docs; (3) Data & privacy; (4) wizard; (5) help; (6) camera, a11y, mobile audit. S10 stubs with typed fixtures matching §5 until each S9 step lands. Wave 3 (after D1-D4 merge): paged invoices, receipts, bills, journal, contacts, products, bank transactions.

## 9. Dependencies

| Need | From | Fallback |
|---|---|---|
| `contact_type`, `vendor_bills.vendor_id`, internal routes accepting them (0106) | D2 | v1 contacts `type:"customer"` only, vendor create 422 `CONTACT_TYPE_UNSUPPORTED`; bills by `vendorName`; wizard skips vendors with a reason |
| Approval gates on bill approve and journals | D2 | v1 inherits whatever the route enforces |
| Drizzle defs for `vendor_bills`, `bill_payments` | D2 | raw SQL reads |
| Discounts, shipping, custom fields on invoices | D1 | added to v1 schemas in the fix round |
| New tables for export | D1-D3 | allowlist checks existence at run time |
| Monotonic `when` (F12) | CTO | proposal: `when = 1781430160000 + (N−101)×60000` for 0102-0121 |

## 10. Review plan (live requests, own port/DB)

1. Tenant: one owner, two companies; A's key on every by-id route with B's ids → 404; lists and ZIP contain only A.
2. Auth: refresh as Bearer; revoked session's access token; challenge reuse; OAuth 2FA bypass; enrol-scope token on `/api/companies/*`; TOTP and recovery races; deactivated creator's key.
3. Money/VAT: v1 vs UI invoice → identical journal and VAT box 1; `"100.005"`, negatives, 1e15 → 400/422; FX without rate 422; locked and filed periods 422; bill-approval bypass through v1.
4. Idempotency: concurrent identical POSTs, other body, 5xx not cached, other key same header independent.
5. Lifecycle: non-owner deletion 403; no chasing email or recurring invoice for deleted companies; restore after day 30 → 410; TB byte-identical after purge; ZIP has no secrets, escaped formulas, 410 after 24 h.
6. Import: dry run leaves counts unchanged; double commit; unbalanced TB 422; locked period 422; Arabic names, `dd/MM/yyyy`.
7. Perf: load numbers; F6 golden equality; EXPLAIN uses new indexes.

## Summary for the CTO

1. D5 adds no journal source; v1 writes dispatch to existing handlers, so locks, VAT, approvals and numbering stay single-sourced.
2. HIGH bug F2: refresh tokens are accepted as 7-day access tokens; fixed first.
3. `refresh_sessions` was never used; sessions become real rows with `sid` in every JWT, so revocation also kills access tokens.
4. No change-password route existed and reset-password revoked nothing; both fixed.
5. Soft-deleted companies stay reachable by direct members (F5); fixed with deletion.
6. The wizard imports open items through the existing opening-balance service; closed history is cut to avoid re-declaring filed VAT.
7. Zero new downloads: TOTP on node crypto, OpenAPI via bundled `zod/v4`, ZIP via `archiver` already installed.
8. CTO action: monotonic `when` in `_journal.json` across all leads (F12), or migrations silently skip.
9. Owner decisions: which plan includes API access (Enterprise today; recommend Professional+); default 2FA for firm owners; 7 vs 5-year retention.
10. Owner items: email provider key (new-device and export mails silent without it); publishing API docs before launch; native Arabic review of help articles.

# Muhasib.ai — Security & Trust Overview

_Last updated: 2026-06-18. Answers map to system behavior verifiable in code
and tests; file references point at the enforcing implementation._

## Launch verification evidence

- 2026-06-18: production read-only smoke passed after deploying the audited
  launch-hardening branch, with liveness, readiness, version, and
  OAuth-provider surface checks:

  ```sh
  SMOKE_READ_ONLY=true SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod -- https://nr-ai-production.up.railway.app
  ```

- Protected-route smoke is supported by `npm run smoke:prod` and requires
  `SMOKE_BASE_URL`, `SMOKE_EMAIL`, and `SMOKE_PASSWORD`. Do not mark the
  authenticated route crawl complete for a target environment until dedicated
  smoke credentials are provided and the script passes against that
  environment.
- Authenticated browser route crawl is supported with the same smoke
  credentials:

  ```sh
  SMOKE_BASE_URL=<url> SMOKE_EMAIL=<email> SMOKE_PASSWORD=<password> SMOKE_EXPECTED_COMMIT=<short-sha> npm run smoke:prod:routes
  ```

  It logs in as the existing smoke user and crawls protected pages read-only;
  scope with `AUTH_CRAWL_PROFILE` or `AUTH_CRAWL_ROUTES` when the smoke user is
  customer- or firm-specific.

## Authentication & access control

- Sessions: JWT access + refresh tokens in HttpOnly cookies
  (`server/services/auth-cookies.service.ts`); credential endpoints are
  rate-limited per IP+email with successful-attempt refunds
  (`server/middleware/security.ts`, `rateLimit.ts`).
- Passwords: bcrypt (cost 10), strength-validated; reset tokens are
  SHA-256-hashed at rest, single-use, 1-hour expiry; responses never reveal
  whether an email exists (`server/routes/auth.routes.ts`).
- Tenancy: every document query is company-scoped
  (`storage.hasCompanyAccess`); the private NRA Center uses one canonical
  predicate on both server and client (`shared/access.ts`,
  `requireNraAccess()` in `server/middleware/rbac.ts`). Persona-matrix and
  URL-guessing tests prove customers cannot reach firm/admin surfaces
  (`tests/unit/nra-access.test.ts`, E2E boundary probes).
- Two-factor authentication (W5-E): optional TOTP (RFC 6238) with ten
  single-use recovery codes stored as SHA-256 digests; the TOTP secret is
  encrypted with the secret vault and never returned by user reads. Sign-in
  with MFA issues a 5-minute `mfa_pending` token that every API route refuses;
  social sign-in is subject to the same second step. Codes are single-use
  (the accepted time step only moves forward). Disabling needs the password
  and a code (`server/services/mfa.service.ts`, `server/routes/auth.routes.ts`).
- Company MFA policy: owners/admins can require MFA for owners and admins or
  for everyone; covered members without MFA get `403 MFA_ENROLLMENT_REQUIRED`
  on that company. Step-up: team role changes, backup restore, API-key
  creation, period unlock and the policy itself need a code verified within
  `MFA_STEP_UP_WINDOW_MINUTES` (default 10) when the actor has MFA
  (`server/services/security/policy.ts`, `requireRecentMfa()`).
- Email verification: registration always answers the same way (no session,
  "check your email") so it reveals nothing about existing accounts; new
  addresses get a 48-hour verification link through the email outbox. After
  `EMAIL_VERIFICATION_GRACE_DAYS` (default 7) unverified accounts cannot
  issue documents or invite people. Enforcement is active only while an
  email provider is configured and `EMAIL_VERIFICATION_ENFORCE` is not
  `false`, so a deployment that cannot send mail never locks anyone out.
- Abuse controls: Cloudflare Turnstile CAPTCHA on registration and
  forgot-password when `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY` are set
  (otherwise reported as `requires_external`, not claimed). Breached-password
  check via a k-anonymity range API (`BREACHED_PASSWORD_CHECK=range`; only a
  5-character SHA-1 prefix leaves the server) with the bundled 10,000
  common-password list as fallback. A WAF / bot-management layer is an
  infrastructure control (see `docs/security/waf-and-bot-protection.md`) and
  is not part of the application.
- Sessions UI: Security settings (`/settings/security`) lists devices, signs
  out one or all of them, and shows the account's sign-in history.
- Plan enforcement: server-side feature/tier/usage gates
  (`server/middleware/featureGate.ts`), proven by
  `tests/unit/billing-enforcement.test.ts`. Fail-open until
  `BILLING_ENFORCEMENT=true` is deliberate pre-launch behavior.

## Data protection

- Secrets at rest: bank tokens and e-commerce credentials are encrypted
  with AES-256-GCM (`server/services/secret-vault.ts`; key from
  `TOKEN_ENCRYPTION_KEY` or HKDF of `SESSION_SECRET`). API responses carry
  presence flags, never stored secrets. A migrate-time backfill encrypts
  legacy plaintext rows (`server/services/secret-backfill.ts`).
- API keys: hashed at rest; the raw key is shown exactly once at creation
  (`server/routes/api-keys.routes.ts`).
- Transport: HTTPS enforced in production (301 upgrade), helmet security
  headers + CSP with per-request nonces, CORS allowlist from
  `FRONTEND_URL`/`CORS_ORIGIN` with origin validation
  (`server/middleware/security.ts`, `csp.ts`).
- Dependencies: `npm audit --omit=dev` is clean (0 vulnerabilities) and part
  of the release gate.

## Financial integrity

- Double-entry: journal entries assert debits = credits before posting;
  posted entries are immutable — corrections go through reversing entries
  (`POST /api/journal/:id/reverse`), which themselves write audit rows.
- Period locking: month-end close locks periods; VAT/CT/journal/autopilot
  posting all call `assertPeriodNotLocked`
  (`server/services/period-lock.service.ts`).
- FTA retention: journal entries respect the UAE 5-year retention guard
  before deletion (`server/services/retention.service.ts`).
- AI guardrails: the receipt autopilot posts only above a per-company
  confidence threshold (floor 80%), only in AED, only into unlocked periods,
  and writes an `ai_autopost_receipt` audit row with full evidence; AI GL
  suggestions create DRAFT entries that humans accept/reject/correct
  (`server/services/receipt-autopilot.service.ts`,
  `autonomous-gl.service.ts`).

## Audit logging

`recordAudit` (`server/services/audit.service.ts`) writes user, action,
resource, before/after detail, IP, and user agent for: posted-ledger
mutations, journal reversals, VAT workpaper rows/status changes, AI
auto-posts and suggestion acceptance, OAuth logins, and firm operations.
Logs are queryable per company via the activity-log endpoints
(`/api/activity-logs`) — this is the access-review export.

Tamper evidence (W5-E): `audit_logs` is append-only (a trigger refuses
UPDATE/DELETE) and hash-chained per company — each row carries `seq`,
`prev_hash` and `hash = SHA-256(canonical row | prev_hash)`, assigned in the
inserting transaction under a per-company advisory lock, so concurrent
writers form one unbroken chain. `GET /api/companies/:id/audit-log/verify`
recomputes the chain and returns the first broken link; `/audit-log/export`
gives CSV/JSON with hashes and before/after values. Security events
(sign-in success/failure, lockout, MFA changes, password change/reset,
token-reuse detection, role and invitation changes, API-key lifecycle,
backup restore, policy changes) are recorded on the same log, and a sign-in
from a new device family and network raises a suspicious-login notification
and email. Limits: see `docs/security/audit-log.md` (a database superuser
could rewrite the whole chain; anchoring the head externally is future work).

## Backup & restore

Checksum-verified backups with a real, transactional restore path
(re-inserts missing rows in FK order, `onConflictDoNothing`) —
`server/routes/backups.routes.ts`, exercised end-to-end by the E2E backup
flow including the retention-guard interaction. Snapshots are encrypted at
rest with the secret vault (AES-256-GCM); only owners/admins
(`backups.manage`) can list, download or restore, restore needs MFA step-up
for MFA users, and each restore is written to the audit chain.

## Data retention & deletion

- Financial records: 5-year FTA retention enforced server-side.
- Companies support soft deletion (`deletedAt`); NRA scope resolution
  excludes soft-deleted companies.
- Backups inherit the same retention posture as live data.

## Incident checklist

1. **Contain** — rotate `SESSION_SECRET`/`TOKEN_ENCRYPTION_KEY` (note: vault
   re-encryption required; bank reconnects acceptable), revoke affected API
   keys (`DELETE /api/api-keys/:id`), disable affected webhook endpoints.
2. **Assess** — query audit logs for the affected window (user, IP, action);
   check Stripe events table for replayed webhooks.
3. **Eradicate** — force password resets (reset tokens are single-use);
   review `auth_identities` for unexpected OAuth links.
4. **Recover** — restore from the latest checksum-verified backup if data
   integrity is in question.
5. **Notify** — UAE PDPL (Federal Decree-Law 45/2021) breach notification
   obligations to the UAE Data Office and affected data subjects without
   undue delay.

## Known limitations (honest list)

- No SOC 2 / ISO 27001 certification — this document is readiness evidence,
  not a certificate. No independent penetration test has been performed yet;
  the scope is prepared in `docs/security/pentest-scope.md`.
- The UAE PDPL / data-residency statement is a draft for counsel review
  (`docs/security/pdpl-data-residency.md`), with the data map in
  `docs/security/data-map.md`.
- CAPTCHA needs a Cloudflare Turnstile site; WAF/bot management needs an
  edge provider. Neither is active until configured.
- E-invoice XML validates locally against PINT AE shape; live ASP/FTA
  submission awaits provider credentials and is marked "not connected".
- Bank reconciliation uses CSV statement imports and lets you review suggested matches against
  your books.
- Rate-limit stores are in-memory per instance; multi-instance deployments
  need a shared store before horizontal scaling.

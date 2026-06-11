# Muhasib.ai — Security & Trust Overview

_Last updated: 2026-06-11. Answers map to system behavior verifiable in code
and tests; file references point at the enforcing implementation._

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

## Backup & restore

Checksum-verified backups with a real, transactional restore path
(re-inserts missing rows in FK order, `onConflictDoNothing`) —
`server/routes/backups.routes.ts`, exercised end-to-end by the E2E backup
flow including the retention-guard interaction.

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
  not a certificate.
- E-invoice XML validates locally against PINT AE shape; live ASP/FTA
  submission awaits provider credentials and is marked "not connected".
- Bank feeds run on the provider abstraction with manual import as the
  production path until a provider (Tarabut/Dapi/Salt Edge/FINX) is
  contracted.
- Rate-limit stores are in-memory per instance; multi-instance deployments
  need a shared store before horizontal scaling.

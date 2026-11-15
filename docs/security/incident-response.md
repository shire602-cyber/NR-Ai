# Incident response outline (W5-E / R17-25)

Status: outline; owners and contact rota are to be assigned by the operator.

1. **Detect** — sources: suspicious-login alerts (`auth.suspicious_login`), lockouts,
   refresh-token reuse (`auth.token_reuse_detected`), Sentry errors, provider alerts,
   customer reports.
2. **Triage** — severity (data exposure, integrity, availability), affected companies,
   start of window. Verify the audit chain for affected companies
   (`GET /api/companies/:id/audit-log/verify`, admins: `/api/admin/audit-log/verify`).
3. **Contain** — revoke sessions (`POST /api/auth/logout-all` per user, or bump token
   versions), revoke API keys, disable webhooks, rotate `JWT_SECRET`, `SESSION_SECRET`,
   `TOKEN_ENCRYPTION_KEY` (vault re-encryption required), require MFA by company policy.
4. **Investigate** — export the audit log (CSV/JSON with hashes and before/after values),
   correlate IP/user agent, review `auth_identities` and invitation events.
5. **Eradicate and recover** — patch, force password resets, restore from an encrypted
   backup if integrity is in question (restores are audited and need MFA step-up).
6. **Notify** — UAE PDPL notification to the UAE Data Office and affected data subjects
   without undue delay where required; customers per contract.
7. **Review** — post-incident report, follow-up actions, update this outline.

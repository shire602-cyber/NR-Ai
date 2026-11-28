# WAF and bot protection (W5-E / R17-24)

Application-level controls that exist today:

- Per-IP and per-credential rate limits and progressive lockout
  (`server/middleware/rateLimit.ts`, `server/middleware/security.ts`).
- Cloudflare Turnstile CAPTCHA on registration and forgot-password when
  `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` are set
  (`server/services/security/captcha.ts`; the CSP allows `challenges.cloudflare.com` only
  then). Without keys the capability reports `requires_external`.
- Breached-password check (`BREACHED_PASSWORD_CHECK=range|offline|off`).

A web application firewall and bot management are **infrastructure** controls and are not
provided by the application. EXTERNAL actions:

1. Put the production hostname behind an edge provider with WAF managed rules (e.g.
   Cloudflare, AWS WAF) and bot management.
2. Set `TRUST_PROXY_HOPS` to match the added proxy hop so per-IP limits keep working.
3. Create the Turnstile site and set the two keys.

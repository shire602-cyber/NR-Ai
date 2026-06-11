# External Dependencies — Owner Action List

_Status notes from the owner, 2026-06-11._

| # | Item | Status / decision | What unblocks it | What I (Claude) do once unblocked |
|---|---|---|---|---|
| 1 | Billing / Stripe | **Deferred — Stripe account pending approvals; keep for last** | Stripe live keys + pricing decisions | Rehab billing module, checkout, customer portal; flip `BILLING_ENFORCEMENT=true` |
| 2 | Live bank feeds | **Lean (leantech.me) not working for the owner — need alternatives** | Pick a provider, get sandbox creds. UAE-capable candidates to evaluate: **Tarabut** (Bahrain/UAE open banking, strong CBUAE alignment), **Dapi** (UAE-founded, payments+data), **Salt Edge** (global aggregator with MENA coverage), **Fintech Galaxy / FINX** (regional open-finance platform). Verify current UAE bank coverage + pricing before choosing | Implement the chosen provider behind the existing `open-banking.service` adapter; the connect/callback/sync endpoints and E2E pipeline already exist |
| 3 | Email delivery | **Owner can do anytime** | Create a Resend (simplest), Postmark, or AWS SES account; set `SMTP_*`/provider API key env vars on Railway | Wire the mailer, verify password-reset + invoice-send + payment-chasing emails end-to-end, add an E2E hook |
| 4 | Domain & branding | **Kept for last — new domain purchase needed** | Buy domain (e.g. muhasib.ai), point DNS at Railway | Custom domain config, `__Host-` cookies, SEO/OG URLs, canonical redirects |
| 5 | Push notifications | Listed for later | Decision to ship mobile/web push + VAPID keypair (I can generate) | Rehab `push` module + service worker; notification preferences already have a page |
| 6 | Webhooks (outbound) | Listed for later | Decision: which events do customers/integrators need? | Rehab `webhooks` module with signing + retries + delivery log UI |
| 7 | API keys (public API) | Listed for later | Decision: expose a public API? Scope + rate limits | Rehab `api-keys` module, scoped keys, docs page |

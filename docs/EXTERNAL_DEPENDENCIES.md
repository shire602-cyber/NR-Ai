# External Dependencies — Owner Action List

_Updated 2026-06-11: every credential-blocked integration is now **fully built
and wired** — the software side is done. Each item below activates the moment
its environment variables are set on Railway. Log in as an admin and call
`GET /api/admin/integration-status` to see live readiness, the exact env var
names still missing, and what each one unlocks._

| # | Item | Software status | What the owner inputs (Railway env vars) | What happens when set |
|---|---|---|---|---|
| 1 | Billing / Stripe | **Prepared** — plans, checkout, customer portal, webhook handler (signature-verified, idempotent via `stripe_events`), usage counters, client paywall all shipped. Gates fail OPEN until enforcement is flipped, so nothing is blocked today | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the 8 `STRIPE_PRICE_*` IDs (see integration-status), then `BILLING_ENFORCEMENT=true` **last**, once a test checkout works | Checkout + customer portal go live; plan limits and feature tiers start enforcing |
| 2 | Live bank feeds | **Prepared** — `open-banking.service` adapter with connect/callback/sync endpoints and E2E pipeline | Pick a provider and paste its creds. UAE-capable candidates: **Tarabut**, **Dapi**, **Salt Edge**, **Fintech Galaxy / FINX** (Lean ruled out by owner). Verify UAE bank coverage + pricing before choosing | Bank connections, automatic transaction sync, reconciliation feed |
| 3 | Email delivery | **Prepared** — `email.service` auto-detects Resend or SMTP; password-reset, invoice-send, payment-chasing templates ready | Either `RESEND_API_KEY` (simplest) or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | Outbound email starts sending immediately — no deploy needed |
| 4 | Domain & branding | Deferred by owner (domain purchase pending) | Buy domain (e.g. muhasib.ai), point DNS at Railway | Custom domain config, `__Host-` cookies, SEO/OG URLs, canonical redirects |
| 5 | Push notifications | **Prepared** — subscribe/unsubscribe endpoints, `push_subscriptions` table, notification-preferences page (EN/AR) | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` — generate locally with `npx web-push generate-vapid-keys` | Browser push for invoice reminders, payments received, VAT deadlines |
| 6 | Webhooks (outbound) | **Live now — no keys needed.** Endpoint CRUD, HMAC signing secret per endpoint, delivery log, failure counter, test-fire endpoint | Nothing — customers register their own consumer URLs in Developer Settings | Already working |
| 7 | API keys (public API) | **Live now — no keys needed.** Scoped keys, raw key shown exactly once, hash-only storage, Developer Settings page | Nothing | Already working |

New pages shipped with this work: **Developer Settings** (API keys + webhooks),
**Notification Preferences**, **Subscription** — all in the Settings group of
the sidebar, EN + AR.

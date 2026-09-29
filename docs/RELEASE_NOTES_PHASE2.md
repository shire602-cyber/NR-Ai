# Release notes - Phase 2 (operable product)

Plain-language summary. Nothing here costs money; every capability is off until you set the variable, and the app says so clearly when it is off.

## What changed
- **Error tracking.** Errors (server 5xx, crashes, browser crashes) go to Sentry when `SENTRY_DSN` is set. Passwords, tokens, cookies, request bodies, TRNs, IBANs, emails and SQL parameters are stripped first.
- **Uploads are real and private.** Documents, portal documents, tax-return files, VAT evidence and expense-claim receipts are stored in durable storage, checked (type, real file contents, 10 MB max) and only downloadable by signed-in people with access to that company. The old "placeholder" URLs are gone; a `fileUrl` sent by a client is ignored. Storage used is now counted per company.
- **Email tells the truth.** With no email provider, sending an invoice, reminder or firm email returns "Email is not configured" (503) instead of pretending. Forgot-password still gives the same reply to everyone (so accounts cannot be probed) but logs an error and alerts Sentry.
- **Trials.** Every new company starts a 14-day trial of the Professional plan. `GET /api/billing/status` reports it; the Subscription page shows "X days left" / "Trial ended".
- **Stripe webhook fixed.** It now verifies against the raw request body (it could never verify before), handles checkout, subscription created/updated/deleted and invoice paid/failed, and retries safely.
- **Credit notes** no longer risk freezing the app under many simultaneous requests.
- **CI** runs lint and `npm audit` (non-blocking for now: lint has 4 errors, audit has 3 high findings; see ci.yml comments).

## Variables (all optional; unset means the feature is off)
| Variable | If unset |
|---|---|
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Errors go to the log only |
| `BLOB_READ_WRITE_TOKEN` (or `S3_BUCKET` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`) | Local disk. **Production then refuses uploads** (see below) |
| `UPLOADS_PERSISTENT=true` / `RAILWAY_VOLUME_MOUNT_PATH` | Declares a persistent volume as durable |
| `STORAGE_ALLOW_EPHEMERAL=true` | New; lets production write to a wiped-on-redeploy disk anyway. Not recommended |
| `RESEND_API_KEY` (+ `RESEND_FROM`), or `SMTP_HOST/USER/PASS` | Email sends fail with `EMAIL_NOT_CONFIGURED` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | No checkout; webhook returns 503 |
| `BILLING_GRANDFATHER_BEFORE` (ISO date, e.g. `2026-10-01`) | New. Companies created before it stay on the top plan. Remove it when you are ready |
| `BILLING_ENFORCEMENT` | **Meaning changed.** Only the exact value `true` blocks anything. Before, production auto-enforced once Stripe was configured; that no longer happens. Otherwise gates only add an `X-Billing-Would-Block: <feature>` response header |

Production will not start with `BILLING_ENFORCEMENT=true` and no Stripe keys.

## Switch-on order
1. `SENTRY_DSN` (free-tier project DSN).
2. Storage: `BLOB_READ_WRITE_TOKEN` (Vercel Blob) or S3/R2 variables. Redeploy.
3. `RESEND_API_KEY` and `RESEND_FROM` (verified sender domain).
4. Stripe **test** keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, six `STRIPE_PRICE_*` ids. Point the Stripe webhook at `/api/webhooks/stripe` (events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed).
5. `BILLING_GRANDFATHER_BEFORE` = the day you go live, so existing clients keep everything.
6. Watch for the `X-Billing-Would-Block` header and INFO log lines ("Billing enforcement would block") to see who would be affected.
7. **Last:** `BILLING_ENFORCEMENT=true`.

## Storage in production (`STORAGE_NOT_DURABLE`)
If `NODE_ENV=production` and there is no object storage, no persistent volume declared, and no `STORAGE_ALLOW_EPHEMERAL=true`, every upload (including receipts) is refused with HTTP 503 and code `STORAGE_NOT_DURABLE`, and the startup log lists it under "Capabilities NOT configured". Nothing is silently written to a disk that is wiped on redeploy. `STORAGE_STRICT=true` still additionally stops the server booting.

## Notes
- Migration `0092` adds `subscriptions.trial_ends_at`, a `stored_files` ledger, and one-subscription-per-company. Run it before deploying.
- Firm-managed client companies are never gated (they are covered by the firm). Files uploaded before this release (receipt images, old VAT evidence) still work but are not counted in storage usage.

## Security fixes from review

- A deactivated client-portal user can no longer regain access through a
  password reset. Deactivation is now a real flag on the user (migration 0093)
  and is checked at login, token refresh, password reset, social login and
  real-time connections.
- A customer can no longer mark a company as firm-managed when creating it.
  Only a platform admin can set the company type, so billing cannot be avoided
  this way.
- Password hashes are removed from user rows before any route can return them.
- Client-portal users now see and download only documents explicitly shared
  with the portal, plus their own uploads. Existing documents are NOT shared by
  default. There is no screen yet for the firm to share a document; until that
  is built, sharing is set through the API field `sharedWithPortal`.

## Known limitations

- Webhook delivery re-resolves the address at send time, so a domain that
  changes its address between the check and the send could reach an internal
  address. Literal private addresses are all refused.
- Invoice emails can be sent to any recipient and email verification is not
  enforced anywhere, so the sending domain could be abused. Add a send limit
  and enforce verification before opening public sign-up.
- `pdfjs-dist` has a known high-severity issue and is used in the browser to
  read uploaded bank statements and receipts. Upgrade before launch.
- Each new company or account starts a fresh 14-day trial.
- The admin document screen still uses the old upload path.

# Personal data map (draft, W5-E / R17-25)

Status: **draft for review**. It describes what the code does today; it is not a legal
opinion and has not been reviewed by counsel or an auditor.

## Categories of personal data

| Category                     | Examples                                                                                         | Where (table / store)                                           | Purpose                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------ |
| Account identity             | name, email, phone, avatar URL                                                                   | `users`                                                         | sign-in, notifications                           |
| Credentials                  | bcrypt password hash, TOTP secret (AES-256-GCM, secret vault), recovery-code SHA-256 digests     | `users`, `user_mfa_recovery_codes`                              | authentication                                   |
| Sessions and security events | refresh-session digests, IP address, user agent, sign-in history                                 | `refresh_sessions`, `token_blacklist`, `audit_logs`             | session management, fraud/abuse detection, audit |
| Company membership           | role per company, invitations (email, role)                                                      | `company_users`, `company_invitations`, `invitations`           | access control                                   |
| Customer and vendor contacts | names, emails, phones, TRNs, addresses                                                           | `customer_contacts`, `vendors`, invoice/bill rows               | bookkeeping, invoicing                           |
| Employees (payroll)          | name, Emirates ID / passport numbers, IBAN, salary, leave                                        | `employees`, `payroll_*`                                        | payroll and WPS files                            |
| Financial documents          | invoices, receipts (images + OCR text), bank statements and transactions                         | `invoices`, `receipts`, `bank_transactions`, object storage     | accounting, VAT, corporate tax                   |
| Communications               | outbound email bodies/attachments (sensitive messages flagged), WhatsApp messages (NR firm only) | `email_outbox`, `email_outbox_attachments`, `whatsapp_messages` | delivery and retries                             |
| Backups                      | JSON snapshots of the books above                                                                | `backups.data_snapshot` (AES-256-GCM)                           | recovery                                         |

## Processors and sub-processors (only when configured)

The application calls a third party only when its environment variables are set; the
capability report (`shared/capabilities.ts`, `/api/integrations/status`) shows which are live.

| Processor                                     | Data sent                                                                       | Trigger / env                               |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| Hosting (Railway) and Postgres                | all data at rest                                                                | deployment                                  |
| Object storage (S3-compatible or Vercel Blob) | uploaded receipts, documents                                                    | `S3_*`, `BLOB_READ_WRITE_TOKEN`             |
| AI providers (OpenAI, Anthropic)              | receipt images/text, transaction descriptions for classification and assistants | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`       |
| Email (Resend or SMTP provider)               | recipient address, message body, attachments                                    | `RESEND_API_KEY`, `SMTP_*`                  |
| Payments (Stripe)                             | billing contact, invoice amount, payer details                                  | `STRIPE_*`                                  |
| E-invoicing ASP                               | e-invoice XML (buyer/seller identifiers)                                        | `EINVOICE_ASP_*`, `ACUBE_*`, `COMPLYANCE_*` |
| SMS / WhatsApp (Twilio, Meta)                 | phone numbers, message text                                                     | `TWILIO_*`, `WHATSAPP_*`                    |
| Error monitoring (Sentry)                     | stack traces, request metadata                                                  | `SENTRY_DSN`                                |
| CAPTCHA (Cloudflare Turnstile)                | widget token, client IP                                                         | `TURNSTILE_*`                               |
| Breached-password range API                   | first 5 hex characters of the password's SHA-1 only                             | `BREACHED_PASSWORD_CHECK=range`             |
| Google / Microsoft OAuth                      | identity assertion (email, name)                                                | `GOOGLE_*`, `MICROSOFT_*`                   |

## Storage locations

Customers supply bank transaction data by uploading a CSV exported from their bank. The customer banking screens route uploads and reconciliation through the application. The server retains optional provider adapters, which require separate configuration and are outside the customer CSV workflow.

Data residency depends on the regions chosen for the hosting, database and storage
providers at deployment time. The application does not pin a region itself. See
`pdpl-data-residency.md` for the open decisions.

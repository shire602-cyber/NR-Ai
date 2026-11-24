# Vercel and UAE PostgreSQL production configuration

No production deployment was performed. Railway remains staging with its own database, object
storage and scheduler. This feature branch disables Vercel Git deployments.

Vercel builds both Vite frontends into `dist/public` and serves hashed assets from its CDN. The
Node 22 Function runs in Dubai (`dxb1`). Express renders the firm shell and its locale and
session boot preloads, along with marketing, portal and app deep links. API misses return an
API response. Dynamic responses are excluded from shared caches.

`/api/version` reports the Vercel revision and `/health/ready` checks PostgreSQL. The Function
shares one small connection pool with the session store. The container still owns the HTTP
listener, Socket.IO, migrations on opt-in, banking retirement cleanup and scheduled jobs.
Function cold starts skip banking retirement, session table creation and session pruning.

## Production request body limits

Use a Vercel **Pro or Enterprise** project and select **Performance (4 GB)** under
**Settings → Functions**. Fluid Compute is enabled in `vercel.json`. Set
`VERCEL_SUPPORT_LARGE_REQUEST_BODY=1` in the project's **Production** environment variables
and redeploy. Apply the same settings to Preview when rehearsing the release. The opt-in is a
public beta for Node.js Functions that raises the inbound body limit from 4.5 MB to 20 MiB.
[Vercel large request body opt-in](https://vercel.com/changelog/vercel-functions-now-support-request-bodies-up-to-20mib)
and [Function memory settings](https://vercel.com/docs/functions/configuring-functions/memory).

The limit applies to the entire HTTP body. The app accepts up to 10 MiB of bank import JSON,
15 MiB of VAT evidence JSON (including base64), and 20 MiB of signed raw email webhook body.
Before cutover, send a bank import larger than 4.5 MB near its 10 MiB limit, upload and download
a VAT evidence file above 4.5 MB through an authorized workpaper, and exercise the signed email
webhook near 20 MiB. Confirm that requests above each cap return HTTP 413.

## Release prerequisites

Before the owner approves go-live:

- Confirm the Vercel networking plan, UAE residency requirements and private DNS and TLS to
  UAE PostgreSQL. Set the production runtime settings from `.env.example` through the approved
  secret store. Expose Vercel's system variables and rehearse the pool budget and proxy trust.
- Provision private UAE object storage. Copy existing `uploads/vat-workpapers/` files into that
  store. Preserve their object keys with S3, or update the attachment references to the
  corresponding private URLs with Vercel Blob. Verify that existing evidence downloads still
  work. Create the `connect-pg-simple` session table and apply migration
  `0156_request_throttle_buckets` before routing traffic to the Function. All instances use the
  same PostgreSQL database for HTTP rate limits, login and MFA lockouts. Assign session pruning
  to a controlled job, rehearse database restore and migrations, and resolve legacy banking
  state before switching traffic.
- Approve a UAE worker and the notification, file and webhook flows that need production
  parity. Rehearse the remaining volume-backed firm attachments, signed webhooks,
  Linux PDF and e-invoice dependencies, cookie and CSRF behavior, and cutover and rollback.

See the [production assessment](../vercel-uae-postgres-assessment.md) for acceptance criteria.

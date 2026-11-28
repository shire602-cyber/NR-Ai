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

## Production environment variables

| Purpose                       | Variables                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Application                   | `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `FRONTEND_URL`                                                       |
| Shared request throttling     | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                                                                        |
| Private Vercel Blob           | `BLOB_READ_WRITE_TOKEN` for a private store                                                                                                 |
| Private S3 or R2              | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, plus `S3_REGION` for AWS or `S3_ENDPOINT` for an S3-compatible endpoint such as R2 |
| Optional signed inbound email | `EMAIL_INTAKE_ENABLED=true`, `EMAIL_INTAKE_WEBHOOK_SECRET`                                                                                  |

Choose one private storage backend. The app prefers Blob when both backends are configured.
Set the writable Redis REST URL and token in every production app instance. Use a separate Redis
database for each environment. Login, MFA, API keys and customer portal throttling use the shared store, along with general
HTTP rate limits. A missing configuration prevents startup. A Redis request failure rejects the affected request. Local
development and test use memory when both Redis variables are unset.

Set the database connection budget and trust proxy hops as appropriate. Available settings are
`DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_IDLE_MS`, `DB_POOL_CONN_MS`,
`DB_STATEMENT_TIMEOUT_MS`, `NODE_EXTRA_CA_CERTS` (when the database needs a custom CA), and
`TRUST_PROXY_HOPS`. Expose the Vercel system variables `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`
and `VERCEL_GIT_COMMIT_SHA` through the project settings.

## Request and file limits

Uploads are limited to 2 MB of actual file data (2,097,152 bytes). JSON upload routes accept
up to 3 MiB to accommodate base64 and metadata. The signed inbound email webhook accepts up to
2 MB for the entire HTTP body, so the JSON envelope and base64 reduce the available attachment
space. The app returns HTTP 413 for oversized uploads within Vercel's 4.5 MB request ceiling.
[Vercel Function limits](https://vercel.com/docs/functions/limitations)

## Release prerequisites

- Confirm UAE residency, database reachability and TLS, and the Redis and object storage data
  paths. Rehearse pool sizing and proxy trust.
- Copy existing `uploads/vat-workpapers/` files into private object storage. Preserve their
  object keys with S3-compatible storage, or update the attachment references to the
  corresponding private Blob URLs. Verify that existing evidence downloads work through the
  authorized workpaper route. Create the `connect-pg-simple` session table before routing
  traffic to the Function. Assign session pruning to a controlled job, rehearse database restore
  and migrations, and resolve legacy banking state before switching traffic.
- Approve a UAE worker and the notification, file and webhook flows that need production parity.
  Rehearse bank statement import, VAT evidence upload and download, and signed inbound email at
  and above their limits. Check the oversize responses in English and Arabic. Rehearse the
  remaining volume-backed firm attachments, e-invoice dependencies, cookie and CSRF behavior,
  and cutover and rollback.

See the [production assessment](../vercel-uae-postgres-assessment.md) for acceptance criteria.

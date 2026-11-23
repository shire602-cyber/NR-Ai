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

Before the owner approves go-live:

- Confirm the Vercel networking plan, UAE residency requirements and private DNS and TLS to
  UAE PostgreSQL. Set the production runtime settings from `.env.example` through the approved
  secret store. Expose Vercel's system variables and rehearse the pool budget and proxy trust.
- Provision private UAE object storage and reconcile existing objects. Create the
  `connect-pg-simple` session table in the release step and assign pruning to a controlled job.
  Rehearse the database restore and migrations, and resolve any legacy banking state before
  switching traffic.
- Approve a UAE worker and the notification, file and webhook flows that need production
  parity. Rehearse Vercel's request limits, volume-backed firm attachments, signed webhooks,
  Linux PDF and e-invoice dependencies, cookie and CSRF behavior, and cutover and rollback.

See the [production assessment](../vercel-uae-postgres-assessment.md) for acceptance criteria.

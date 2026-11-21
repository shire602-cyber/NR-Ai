# Vercel and UAE Postgres production assessment

**Reviewed November 20, 2026** against `claude/eloquent-maxwell-kjxxjc` at
`1dda61d928c206573f66654223184f71dcb8aed9`. This is a source and public documentation review.
Live topology, traffic, enabled integrations, data volumes, and provider account entitlements
are unverified.

## Recommendation

Run the Vite frontends and the request-driven Node.js API on Vercel. Pin data-bearing Functions to
Dubai (`dxb1`) and start with private Amazon RDS for PostgreSQL in AWS Middle East (UAE),
`me-central-1`, with in-region Multi-AZ availability and point-in-time recovery. Use private UAE
object storage for customer documents. Keep Railway as an independent staging environment with
its own database, bucket, job state, and integration credentials. Vercel lists Dubai as a compute
region in the same AWS region as RDS. [Vercel regions](https://vercel.com/docs/regions) ·
[AWS RDS regions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html)

The preferred launch design keeps the existing Postgres outboxes and runs their consumers and
heavy jobs in a UAE worker, such as ECS on Fargate in `me-central-1`. Start with authenticated
HTTP polling for notifications and give uploads and large downloads a direct path to private
object storage. This puts the API on Vercel while retaining a continuous runtime for work that
needs it. If the owner requires every application process on Vercel, evaluate Dubai Daemons or
bounded Queue/Workflow consumers as a separate acceptance gate. If private connectivity or
residency terms fail, the lower-change fallback is Vercel for the frontend and the Express API
plus workers on a UAE container service. [Fargate regions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate-Regions.html) ·
[Vercel Daemons](https://vercel.com/docs/daemons)

## Runtime fit and required code changes

### HTTP, both frontends, and authentication

- Extract an Express app factory or export that registers middleware and routes once per Function
  instance. Keep the Railway entry point as the container wrapper for the listener, Vite dev
  server, signals, upload volume setup, and scheduler. Preserve API middleware and error-handler
  order. Move job and event registration behind explicit app and worker initialization so workers
  still register the subscribers they dispatch to. Use Vercel's Node.js runtime and pin Node
  `22.x` for the first compatibility pass. The package accepts Node 22, the container uses Node
  20, and Vercel deprecated Node 20 on October 1, 2026. Express normally becomes one Function,
  so check the traced bundle against the standard 250 MB uncompressed limit and split entry
  points where measurements warrant it.
  [Server bootstrap](../server/index.ts#L264-L324) · [Route registration](../server/routes.ts#L122) ·
  [Package scripts and engines](../package.json) · [Express on Vercel](https://vercel.com/docs/frameworks/backend/express) ·
  [Node 20 deprecation](https://vercel.com/changelog/node-js-20-is-being-deprecated)
- Publish the two Vite builds and immutable hashed assets from `dist/public`. Preserve
  `/firm` and `/firm/*` routing to the firm shell, locale-aware preload and boot behavior,
  and public, portal, and ordinary app deep links. The Express static layer currently generates
  some HTML based on the request. Keep those responses dynamic until their behavior is reproduced,
  and prevent API misses from falling back to either SPA. Trace the Arabic and Latin PDF fonts,
  e-invoice schemas, Schematron and validation assets, and test Sharp and XML validation on
  Vercel's Linux runtime. [Vite config](../vite.config.ts) ·
  [Static serving](../server/vite.ts#L235-L313) · [Docker asset manifest](../Dockerfile#L71-L80)
- Keep same-origin cookies and `/api` where feasible. Test secure cookies, CSRF,
  `TRUST_PROXY_HOPS`, CORS, client IPs, and absolute URLs for OAuth, email, payments and the portal
  behind Vercel. Use a shared backend for abuse counters and auth-failure state where limits must
  apply across instances. Create the Postgres `session` table in the release step, turn off
  runtime table creation, move pruning to a controlled job, and include the session store in the
  connection budget. Map `VERCEL_GIT_COMMIT_SHA` into `/api/version` and keep `/health/ready`
  for database readiness. Keep authenticated and tenant-specific responses out of shared caches.
  Set production-only runtime credentials and use sandbox endpoints in previews and staging.
  [Server middleware and probes](../server/index.ts#L59-L174) ·
  [In-memory limiters](../server/middleware/rateLimit.ts) ·
  [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables)

### Jobs, queues, and cron

- Replace process-local `node-cron` in the HTTP Function. The registry's overlap flag only covers
  one process. Inventory all registered jobs, including those registered by route modules. Keep
  the existing UTC schedules and UAE business-date rules. The email and domain-event outboxes
  scan every minute, as do audit sealing and outbound webhook retries. Object cleanup runs every
  ten minutes. Other jobs cover recurring invoices, GL classification, report delivery, reminders,
  bank and e-invoice integrations, and maintenance.
  Use one scheduler per environment and have it claim work or enqueue bounded work with a
  durable run key for each schedule window. Keep the existing transactional claims, stale-lease
  recovery, backoff, and dead-letter and replay behavior. [Job registry](../server/platform/job-registry.ts) ·
  [Scheduler](../server/services/scheduler.service.ts#L521-L619) ·
  [Email outbox](../server/outbox/index.ts#L31-L42) ·
  [Event outbox](../server/platform/event-outbox.ts#L228-L240) ·
  [Object cleanup](../server/services/object-deletion-queue.ts#L40-L110)
- Bound batches and checkpoint by item or tenant. Move slow or variable work such as bulk OCR,
  all-tenant GL scans, large report rendering and delivery, and follow-up writes attached to
  `res.on("finish")` into durable work. Preserve recurring-invoice row locks and ledger posting
  invariants. For long requests, return a job ID and status endpoint and publish completed
  artefacts to object storage. Short, measured requests can stay synchronous. Fluid compute
  defaults to 300 seconds and generally allows up to 800 seconds on Pro and Enterprise, with an
  extended-duration beta. These limits also cap cron invocations, and a request timeout or
  deployment must leave work recoverable. [Bulk OCR](../server/routes/firm-bulk.routes.ts#L233-L262) ·
  [Compliance refresh](../server/routes/compliance-obligation-refresh.ts#L53-L110) ·
  [Recurring invoices](../server/services/scheduler.service.ts#L647-L709) ·
  [Function limits](https://vercel.com/docs/functions/limitations)
- A Vercel Cron alternative is a production-only UTC GET protected by `CRON_SECRET` that
  records or enqueues work quickly. The minute cadence needs Pro or Enterprise. Cron invocations
  can overlap or arrive twice, and Vercel does not retry a failed invocation. Use a database
  uniqueness key or lease, catch-up scans, and alerts on missed runs. Vercel Queues, if used, is
  at-least-once. Verify the region for messages, retained state, and consumers, and keep payloads
  to opaque job IDs. Use provider idempotency keys where supported. For ambiguous email, payment,
  or e-invoice delivery, reconcile provider state before replay. Vercel Daemons is in public beta,
  runs only in production deployments, and has no persistent local disk. Verify Dubai,
  private-network reachability, restarts, and deployment handoff before depending on it.
  [Cron management](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs) ·
  [Cron plans](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) ·
  [Queues](https://vercel.com/docs/queues) · [Daemons limits](https://vercel.com/docs/daemons/limits) ·
  [Email send and status update](../server/outbox/outbox.ts#L220-L251)

### WebSockets and notification delivery

The app writes notifications to Postgres and emits them to process-local Socket.IO user rooms.
The client loads notifications over HTTP on mount and then connects with WebSocket and Socket.IO
polling transports. Add authenticated HTTP refresh on a bounded interval, reconnect and tab focus,
and leave DB rows authoritative for unread state. Protect rate limits and test one user's
notifications across sessions and tenants. Vercel now documents WebSockets in public beta and a
Socket.IO example that requires WebSocket-only transport. Connections close at the Function's
duration limit, and reconnects can reach a different instance. For push parity, add shared UAE
pub/sub with durable catch-up and test token renewal, reconnect, origin checks and deploys. A UAE
socket service is an option if the beta or its limits are unacceptable.
[Socket server and room emit](../server/services/socket.service.ts#L43-L103) ·
[Notification hook](../client/src/hooks/useNotifications.ts#L39-L87) ·
[Vercel WebSocket beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta) ·
[Vercel WebSocket limits and Socket.IO](https://vercel.com/docs/functions/websockets)

### Uploads, exports, and webhook ingress

- Vercel sets a 4.5 MB Function request and response body limit. The app accepts 10 MB of JSON
  for selected base64 upload and export routes, and 20 MB of raw inbound email. This affects
  receipt OCR, bank statements, bulk firm intake, invoice/journal attachments, bills and claims,
  and large report downloads. Base64 expands raw file size by roughly a third. For customer
  uploads, authorize the tenant and purpose in the API, issue a short-lived upload grant to a
  private UAE S3 bucket, and finalize by verifying the object key, checksum, actual size, and
  tenant binding. Keep files quarantined until existing sniffing, scanning and sanitization
  pass. Enforce quotas and clean up abandoned objects. Serve large downloads through short-lived
  authorized object URLs and keep the existing access rules for portal and shared links.
  [Body limit routes](../server/http/body-limits.ts) · [Upload guard](../server/services/upload-guard.ts) ·
  [Function limits](https://vercel.com/docs/functions/limitations) ·
  [UAE S3 region](https://docs.aws.amazon.com/general/latest/gr/s3.html)
- The storage adapter prefers Vercel Blob, then S3, then disk. Require the intended private
  production backend and disable local durable writes. Inventory the actual source origins and
  copy objects with key/URL mapping, checksum and count reconciliation. A copied Postgres row
  can still point to a Railway file, a different bucket, or a Blob URL. Vercel also documents
  private regional Blob stores. If chosen, verify Dubai region, the authenticated download
  path for large objects, and caching and replication terms. Keep any local scratch data
  temporary and scoped to the invocation or worker. [Storage adapter](../server/services/fileStorage.ts#L153) ·
  [Vercel Blob regions](https://vercel.com/docs/vercel-blob) ·
  [Private Blob access](https://vercel.com/docs/vercel-blob/private-storage)
- Keep exact raw-byte signature verification on Stripe, payments, email events, and ASP
  callbacks. For inbound email with large attachment payloads, use an approved UAE ingress
  service that can accept and verify the full raw request, or a provider flow that sends a
  small signed event and allows the worker to fetch attachments. Preserve provider message
  IDs, tenant routing and replay protection. Rehearse signed callbacks and large payloads in
  sandboxes. [Raw webhook routing](../server/index.ts#L75-L96) ·
  [Email intake pilot](EMAIL_INTAKE_PILOT.md)

## Database and UAE residency

| Option                                                       | Fit and conditions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amazon RDS for PostgreSQL, UAE `me-central-1`**            | First choice for Vercel Dubai and a UAE worker. Use private subnets, TLS with hostname and CA verification, in-region Multi-AZ, automated backups and PITR. RDS Proxy supports PostgreSQL in the UAE and is private to the VPC. Confirm compatible AZs and measure transaction pinning before relying on proxy capacity. [RDS proxy regions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.RDSProxy.html) · [RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html) · [RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)                               |
| **Azure Database for PostgreSQL Flexible Server, UAE North** | Credible managed alternative with zone-redundant HA and built-in PgBouncer on eligible tiers. Verify SKU and AZ capacity, Vercel-to-Azure private routing and DNS, and where backup and replica data land for the chosen redundancy. UAE Central has access and feature constraints. Validate any second-region recovery in the actual subscription. [Azure regions and capabilities](https://learn.microsoft.com/en-us/azure/postgresql/overview) · [Azure PgBouncer](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer) · [Azure backups](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore) |
| **OCI Database with PostgreSQL, Dubai or Abu Dhabi**         | Oracle documents a Dubai-primary, Abu Dhabi-recovery pattern. Consider it when a second in-country region or an OCI agreement matters. Confirm SKU, backup-copy and restore support and engineering ownership for private connectivity and pooling. Account for a cross-cloud API path. [OCI PostgreSQL overview](https://docs.oracle.com/en-us/iaas/Content/postgresql/overview.htm) · [Oracle UAE recovery example](https://docs.oracle.com/en/learn/full-stack-dr-pgsql-cold-dr/index.html)                                                                                                                                                                          |

The published Neon and Supabase self-serve region lists show no UAE region. Google Cloud SQL's
listed Middle East regions are Doha and Dammam, which are outside the UAE. Treat a managed
Marketplace entry as eligible only when the underlying provider can document a UAE location
for the chosen service, backups, and replicas. [Neon regions](https://neon.com/docs/introduction/regions) ·
[Supabase regions](https://supabase.com/docs/guides/platform/regions) ·
[Cloud SQL regions](https://docs.cloud.google.com/sql/docs/postgres/locations)

**Private connectivity is a go/no-go gate.** Confirm Vercel Secure Compute availability for
the intended Dubai project and quote Enterprise networking with AWS VPC peering. A second
option is Vercel AWS PrivateLink through a supported, customer-published endpoint service.
Validate support and the database endpoint design with both vendors. Shared Static IPs
allowlist public endpoints and do not provide a private route to RDS Proxy. Rehearse DNS, TLS,
round-trip latency and failover from the actual intended Vercel plan and region using a
nonproduction environment. [Vercel Secure Compute](https://vercel.com/docs/networking/secure-compute) ·
[Vercel Static IPs and PrivateLink](https://vercel.com/docs/networking/static-ips) ·
[RDS Proxy networking](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)

**Use the existing Drizzle and `pg` driver path.** The default app pool allows 10 connections per
instance and the current session store has its own connection source. Give Functions a small
reused pool, control connection lifetimes during Fluid suspension, and reserve database
capacity for the worker, maintenance, migrations and failover. Measure connections at spike
concurrency and after idle or redeploy. Use a direct private connection and a separate
migration role for the release runner. Rehearse advisory locks, session state, transactions,
prepared statements where used, and timeouts before enabling proxy multiplexing or PgBouncer
transaction pooling. Audit the source major version, extensions, roles, collation and encoding
against the managed target. [Application pool](../server/db.ts#L17-L69) ·
[Vercel connection pooling](https://vercel.com/kb/guide/connection-pooling-with-functions)

**Get written approval for the data path.** UAE database residency includes primary data,
WAL, PITR backups, replicas, snapshots, restore environments and migration artefacts.
If the requirement covers all customer processing, map Vercel's global ingress/CDN, logs,
traces and support access, object storage and caches, jobs, and external providers for AI/OCR,
payments, banking integrations, email and e-invoicing. Pin sensitive compute and storage, explicitly
choose acceptable failover regions and retention, keep previews synthetic, and minimize
payloads and personal data in logs and event messages. A second UAE availability zone
protects against an AZ failure. A UAE-wide recovery objective needs a separate in-country
design and restore drill. Record choices in the existing data map and have the owner and
privacy reviewer approve the customer-facing statement. [Vercel global network](https://vercel.com/docs/regions) ·
[App data map](security/data-map.md) · [Draft residency statement](security/pdpl-data-residency.md)

## Rehearsal, migration, and cutover

1. **Inventory and baseline.** In an owner-authorized implementation phase, establish the
   actual source engine and schema, Drizzle ledger, row and byte counts, upload locations,
   queues, integrations, and limits. Record peak traffic and job runtimes. Agree on the
   maintenance window, maximum data loss and maximum recovery time. Rehearse on a separate UAE
   environment with synthetic data first, then an approved encrypted snapshot if needed.
   Leave Railway staging isolated. [Existing rehearsal](release/MIGRATION-REHEARSAL.md) ·
   [Backup and recovery drill](BACKUP_RESTORE_DRILL.md)
2. **Rehearse copying and upgrading.** Prefer a timed maintenance-window `pg_dump`/`pg_restore`
   when it meets the outage budget. Include app data, schema, sequences, the Drizzle ledger,
   and any large objects. Recreate roles, grants and extensions in ways the managed service
   supports. Copy object data separately. If downtime is too long, evaluate logical replication
   or a managed CDC service only if the source permits it. Rehearse initial load, WAL retention,
   lag, and a final write fence. Account explicitly for DDL, sequences, roles and large objects
   before promoting the subscriber. Apply only pending Drizzle migrations using a single,
   separately authorized release job equivalent to `node dist/migrate.js`. It also runs
   schema repair and credential backfill. Account for the legacy-ledger baseline behavior,
   the branch's release migrations through 0137, and existing encryption-key compatibility.
   Keep `AUTO_MIGRATE_ON_BOOT` off. [Release migrations and checks](release/DEPLOY-RUNBOOK.md) ·
   [Release entry](../server/migrate.ts#L18-L27) · [Legacy migration ledger](../server/db.ts#L99-L169) ·
   [Vault key derivation](../server/services/secret-vault.ts#L19-L34) ·
   [Postgres logical replication restrictions](https://www.postgresql.org/docs/16/logical-replication-restrictions.html)
3. **Prove parity before the window.** Rehearse the same production build, region and network
   shape. Check tenant counts, grants and isolation, audit-chain verification, exact ledger
   and trial-balance totals in fils, open receivables/payables, VAT, reconciliation and
   representative reports. Compare object keys, counts and checksums. Verify login and MFA,
   portal links, both SPA shells, Arabic PDFs, maximum-size upload/download, raw webhook
   signatures, duplicate-delivery handling, recurring invoice posting and job recovery
   after interruption. Exercise DB restore and connection failover. Establish explicit
   go/no-go thresholds for error rates, p95 latency, connections, queue age, restore time,
   and ledger and object parity. Compare intentional migration changes with the release
   runbook's findings and pre/post counts. [Deploy runbook](release/DEPLOY-RUNBOOK.md)
4. **Cut over with a single writer.** Stage the custom domain and certificate, plan DNS TTL
   and provider callback changes in advance, and keep target jobs and side effects off.
   Enter maintenance mode at the old production origin, pause or drain consumers, and fence
   writes from API traffic, webhooks, jobs, and provider callbacks. Document webhook retries
   or buffer incoming events through an approved durable path. Take a verified final backup,
   transfer the final DB/object state, and verify data, outbox leases, deduplication records and
   files. Activate the new origin, run agreed smoke checks, then start one production scheduler
   and reconcile replayable callbacks. Keep the old origin write-fenced through DNS propagation.
   Decide whether to preserve sessions and signing keys or force reauthentication. Keep vault
   decryption continuity in either case. [Release runbook](release/DEPLOY-RUNBOOK.md)
5. **Rollback and retire.** Before any target writes, the cutover lead can send traffic back to
   the fenced source after verifying that it is still current and resuming only its workers.
   Once the target accepts writes, prefer reverting application code against the new DB if
   schema-compatible. A database rollback now requires a rehearsed reverse transfer, or a
   restore and reconciliation of all accepted writes, objects and external effects with
   explicit owner approval for any data loss. DNS rollback alone can lose transactions or
   duplicate sends. Keep source data and verified recovery artefacts under the agreed
   retention policy until the owner signs off on parity and recovery.

## Key risks and cost drivers

| Risk                                               | Evidence required before cutover                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database overload or slow requests                 | UAE latency under burst load, enough pool headroom, tested DB failover, and no timeout regressions on representative reads and writes.                              |
| Duplicate invoices, payments, email or ASP actions | One active scheduler, durable job claims, stable business and provider keys, visible retries and reconciliation of ambiguous deliveries.                            |
| Missing files or broken uploads                    | Restore a representative object set, reconcile keys and checksums, and pass large upload, export and signed inbound-email flows.                                    |
| Data loss or unreadable records                    | Tested point-in-time restore, matching accounting and audit totals, legacy migration findings reviewed, and encrypted data readable with the approved key strategy. |
| Residency claim exceeds the architecture           | Written confirmation of region, failover, backups, access, caching and processor scope. A deliberate plan for a Dubai region outage is part of acceptance.          |

- **Vercel:** Seats, requests, active CPU, provisioned memory time, CDN and Function data
  transfer, logging/retention, static egress or Enterprise private networking, and queue or
  workflow operations if adopted. Worker memory hours and reconnect traffic can matter even
  with modest API traffic. Get a Dubai-specific quote for the network path. [Vercel plans](https://vercel.com/pricing) ·
  [Function metering](https://vercel.com/docs/functions/usage-and-pricing) ·
  [Regional pricing](https://vercel.com/docs/pricing/regional-pricing)
- **UAE services:** DB instance hours, Multi-AZ, storage and IOPS, proxy or pooler, snapshots
  and PITR retention, worker CPU and memory, queues, object requests/storage and egress,
  monitoring, and any VPN, endpoint, NAT or cross-AZ traffic. Price scheduled and peak job
  loads separately. [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) ·
  [Fargate pricing](https://aws.amazon.com/fargate/pricing/) · [S3 pricing](https://aws.amazon.com/s3/pricing/)
- **Transition and ongoing operations:** Railway staging, parallel production capacity during
  rehearsal and stabilization, one-time copy and transfer, restore drills, provider charges,
  and engineering time for the adapter, uploads, jobs and cutover. Build low/base/high estimates
  from measured traffic, worker job minutes, database CPU and growth, storage and transfer
  volumes, retention and the approved private networking quote.

## Decisions for the owner

- Does UAE residency cover database storage alone, or also documents, backups, runtime
  processing, ingress, logs and every processor? Who signs off, and which AI, email,
  payment and ASP data flows are approved?
- Is a UAE worker acceptable? Is notification polling acceptable at launch, and what
  freshness SLA applies? Which email intake and provider integrations must survive day one?
- Which cloud account and Vercel networking plan are available? Who owns the private
  network, DB operations, restore drills, and production on-call?
- What are the current Postgres version, database and object sizes, storage backends,
  peak request rate and concurrency, job durations, and active provider callbacks? Can
  the source support CDC if the measured outage is too long?
- What outage, data-loss and recovery limits will the owner accept? Is a second UAE region
  required, and who makes go/no-go and rollback decisions?
- Which production domain and release branch are authoritative? Is a planned re-login
  acceptable, and when can the old production source be retired after reconciliation?

## Five-line summary

Vercel can host the site and the main API from Dubai.\
Keep the production database and private files in the UAE, and keep Railway for staging.\
Move heavy jobs and big files outside ordinary web requests, and refresh notifications from the database.\
Practise the move, check the books and files, and stop writes on the old system before switching.\
The owner needs to approve where data may go, how much downtime is acceptable, and what the setup will cost.

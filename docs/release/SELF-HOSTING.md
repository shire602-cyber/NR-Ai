# Self-hosting guide (on-premises, Dubai office)

For running production on your own server instead of Railway. It complements
[DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) (backup, migration rehearsal, smoke, rollback), which still applies.
Validation status: `docker compose -f docker-compose.prod.yml config` passes locally. The go-live gate is the
CI job `selfhost` (`.github/workflows/ci.yml`): it builds the image, boots `docker-compose.prod.yml` (db, migrate,
app, caddy with a self-signed certificate on `localhost`), checks the app runs as non-root, then runs
`scripts/ops/selfhost-smoke.sh` (`/health/live`, `/health`, `/api/version`, register + login + `/api/auth/me`).
Do not go live on a commit where that job is red. Still do a dry run on the real server first.

## 1. Hardware and OS baseline

- 1 server (small business tier): 4 vCPU, 16 GB RAM, 2x NVMe/SSD 500 GB in RAID 1 (mirror), ECC RAM if possible.
  Minimum workable: 2 vCPU, 8 GB RAM, 200 GB SSD.
- OS: Ubuntu Server 24.04 LTS (or Debian 12), 64-bit, with Docker Engine + Compose plugin from Docker's apt repo.
- Time sync on (`timedatectl set-ntp true`), timezone `Asia/Dubai`; fixed LAN IP or a DHCP reservation.
- A separate backup disk or NAS plus an off-site target (section 8).

## 2. Layout and files

Local persistent data lives on the host under `/srv/muhasib` (create with `sudo mkdir -p`). Firm VAT
evidence lives in private object storage (section 3).

| Path                      | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `/srv/muhasib/pgdata`     | PostgreSQL 16 data directory                   |
| `/srv/muhasib/uploads`    | Receipts and report artifacts (`/app/uploads`) |
| `/srv/muhasib/caddy-data` | TLS certificates (Let's Encrypt state)         |
| `/srv/muhasib/backups`    | Local backup staging (encrypted dumps)         |

`/srv/muhasib` is the compose default; set `DATA_DIR` in `.env.prod` to relocate it (CI uses a temp dir).
The app container runs as uid/gid 1001 (`muhasib`, not root), so the uploads directory must be owned by it:
`sudo chown 1001:1001 /srv/muhasib/uploads`. Postgres and Caddy fix the ownership of their own directories.
(On Railway the volume is root-owned: set `RAILWAY_RUN_UID=0` there; the app then chowns the mount and drops
to uid 1001 itself, see `server/index.ts`.)

Repo files used: `Dockerfile`, `docker-compose.prod.yml` (db, one-shot `migrate`, app, caddy) and
`deploy/Caddyfile`. The dev `docker-compose.yml` is not for production (publishes Postgres, default password).

## 3. Environment (`.env.prod`, mode 600, never commit)

```
DB_PASSWORD=<random 32+ chars>
APP_DOMAIN=app.example.ae
ACME_EMAIL=ops@example.ae
COMMIT_SHA=<git rev-parse HEAD>
SESSION_SECRET=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>   # separate from SESSION_SECRET; store a copy in the password vault
AUTH_PUBLIC_URL=https://app.example.ae
RBAC_ENFORCE=enforce
UPSTASH_REDIS_REST_URL=https://<redis-rest-host>
UPSTASH_REDIS_REST_TOKEN=<writable-redis-rest-token>
# Or, for a TCP Redis such as Railway Redis:
# REDIS_URL=redis://default:<password>@<host>:6379

# Private VAT evidence storage. Uncomment one backend and fill in its settings.
# BLOB_READ_WRITE_TOKEN=<private-blob-store-token>

# S3_BUCKET=<private-bucket>
# S3_ACCESS_KEY_ID=<access-key-id>
# S3_SECRET_ACCESS_KEY=<secret-access-key>
# S3_REGION=<aws-region>
# S3_ENDPOINT=https://<s3-compatible-endpoint>
```

Compose sets `NODE_ENV=production`, `DATABASE_URL` (internal `db` host), `AUTO_MIGRATE_ON_BOOT=false`,
`TRUST_PROXY_HOPS=1` and `UPLOADS_PERSISTENT=true` for you. Add the other runbook variables (section 3 of
DEPLOY-RUNBOOK) as needed; feature variables (`EINVOICE_PROVIDER`, `ACUBE_*`, Stripe, email provider) stay unset until proven. Losing `TOKEN_ENCRYPTION_KEY` makes stored secrets unreadable.

**Shared request throttling.** Production requires either the HTTPS REST URL and writable token
(`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) or a TCP Redis URL (`REDIS_URL`, `redis://` or
`rediss://`). Missing configuration blocks startup. A Redis outage causes throttled requests to fail
closed. Memory fallback is available only in development and test.

**File storage.** The bind mount at `/srv/muhasib/uploads` provides durable disk storage for file flows that
support it and is covered by the backups below. Firm VAT evidence requires a private object store. Set
`BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store, or set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and
`S3_SECRET_ACCESS_KEY` with `S3_REGION` for AWS S3 or `S3_ENDPOINT` for an S3-compatible service. Choose a
store that meets the UAE data residency requirement in section 8.

Before upgrading, copy existing `uploads/vat-workpapers/` evidence into the private store. Preserve the
stored object keys with S3-compatible storage, or update the attachment references to the corresponding
private Blob URLs. Verify existing evidence downloads through the authorized VAT workpaper route before
switching traffic.

## 4. First deploy and every release

```
git clone <repo> /opt/muhasib && cd /opt/muhasib && git checkout <release-sha>
export COMMIT_SHA=$(git rev-parse HEAD); sed -i "s/^COMMIT_SHA=.*/COMMIT_SHA=$COMMIT_SHA/" .env.prod
sudo mkdir -p /srv/muhasib/{pgdata,uploads,caddy-data,caddy-config,backups}
sudo chown 1001:1001 /srv/muhasib/uploads        # the app runs as uid 1001, not root
docker compose -f docker-compose.prod.yml --env-file .env.prod config   # validate
/usr/local/sbin/muhasib-backup.sh   # pre-release backup (section 8) before an upgrade
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

`up` runs the `migrate` service (`node dist/migrate.js`, the built equivalent of `npm run db:migrate`;
`drizzle-kit` is not in the production image) to completion before `app` starts, so migrations happen in
the release step and `AUTO_MIGRATE_ON_BOOT` stays `false`. Then check:
`curl -s http://127.0.0.1:5000/health/live`, `/health`, and `/api/version` (its `commit` must equal
`COMMIT_SHA`; the compose file passes it as both a build arg and a runtime variable).
Rollback: check out the previous SHA, restore the pre-release dump if migrations ran (runbook section 7), `up -d --build`.

## 5. TLS and reverse proxy

`deploy/Caddyfile` terminates TLS with automatic Let's Encrypt certificates and proxies to `app:5000`.
Because exactly one proxy is in front of the app, `TRUST_PROXY_HOPS=1`; if you add another proxy or load
balancer, increase it. (`true` is refused.) nginx alternative: `proxy_pass http://127.0.0.1:5000;` with
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host; client_max_body_size 25m;` and certbot, still `TRUST_PROXY_HOPS=1`.

## 6. Pointing the domain

1. Get a static public IP from the ISP (business line), or use a dynamic-DNS client as a fallback.
2. Create DNS `A` record `app.example.ae` to that IP (and `AAAA` if IPv6), TTL 300.
3. On the office router/firewall forward TCP 80 and 443 to the server (80 is needed for certificate issuance).
4. `docker compose ... up -d`; Caddy obtains the certificate on first request. Verify with `curl -I https://app.example.ae`.

## 7. Monitoring and logs

- Liveness `GET /health/live`, readiness `GET /health`; point an external uptime monitor (UptimeRobot, Better Stack)
  at `https://app.example.ae/health/live` with SMS/email alerts, and a second check on `/api/version`.
- Docker healthchecks plus `restart: unless-stopped` restart crashed containers; `docker ps` shows health.
- Container logs rotate through the `json-file` driver (20 MB x 10 files in compose). Set the same in
  `/etc/docker/daemon.json` (`"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"10"}`) for other containers.
  Rotate `/var/log` with the stock `logrotate`; ship `journalctl` and Docker logs off-box if you can.
- Alert on disk usage above 80% (`df -h /srv`), Postgres volume growth, and failed backups (section 8).

## 8. Backups (encrypted, off-site in the UAE, restore drill)

**Data residency.** Customer data must stay in the UAE (trust page and Privacy Policy section 8). That applies
to the off-site backup copy too, so the off-site target MUST be one of:

1. A UAE-region object-storage bucket from a UAE-hosted provider (S3-compatible; configure it as an `rclone`
   remote, for example type `s3` with the provider's UAE endpoint). Confirm the bucket's region is in the UAE in
   the provider's console and keep that evidence with your compliance records.
2. A second UAE site: an SFTP/rsync target (a NAS or VM at another office, a partner, or a UAE colocation
   or cloud VM in a different emirate or availability zone from the primary).

Do not use R2, Backblaze, S3 `us-*`/`eu-*` or any location outside the UAE. `scripts/ops/backup.sh` enforces this:
it exits with an error unless `OFFSITE_REMOTE` is set and `OFFSITE_REGION=uae` is declared, and it verifies the
off-site copy with `rclone check`. Backups are encrypted with `age` before they leave the server, so the target
never holds readable data.

Setup: install `age` and `rclone` (`apt install age rclone`); generate the key pair once with
`age-keygen -o backup.key` (private key in the password vault and on paper in the office safe, NOT on the server;
put the public key in `/etc/muhasib/backup.pub`); `rclone config` the UAE remote; copy `deploy/backup.env.example`
to `/etc/muhasib/backup.env` (mode 600) and edit it; install the script:

```
sudo install -m 700 scripts/ops/backup.sh /usr/local/sbin/muhasib-backup.sh
echo '15 2 * * * root /usr/local/sbin/muhasib-backup.sh >> /var/log/muhasib-backup.log 2>&1' | sudo tee /etc/cron.d/muhasib-backup
```

The script writes `db-<ts>.dump.age`, `uploads-<ts>.tar.age` and a checksum file, keeps 14 days locally, copies
to the UAE target and pings an optional dead-man URL (`HEALTHCHECK_URL`) so a silent failure alerts you. Keep 30
daily + 12 monthly copies off-site using the storage provider's lifecycle rules. The off-site copy is mandatory:
a fire, theft or flood in the office takes the server and the local backup disk together.

Include the private VAT evidence store in the backup and restore drill. The local uploads archive covers
the bind mount. Back up object-store evidence separately and verify that restored references resolve.

**Recovery point objective (RPO).** With the nightly dump the RPO is up to 24 hours: everything entered since the
last dump is lost if the server and its disks are lost. Say so to the owner and accept it explicitly, or reduce it:

- Run the dump more often (`0 */6 * * *` gives up to 6 h) if volume is high.
- Optional continuous WAL archiving gives point-in-time recovery with an RPO of minutes (archive timeout 5 min):
  `docker compose -f docker-compose.prod.yml -f deploy/postgres-wal.yml --env-file .env.prod up -d`
  (create `/srv/muhasib/wal-archive` first, `sudo install -d -o 999 -g 999 /srv/muhasib/wal-archive`). Take a
  base backup (`pg_basebackup`, or the nightly `pg_dump` is NOT a base backup) and ship the wal-archive directory
  to the UAE target every few minutes with `rclone copy` (encrypt with `age` or use an encrypted rclone remote).
  Restoring from WAL is a `restore_command` / `recovery_target_time` recovery of the base backup; rehearse it
  before relying on it. Until you have rehearsed it, treat the RPO as 24 h.

**Restore drill (before go-live and quarterly).** `scripts/ops/restore-drill.sh` decrypts the newest dump,
restores it into a throwaway Postgres 16 container and records the restore time in
`/srv/muhasib/backups/restore-drill.log`:

```
AGE_IDENTITY=/path/to/backup.key scripts/ops/restore-drill.sh            # newest dump
AGE_IDENTITY=/path/to/backup.key scripts/ops/restore-drill.sh db-<ts>.dump.age
```

The logged `restore_seconds` covers the database only. Add the time to restore the uploads archive, boot the stack
and run `scripts/ops/selfhost-smoke.sh`, and write the total down as your real recovery time (RTO). Do the drill
on a different machine from production at least once, using only the off-site copy and the vaulted key.

**Processors outside the UAE.** The core stack (app, Postgres, uploads, backups) stays in the UAE. Optional
features call third parties that may process data elsewhere and are off until configured: the AI provider
(`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, receipts and prompts; `AI_REDACT_PII=true` masks names, TRNs and IBANs),
the email provider (SMTP/Resend), Stripe (billing), the e-invoicing provider and Google Sheets. These are the
"transfers outside the UAE" that Privacy Policy section 8 refers to. Leave a feature unconfigured unless you are
willing to disclose that processor, and keep the processor list in the Privacy Policy and your data-processing
agreements in step with what is actually switched on. The off-site backup is never allowed to be one of them.

## 9. Power, network and physical

- Online/line-interactive UPS sized for 30+ minutes of the server and network gear, with `apcupsd`/`nut` configured to shut the host
  down cleanly at low battery. Test it. Put the server, router and switch on the UPS; consider a generator or building backup if the office loses power often.
- **Single internet line is a single point of failure.** One office line (and one office power feed) means an ISP
  outage or a router fault takes the product offline for every customer, with no fix on your side. Recommended
  topology: run production on a UAE cloud VM (UAE-region provider, same compose files, same backups) as the
  PRIMARY, and keep the office box as a STANDBY that restores from the UAE off-site backups (or replicates via the
  WAL archive) and is promoted by switching the DNS record (TTL 300). If you run primary from the office anyway,
  you accept office-line downtime: get the dual-WAN setup below and test failover.
- Redundant internet: a second ISP (different provider, e.g. fibre plus 5G/LTE failover) on a dual-WAN router, with
  dynamic DNS or a low DNS TTL for switching. Single-IP port forwards must exist on both links, or use a Cloudflare Tunnel
  (outbound only) as a fallback path.
- Physical: locked cabinet, cool and dusty-free room (Dubai summer: monitor temperature), disks monitored with `smartd`.
- Keep a documented standby plan: backups are restorable to a UAE cloud VM (same compose files) within hours; rehearse it with the restore drill.

## 10. Security

- Firewall (`ufw`): default deny incoming; allow 80, 443; allow 22 only from the office IP/VPN. Postgres is never published
  (it has no `ports:`), and the app port is bound to `127.0.0.1`. Remember Docker bypasses `ufw` for published ports, which is why only caddy publishes any.
- SSH: key-only (`PasswordAuthentication no`, `PermitRootLogin no`), `fail2ban`, a named admin user.
- Updates: `unattended-upgrades` for security patches; reboot window monthly; update Docker images (`pull`) and rebuild per release.
- Secrets: `.env.prod` mode 600 owned by root; rotate `DB_PASSWORD`, `SESSION_SECRET`, `JWT_SECRET` on staff changes
  (not `TOKEN_ENCRYPTION_KEY` without a re-encryption plan). Full-disk encryption (LUKS) if the server is not physically secured.
- Keep `RBAC_ENFORCE=enforce`. Email only goes out through a configured provider; nothing is transmitted to the FTA/EmaraTax/ASP without an explicit configured boundary.

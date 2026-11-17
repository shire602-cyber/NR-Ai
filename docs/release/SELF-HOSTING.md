# Self-hosting guide (on-premises, Dubai office)

For running production on your own server instead of Railway. It complements
[DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) (backup, migration rehearsal, smoke, rollback), which still applies.
Validation status: `docker compose -f docker-compose.prod.yml config` passes; the image build and a full
boot on a real server were NOT run in this environment (no Docker daemon), so do a dry run first.

## 1. Hardware and OS baseline

- 1 server (small business tier): 4 vCPU, 16 GB RAM, 2x NVMe/SSD 500 GB in RAID 1 (mirror), ECC RAM if possible.
  Minimum workable: 2 vCPU, 8 GB RAM, 200 GB SSD.
- OS: Ubuntu Server 24.04 LTS (or Debian 12), 64-bit, with Docker Engine + Compose plugin from Docker's apt repo.
- Time sync on (`timedatectl set-ntp true`), timezone `Asia/Dubai`; fixed LAN IP or a DHCP reservation.
- A separate backup disk or NAS plus an off-site target (section 8).

## 2. Layout and files

Everything persistent lives on the host under `/srv/muhasib` (create with `sudo mkdir -p`):

| Path                      | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `/srv/muhasib/pgdata`     | PostgreSQL 16 data directory                   |
| `/srv/muhasib/uploads`    | Receipts and report artifacts (`/app/uploads`) |
| `/srv/muhasib/caddy-data` | TLS certificates (Let's Encrypt state)         |
| `/srv/muhasib/backups`    | Local backup staging (encrypted dumps)         |

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
```

Compose sets `NODE_ENV=production`, `DATABASE_URL` (internal `db` host), `AUTO_MIGRATE_ON_BOOT=false`,
`TRUST_PROXY_HOPS=1` and `UPLOADS_PERSISTENT=true` for you. Add the other runbook variables (section 3 of
DEPLOY-RUNBOOK) as needed; feature variables (`EINVOICE_PROVIDER`, `ACUBE_*`, Stripe, email provider,
`ZATCA_ENV`) stay unset until proven. Losing `TOKEN_ENCRYPTION_KEY` makes stored secrets unreadable.

**Storage choice.** Production refuses to boot on local disk unless storage is durable
(`server/services/fileStorage.ts`). For an on-prem server the right choice is the host directory
`/srv/muhasib/uploads` bind-mounted into the container plus `UPLOADS_PERSISTENT=true` (already set in
compose); this declares the volume durable and is covered by the backups below. Do not use
`ALLOW_LOCAL_STORAGE=true` (that only silences the guard). If you prefer off-site object storage, set
`S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `STORAGE_STRICT=true`).

## 4. First deploy and every release

```
git clone <repo> /opt/muhasib && cd /opt/muhasib && git checkout <release-sha>
export COMMIT_SHA=$(git rev-parse HEAD); sed -i "s/^COMMIT_SHA=.*/COMMIT_SHA=$COMMIT_SHA/" .env.prod
sudo mkdir -p /srv/muhasib/{pgdata,uploads,caddy-data,caddy-config,backups}
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

## 8. Backups (encrypted, off-site, restore drill)

Install `age` (`apt install age`) and generate a key pair once: `age-keygen -o backup.key` (keep the private key
in the password vault and on paper in the office safe, NOT on the server); put the public key in `/etc/muhasib/backup.pub`.
Save as `/usr/local/sbin/muhasib-backup.sh` (mode 700):

```
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M); D=/srv/muhasib/backups; PUB=/etc/muhasib/backup.pub
docker exec muhasib-db-1 pg_dump -U muhasib -Fc muhasib | age -R "$PUB" > "$D/db-$TS.dump.age"
tar -C /srv/muhasib -cf - uploads | age -R "$PUB" > "$D/uploads-$TS.tar.age"
find "$D" -name '*.age' -mtime +14 -delete                      # local retention 14 days
rclone copy "$D" offsite:muhasib-backups --include "*-$TS.*.age"   # OFF-SITE copy (S3/R2/Backblaze, other country/region ok)
curl -fsS https://hc-ping.com/<your-uuid> >/dev/null            # dead-man switch: alert if backups stop
```

Schedule: `/etc/cron.d/muhasib-backup`: `15 2 * * * root /usr/local/sbin/muhasib-backup.sh` (nightly) and
`0 */6 * * *` for the DB alone if transaction volume is high. Keep 30 daily + 12 monthly off-site
(object-storage lifecycle rules). The off-site copy is mandatory: a fire, theft or flood in the office takes the
server and the local backup disk together.

**Restore drill (do it before go-live and quarterly).** On a different machine or scratch container:
`age -d -i backup.key db-<ts>.dump.age > db.dump`; `createdb muhasib_restore && pg_restore -d muhasib_restore --no-owner db.dump`;
untar the uploads archive; boot the app against it and run the runbook post-deploy smoke. Record the time it took
(your real recovery time) and any problems.

## 9. Power, network and physical

- Online/line-interactive UPS sized for 30+ minutes of the server and network gear, with `apcupsd`/`nut` configured to shut the host
  down cleanly at low battery. Test it. Put the server, router and switch on the UPS; consider a generator or building backup if the office loses power often.
- Redundant internet: a second ISP (different provider, e.g. fibre plus 5G/LTE failover) on a dual-WAN router, with
  dynamic DNS or a low DNS TTL for switching. Single-IP port forwards must exist on both links, or use a Cloudflare Tunnel
  (outbound only) as a fallback path.
- Physical: locked cabinet, cool and dusty-free room (Dubai summer: monitor temperature), disks monitored with `smartd`.
- Keep a documented standby plan: backups are restorable to a rented cloud VM (same compose files) within hours.

## 10. Security

- Firewall (`ufw`): default deny incoming; allow 80, 443; allow 22 only from the office IP/VPN. Postgres is never published
  (it has no `ports:`), and the app port is bound to `127.0.0.1`. Remember Docker bypasses `ufw` for published ports, which is why only caddy publishes any.
- SSH: key-only (`PasswordAuthentication no`, `PermitRootLogin no`), `fail2ban`, a named admin user.
- Updates: `unattended-upgrades` for security patches; reboot window monthly; update Docker images (`pull`) and rebuild per release.
- Secrets: `.env.prod` mode 600 owned by root; rotate `DB_PASSWORD`, `SESSION_SECRET`, `JWT_SECRET` on staff changes
  (not `TOKEN_ENCRYPTION_KEY` without a re-encryption plan). Full-disk encryption (LUKS) if the server is not physically secured.
- Keep `RBAC_ENFORCE=enforce`. Email only goes out through a configured provider; nothing is transmitted to the FTA/EmaraTax/ASP without an explicit configured boundary.

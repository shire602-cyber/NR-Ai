#!/usr/bin/env bash
# Encrypted backup of the self-hosted Muhasib stack: database dump + uploads, copied to a UAE off-site target.
# Install: cp scripts/ops/backup.sh /usr/local/sbin/muhasib-backup.sh; chmod 700. Config: /etc/muhasib/backup.env
# (template deploy/backup.env.example). Run nightly from cron; run before every release.
set -euo pipefail

CONF="${BACKUP_CONF:-/etc/muhasib/backup.env}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

: "${BACKUP_DIR:=/srv/muhasib/backups}"
: "${UPLOADS_DIR:=/srv/muhasib/uploads}"
: "${AGE_RECIPIENTS_FILE:=/etc/muhasib/backup.pub}"
: "${DB_CONTAINER:=muhasib-db-1}"
: "${DB_USER:=muhasib}"
: "${DB_NAME:=muhasib}"
: "${LOCAL_RETENTION_DAYS:=14}"
: "${OFFSITE_REMOTE:=}"
: "${OFFSITE_REGION:=}"

fail() { echo "backup: $*" >&2; exit 1; }

# Data residency guard: no off-site target, or one not declared UAE-region, is a hard failure.
[ -n "$OFFSITE_REMOTE" ] || fail "OFFSITE_REMOTE is not set (a UAE-region off-site target is mandatory)"
[ "$OFFSITE_REGION" = "uae" ] || fail "OFFSITE_REGION must be 'uae'; customer data may not leave the UAE"
command -v age >/dev/null || fail "age is not installed"
command -v rclone >/dev/null || fail "rclone is not installed"
[ -r "$AGE_RECIPIENTS_FILE" ] || fail "age recipients file $AGE_RECIPIENTS_FILE not readable"

TS=$(date +%Y%m%d-%H%M)
START=$(date +%s)
mkdir -p "$BACKUP_DIR"
DB_OUT="$BACKUP_DIR/db-$TS.dump.age"
UP_OUT="$BACKUP_DIR/uploads-$TS.tar.age"

docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" | age -R "$AGE_RECIPIENTS_FILE" > "$DB_OUT.tmp"
mv "$DB_OUT.tmp" "$DB_OUT"
tar -C "$(dirname "$UPLOADS_DIR")" -cf - "$(basename "$UPLOADS_DIR")" | age -R "$AGE_RECIPIENTS_FILE" > "$UP_OUT.tmp"
mv "$UP_OUT.tmp" "$UP_OUT"
[ -s "$DB_OUT" ] || fail "database dump is empty"
( cd "$BACKUP_DIR" && sha256sum "db-$TS.dump.age" "uploads-$TS.tar.age" > "sha256-$TS.txt" )

find "$BACKUP_DIR" \( -name '*.age' -o -name 'sha256-*.txt' \) -mtime +"$LOCAL_RETENTION_DAYS" -delete

rclone copy "$BACKUP_DIR" "$OFFSITE_REMOTE" --include "*-$TS.*"
rclone check "$BACKUP_DIR" "$OFFSITE_REMOTE" --one-way --include "*-$TS.*" || fail "off-site copy does not match local backup"

echo "backup: ok ts=$TS seconds=$(( $(date +%s) - START )) db_bytes=$(stat -c %s "$DB_OUT") offsite=$OFFSITE_REMOTE"
[ -z "${HEALTHCHECK_URL:-}" ] || curl -fsS "$HEALTHCHECK_URL" >/dev/null

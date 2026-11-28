#!/usr/bin/env bash
# Restore drill: decrypts the newest encrypted database dump, restores it into a throwaway Postgres 16
# container, checks it, and records how long recovery took (your measured RTO) in restore-drill.log.
# Run on a machine that is NOT the production server where possible. Needs docker and age.
# Usage: AGE_IDENTITY=/path/backup.key scripts/ops/restore-drill.sh [dump.age]   (default: newest in BACKUP_DIR)
set -euo pipefail

CONF="${BACKUP_CONF:-/etc/muhasib/backup.env}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
: "${BACKUP_DIR:=/srv/muhasib/backups}"
: "${AGE_IDENTITY:?set AGE_IDENTITY to the age private key file (kept in the vault, not on the server)}"
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/db-*.dump.age 2>/dev/null | head -1)}"
[ -n "$DUMP" ] && [ -r "$DUMP" ] || { echo "restore-drill: no dump found" >&2; exit 1; }

NAME="muhasib-drill-$$"
WORK=$(mktemp -d)
LOG="${DRILL_LOG:-$BACKUP_DIR/restore-drill.log}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

START=$(date +%s)
age -d -i "$AGE_IDENTITY" "$DUMP" > "$WORK/db.dump"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill postgres:16-bookworm >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -d drill >/dev/null 2>&1 && break; sleep 1; done
docker cp "$WORK/db.dump" "$NAME:/tmp/db.dump"
docker exec "$NAME" pg_restore -U postgres -d drill --no-owner --exit-on-error /tmp/db.dump

q() { docker exec "$NAME" psql -U postgres -d drill -Atc "$1"; }
COMPANIES=$(q "SELECT count(*) FROM companies")
USERS=$(q "SELECT count(*) FROM users")
JOURNALS=$(q "SELECT count(*) FROM journal_entries")
[ "$COMPANIES" -ge 1 ] || { echo "restore-drill: FAILED, no companies in restored copy" >&2; exit 1; }

SECS=$(( $(date +%s) - START ))
LINE="$(date -u +%FT%TZ) dump=$(basename "$DUMP") restore_seconds=$SECS companies=$COMPANIES users=$USERS journal_entries=$JOURNALS result=ok"
echo "$LINE" | tee -a "$LOG"
echo "restore-drill: database restored in ${SECS}s. This covers the database only; add the time to boot the app and run the smoke when you record your real RTO."

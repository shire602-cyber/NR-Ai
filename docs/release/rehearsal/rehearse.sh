#!/usr/bin/env bash
# Run from the repository root after building the release (see DEPLOY-RUNBOOK.md).
set -uo pipefail
umask 077
export LC_ALL=C

die() { echo "Rehearsal: $*" >&2; exit 1; }
matches() {
  case "$1" in *'
'*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Exq "$2"
}

# Use an explicit loopback address and port. Reject URI options and host lists.
matches "${PGURL:-}" 'postgres(ql)?://[a-zA-Z_][a-zA-Z0-9_]*@127\.0\.0\.1:[1-9][0-9]{0,4}' ||
  die "PGURL must be postgres://USER@127.0.0.1:PORT for a disposable PostgreSQL cluster"
[ "${PGURL##*:}" -le 65535 ] || die "Invalid PostgreSQL port"
matches "${REHEARSAL_CLUSTER_ID:-}" '[0-9]+' ||
  die "Set REHEARSAL_CLUSTER_ID to the system identifier obtained from the disposable cluster itself"
[ -z "${SNAPSHOT_DB+x}" ] ||
  die "Use SNAPSHOT_FILE (a custom-format dump). Existing databases cannot be rehearsal targets."
[ -f "${SNAPSHOT_FILE:-}" ] && [ -r "$SNAPSHOT_FILE" ] ||
  die "SNAPSHOT_FILE must be a readable custom-format dump"
case "$SNAPSHOT_FILE" in -*) die "Provide a path to SNAPSHOT_FILE" ;; esac
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGDATABASE PGUSER PGHOST PGPORT PGSSLMODE PGREQUIRESSL
unset PGPASSWORD PGPASSFILE REDISCLI_AUTH
export PGCONNECT_TIMEOUT=5 PGSSLMODE=disable PGGSSENCMODE=disable

HERE=$(cd "$(dirname "$0")" && pwd) || exit 1
[ -f dist/index.js ] && [ -f dist/migrate.js ] || die "Build the release first"
psqlq() { psql -X -w -q -v ON_ERROR_STOP=1 "$@"; }
verify_cluster() {
  local identity
  identity=$(psqlq "$PGURL/postgres" -Atc \
    "SELECT system_identifier FROM pg_catalog.pg_control_system()
     WHERE inet_server_addr() = '127.0.0.1' AND NOT pg_is_in_recovery()") ||
    die "Cannot verify the disposable PostgreSQL cluster"
  [ "$identity" = "$REHEARSAL_CLUSTER_ID" ] || die "Disposable PostgreSQL cluster identity mismatch"
}

OUT="${OUT:-./rehearsal-out}"
mkdir -- "$OUT" || die "OUT must be a fresh directory"
OUT=$(cd "$OUT" && pwd) || exit 1
# Disable libpq password-file lookup for this dedicated local cluster.
export PGPASSFILE="$OUT/empty.env"
: > "$PGPASSFILE" || exit 1
verify_cluster
matches "${REHEARSAL_REDIS_URL:-}" 'redis://127\.0\.0\.1:[1-9][0-9]{0,4}' ||
  die "REHEARSAL_REDIS_URL must be redis://127.0.0.1:PORT for a disposable Redis instance"
[ "${REHEARSAL_REDIS_URL##*:}" -le 65535 ] || die "Invalid Redis port"
ARCHIVE="$OUT/pre-0089.dump"
failed=0

log() { echo "$*" | tee -a "$OUT/steps.log" || die "Cannot write steps.log"; }
step() { echo; log "### $*"; }
ms() { date +%s%3N; }
gate() {
  local name=$1 rc=$2
  log "${name}_exit=$rc"
  if [ "$rc" -ne 0 ]; then
    failed=1
    return 1
  fi
}

# The operator disposes of the dedicated cluster. The driver never drops a database.
RUN_ID=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))') || exit 1
matches "$RUN_ID" '[0-9a-f]{24}' || die "Cannot generate rehearsal database names"
DB_PREFIX="nr_rehearsal_$RUN_ID"
boot_credentials=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(64).toString("hex"))') || exit 1
matches "$boot_credentials" '[0-9a-f]{128}' || die "Cannot generate disposable boot credentials"
SNAP="$PGURL/${DB_PREFIX}_snapshot"
create_db() {
  local name=$1 template=${2:-template0}
  verify_cluster
  psqlq "$PGURL/postgres" \
    -c "CREATE DATABASE ${DB_PREFIX}_$name TEMPLATE $template" \
    -c "COMMENT ON DATABASE ${DB_PREFIX}_$name IS 'Muhasib disposable release rehearsal'"
}
verify_target() {
  local identity
  identity=$(psqlq "$1" -Atc \
    "SELECT system_identifier FROM pg_catalog.pg_control_system(), pg_catalog.pg_database
      WHERE datname = current_database() AND inet_server_addr() = '127.0.0.1'
        AND NOT pg_is_in_recovery()
        AND shobj_description(oid, 'pg_database') = 'Muhasib disposable release rehearsal'") ||
    die "Cannot verify the rehearsal database"
  [ "$identity" = "$REHEARSAL_CLUSTER_ID" ] || die "Rehearsal database or cluster identity mismatch"
}
restore_db() {
  verify_target "$PGURL/${DB_PREFIX}_$1"
  pg_restore --format=custom --no-password --exit-on-error --no-owner --no-privileges --single-transaction \
    -d "$PGURL/${DB_PREFIX}_$1" "$2"
}
ledger_state() {
  psqlq -Atc "SELECT count(*), md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text)
               FROM drizzle.__drizzle_migrations m HAVING count(*) > 0" "$1"
}

# Keep dotenv and integration settings away from the checkout's environment.
app() {
  local database=$1
  shift
  verify_target "$database"
  env -i PATH="$PATH" SystemRoot="${SystemRoot:-${SYSTEMROOT:-}}" WINDIR="${WINDIR:-${windir:-}}" \
    COMSPEC="${COMSPEC:-${ComSpec:-}}" PATHEXT="${PATHEXT:-}" TEMP="${TEMP:-}" TMP="${TMP:-}" \
    npm_config_cache="$OUT/npm-cache" DOTENV_CONFIG_PATH="$OUT/empty.env" \
    DATABASE_URL="$database" REHEARSAL_DATABASE="${database##*/}" REHEARSAL_CLUSTER_ID="$REHEARSAL_CLUSTER_ID" \
    REDIS_URL="$REHEARSAL_REDIS_URL" NODE_ENV=production AUTO_MIGRATE_ON_BOOT=false LOG_LEVEL=info \
    SESSION_SECRET="${boot_credentials:0:64}" JWT_SECRET="${boot_credentials:64}" \
    "$@"
}

log "database_prefix=$DB_PREFIX"
step "0. restore the input archive into a fresh snapshot database"
pg_restore --format=custom --list "$SNAPSHOT_FILE" > "$OUT/input-archive.list" 2> "$OUT/input-archive.err"
gate input_archive "$?" || exit 1
create_db snapshot > "$OUT/snapshot-create.log" 2>&1
gate snapshot_create "$?" || exit 1
restore_db snapshot "$SNAPSHOT_FILE" > "$OUT/snapshot-restore.log" 2>&1
gate snapshot_restore "$?" || exit 1

restore_state() {
  psqlq -At -F ' ' "$1" -c "SELECT
    (SELECT count(*) FROM companies), (SELECT count(*) FROM users),
    (SELECT count(*) FROM company_users), (SELECT count(*) FROM journal_entries),
    (SELECT count(*) FROM invoices),
    (SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM drizzle.__drizzle_migrations m),
    to_regclass('public.ledger_repair_findings') IS NOT NULL"
}
restore_check() {
  local name=$1 t0 state rc
  t0=$(ms)
  create_db "$name" > "$OUT/$name.err" 2>&1 &&
    restore_db "$name" "$ARCHIVE" 2>> "$OUT/$name.err"
  rc=$?
  log "${name}_restore_ms=$(($(ms) - t0))"
  gate "$name" "$rc" || return 1
  state=$(restore_state "$PGURL/${DB_PREFIX}_$name" 2>> "$OUT/$name.err")
  gate "${name}_queries" "$?" || return 1
  log "$name counts/ledger_digest/has_0089_tables: $state"
  [ "$state" = "$source_state" ]
  gate "${name}_matches_snapshot" "$?"
}

step "1. back up the restored snapshot and verify a fresh restore"
T0=$(ms)
pg_dump --no-password "$SNAP" -Fc -f "$ARCHIVE" > "$OUT/backup.err" 2>&1
gate backup "$?" || exit 1
archive_digest=$(sha256sum "$ARCHIVE") || die "Cannot checksum the backup"
archive_size=$(stat -c %s "$ARCHIVE") || die "Cannot measure the backup"
log "dump_ms=$(($(ms) - T0)) size_bytes=$archive_size sha256=${archive_digest%% *}"
pg_restore --format=custom --list "$ARCHIVE" > "$OUT/archive.list" 2>> "$OUT/backup.err"
gate archive_list "$?" || exit 1
source_state=$(restore_state "$SNAP" 2>> "$OUT/backup.err")
gate snapshot_queries "$?" || exit 1
matches "$source_state" '([0-9]+ ){5}[0-9a-f]{32} [tf]' ||
  die "Unexpected snapshot counts or empty migration ledger"
log "snapshot counts companies/users/company_users/journal_entries/invoices, ledger digest, has_0089_tables: $source_state"
restore_check restorecheck

step "2a. pre-state counts"
psqlq -f "$HERE/pre-counts.sql" "$SNAP" > "$OUT/pre-counts.txt" 2>&1
gate pre_counts "$?" || exit 1
baseline=$(psqlq -At -F ' ' -f "$HERE/subscription-counts.sql" \
  -f - "$SNAP" 2> "$OUT/subscription-pre.err" <<'SQL'
SELECT :free_rows, :companies_without_subscription;
SQL
)
gate subscription_pre "$?" || exit 1
matches "$baseline" '[0-9]+ [0-9]+' || die "Invalid pre-migration subscription counts"
pre_free=${baseline%% *}
pre_missing=${baseline#* }

step "2. per-file timing on a clone (one transaction per file)"
timing="$PGURL/${DB_PREFIX}_timing"
create_db timing "${DB_PREFIX}_snapshot" > "$OUT/timing-clone.log" 2>&1
if gate timing_clone "$?"; then
  app "$timing" node "$HERE/time-migrations.mjs" --json "$OUT/per-file.json" > "$OUT/per-file.txt" 2>&1
  gate per_file "$?"
fi

step "2. migrate the restored snapshot with npm run db:migrate"
T0=$(ms)
app "$SNAP" npm run --silent db:migrate > "$OUT/db-migrate.log" 2>&1
migrate_rc=$?
log "db_migrate_ms=$(($(ms) - T0))"
gate db_migrate "$migrate_rc"

dump_schema() {
  # Supported pg_dump versions generate random restrict keys.
  pg_dump --no-password -s "$1" |
    sed -e '/^--/d' -e '/^$/d' -e '/^\\restrict /d' -e '/^\\unrestrict /d' > "$2" &&
    [ -s "$2" ]
}
if [ "$migrate_rc" -eq 0 ]; then
  step "2. compare the migration paths"
  migrated_ledger=$(ledger_state "$SNAP" 2> "$OUT/migration-ledger.err")
  gate migrated_ledger "$?"
  timing_ledger=$(ledger_state "$timing" 2>> "$OUT/migration-ledger.err")
  gate timing_ledger "$?"
  matches "$migrated_ledger" '[1-9][0-9]*\|[0-9a-f]{32}' &&
    [ "$migrated_ledger" = "$timing_ledger" ]
  gate migration_ledgers_match "$?"
  dump_schema "$SNAP" "$OUT/schema-snapshot.sql" 2> "$OUT/schema-snapshot.err"
  snapshot_schema_rc=$?
  gate schema_snapshot "$snapshot_schema_rc"
  dump_schema "$timing" "$OUT/schema-timing.sql" 2> "$OUT/schema-timing.err"
  timing_schema_rc=$?
  gate schema_timing "$timing_schema_rc"
  if [ "$snapshot_schema_rc" -eq 0 ] && [ "$timing_schema_rc" -eq 0 ]; then
    diff -u "$OUT/schema-snapshot.sql" "$OUT/schema-timing.sql" > "$OUT/schema.diff" 2> "$OUT/schema-diff.err"
    gate schema_diff "$?"
  fi

  step "2b/2d. post-state counts and required checks"
  psqlq -v pre_free="$pre_free" -v pre_missing="$pre_missing" -f "$HERE/post-counts.sql" "$SNAP" \
    > "$OUT/post-counts.txt" 2>&1
  gate post_checks "$?"

  step "2c. read-only QA scripts"
  qa() {
    local name=$1 output=$2
    shift 2
    # stdout is the findings file; stderr (including the finding summary) goes beside it so a
    # --json file stays parseable.
    app "$SNAP" "$@" --fail-on-findings > "$OUT/$output" 2> "$OUT/$output.err"
    qa_rc=$?
    if [ "$qa_rc" -ne 0 ]; then
      log "${name}_findings_file=$OUT/$output (stderr: $OUT/$output.err; exit 1 = findings, 2 = usage)"
    fi
    gate "$name" "$qa_rc"
  }
  qa closing findings-closing.json node scripts/qa/find-bad-closing-entries.mjs --json
  qa rates findings-rates.txt node scripts/qa/find-inverted-rates.mjs
  qa sales findings-sales.txt node scripts/qa/find-sales-ledger-drift.mjs
  qa purchases findings-purchases.txt node scripts/qa/find-purchases-ledger-drift.mjs
  qa payments findings-payment-accounts.json node --import tsx scripts/qa/repair-misposted-payments.ts --json
  psqlq -f scripts/qa/find-header-posting-accounts.sql "$SNAP" > "$OUT/post-header-posting.txt" 2>&1
  gate post_header_posting "$?"

  step "idempotency: second db:migrate and candidate files in journal order"
  before=$(ledger_state "$SNAP" 2> "$OUT/idempotency.err")
  gate ledger_before "$?"
  app "$SNAP" npm run --silent db:migrate > "$OUT/db-migrate-2.log" 2>&1
  gate second_migrate "$?"
  after=$(ledger_state "$SNAP" 2>> "$OUT/idempotency.err")
  gate ledger_after "$?"
  log "ledger_before=$before ledger_after=$after"
  matches "$before" '[1-9][0-9]*\|[0-9a-f]{32}' && [ "$before" = "$after" ]
  gate ledger_noop "$?"

  create_db rerun "${DB_PREFIX}_snapshot" > "$OUT/rerun-clone.log" 2>&1
  clone_rc=$?
  gate rerun_clone "$clone_rc"
  candidates=$(node "$HERE/time-migrations.mjs" --list-candidates 2> "$OUT/rerun-list.err")
  list_rc=$?
  gate rerun_list "$list_rc"
  if [ "$clone_rc" -eq 0 ] && [ "$list_rc" -eq 0 ]; then
    rerun_candidates() {
      local f expected executed=0 listed t0
      : > "$OUT/rerun.txt" && : > "$OUT/rerun.err" || return 1
      [ -n "$candidates" ] || return 1
      printf '%s\n' "$candidates" > "$OUT/rerun-files.txt" || return 1
      listed=$(cat "$OUT/rerun-files.txt") || return 1
      [ "$listed" = "$candidates" ] || return 1
      verify_target "$PGURL/${DB_PREFIX}_rerun"
      expected=$(printf '%s\n' "$candidates" | wc -l) || return 1
      while IFS= read -r f; do
        matches "$f" 'migrations/[0-9]{4}_[a-z0-9_]+\.sql' || return 1
        t0=$(ms)
        printf '\n### %s\n' "$f" >&2 || return 1
        psqlq --single-transaction -f "$f" "$PGURL/${DB_PREFIX}_rerun" > /dev/null || return 1
        printf '%s rerun_ok %sms\n' "$f" "$(($(ms) - t0))" >> "$OUT/rerun.txt" || return 1
        executed=$((executed + 1))
      done 2>> "$OUT/rerun.err" < "$OUT/rerun-files.txt" || return 1
      log "rerun_ok_files=$executed expected=$expected"
      [ "$expected" -gt 0 ] && [ "$executed" -eq "$expected" ]
    }
    rerun_candidates
    gate rerun "$?"
  fi
fi

step "7. rollback: restore the pre-migration backup into a fresh database"
restore_check rollback

step "2. release schema guard and boot readiness"
if [ "$migrate_rc" -eq 0 ]; then
  app "$SNAP" node dist/migrate.js > "$OUT/release-migrate.log" 2>&1
  if gate release_migrate "$?"; then
    node "$HERE/check-release-log.mjs" "$OUT/release-migrate.log" > "$OUT/schema-guard.log" 2>&1
    if gate schema_guard "$?"; then
      redis_ping=$(timeout 5 redis-cli -h 127.0.0.1 -p "${REHEARSAL_REDIS_URL##*:}" --raw PING 2> "$OUT/redis.err")
      redis_rc=$?
      if [ "$redis_rc" -eq 0 ] && [ "$redis_ping" != "PONG" ]; then redis_rc=1; fi
      if gate redis "$redis_rc"; then
        app "$SNAP" node "$HERE/boot-check.mjs" > "$OUT/boot.log" 2>&1
        gate boot "$?"
      fi
    fi
  fi
fi

if [ "$failed" -ne 0 ]; then
  log "FAILED: results in $OUT"
  exit 1
fi
log "done: results in $OUT"

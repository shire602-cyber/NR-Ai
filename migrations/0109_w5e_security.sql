-- 0109_w5e_security (W5-E): MFA (TOTP + recovery codes), email verification timestamps,
-- per-company security policy, and a tamper-evident (hash-chained) audit log.
-- Idempotent: every statement can run twice.

-- ── users: MFA + email verification columns ──────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret_enc" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_pending_secret_enc" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enrolled_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_last_used_step" integer;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;

-- ── recovery codes: ten single-use codes, stored as SHA-256 digests ──────────────────────
CREATE TABLE IF NOT EXISTS "user_mfa_recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_user_mfa_recovery_codes_user" ON "user_mfa_recovery_codes" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_mfa_recovery_codes_hash"
  ON "user_mfa_recovery_codes" ("user_id", "code_hash");

-- ── per-company security policy ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_security_policies" (
  "company_id" uuid PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "require_mfa" text NOT NULL DEFAULT 'none',
  "updated_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_security_policies_require_mfa_check"
    CHECK ("require_mfa" IN ('none', 'owners_admins', 'all'))
);

-- ── audit_logs: per-company hash chain ───────────────────────────────────────────────────
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "company_id" uuid;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "chain_key" text;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "seq" bigint;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "prev_hash" text;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash" text;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "legacy" boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "idx_audit_logs_company_created" ON "audit_logs" ("company_id", "created_at");

-- companyId from a details JSON text, or NULL when absent/invalid.
CREATE OR REPLACE FUNCTION audit_try_company_id(v text) RETURNS uuid
  LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF v IS NULL OR left(ltrim(v), 1) <> '{' THEN RETURN NULL; END IF;
  RETURN (v::jsonb ->> 'companyId')::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$fn$;

-- Canonical row content. Each field is length-prefixed (octets) so no separator can be
-- forged; NULL is "-1:". server/services/audit-chain.service.ts re-implements this in
-- Node to verify the chain independently of this function.
CREATE OR REPLACE FUNCTION audit_log_field(v text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN v IS NULL THEN '-1:' ELSE octet_length(v)::text || ':' || v END
$fn$;

CREATE OR REPLACE FUNCTION audit_log_hash(
  p_chain_key text, p_seq bigint, p_id uuid, p_user_id uuid, p_action text,
  p_resource_type text, p_resource_id text, p_details text, p_ip text, p_ua text,
  p_created_at timestamp, p_prev_hash text
) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT encode(sha256(convert_to(
    audit_log_field(p_chain_key) || '|' ||
    audit_log_field(p_seq::text) || '|' ||
    audit_log_field(p_id::text) || '|' ||
    audit_log_field(p_user_id::text) || '|' ||
    audit_log_field(p_action) || '|' ||
    audit_log_field(p_resource_type) || '|' ||
    audit_log_field(p_resource_id) || '|' ||
    audit_log_field(p_details) || '|' ||
    audit_log_field(p_ip) || '|' ||
    audit_log_field(p_ua) || '|' ||
    audit_log_field(((extract(epoch from p_created_at) * 1000)::bigint)::text) || '|' ||
    audit_log_field(p_prev_hash),
  'UTF8')), 'hex')
$fn$;

-- Legacy rows: chain them in (created_at, id) order and mark them legacy. Runs once:
-- only rows without a hash are touched.
DO $$
DECLARE
  r record;
  v_key text;
  v_prev_key text := NULL;
  v_seq bigint := 0;
  v_prev text := repeat('0', 64);
  v_hash text;
BEGIN
  IF EXISTS (SELECT 1 FROM "audit_logs" WHERE "hash" IS NULL) THEN
    UPDATE "audit_logs" SET "company_id" = audit_try_company_id("details")
     WHERE "company_id" IS NULL AND "hash" IS NULL;
    UPDATE "audit_logs" SET "chain_key" = COALESCE("company_id"::text, 'global')
     WHERE "hash" IS NULL;
    FOR r IN
      SELECT * FROM "audit_logs" WHERE "hash" IS NULL ORDER BY "chain_key", "created_at", "id"
    LOOP
      v_key := r."chain_key";
      IF v_prev_key IS DISTINCT FROM v_key THEN
        SELECT COALESCE(max("seq"), 0) INTO v_seq FROM "audit_logs"
         WHERE "chain_key" = v_key AND "hash" IS NOT NULL;
        SELECT COALESCE((SELECT "hash" FROM "audit_logs"
                          WHERE "chain_key" = v_key AND "hash" IS NOT NULL
                          ORDER BY "seq" DESC LIMIT 1), repeat('0', 64)) INTO v_prev;
        v_prev_key := v_key;
      END IF;
      v_seq := v_seq + 1;
      v_hash := audit_log_hash(v_key, v_seq, r."id", r."user_id", r."action", r."resource_type",
        r."resource_id", r."details", r."ip_address", r."user_agent", r."created_at", v_prev);
      UPDATE "audit_logs" SET "seq" = v_seq, "prev_hash" = v_prev, "hash" = v_hash, "legacy" = true
       WHERE "id" = r."id";
      v_prev := v_hash;
    END LOOP;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_audit_logs_chain_seq" ON "audit_logs" ("chain_key", "seq");

-- New rows: chained in the inserting transaction under a per-chain advisory lock, so
-- concurrent inserts (from any writer: storage, the ledger kernel, raw SQL) form one
-- unbroken chain.
CREATE OR REPLACE FUNCTION audit_logs_chain_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_key text;
  v_prev_seq bigint;
  v_prev_hash text;
BEGIN
  IF NEW."company_id" IS NULL THEN
    NEW."company_id" := audit_try_company_id(NEW."details");
  END IF;
  v_key := COALESCE(NEW."company_id"::text, 'global');
  NEW."chain_key" := v_key;
  NEW."created_at" := date_trunc('milliseconds', COALESCE(NEW."created_at", now()::timestamp));
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_logs_chain:' || v_key, 0));
  SELECT "seq", "hash" INTO v_prev_seq, v_prev_hash FROM "audit_logs"
   WHERE "chain_key" = v_key ORDER BY "seq" DESC LIMIT 1;
  NEW."seq" := COALESCE(v_prev_seq, 0) + 1;
  NEW."prev_hash" := COALESCE(v_prev_hash, repeat('0', 64));
  NEW."legacy" := false;
  NEW."hash" := audit_log_hash(v_key, NEW."seq", NEW."id", NEW."user_id", NEW."action",
    NEW."resource_type", NEW."resource_id", NEW."details", NEW."ip_address", NEW."user_agent",
    NEW."created_at", NEW."prev_hash");
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "audit_logs_chain_insert" ON "audit_logs";
CREATE TRIGGER "audit_logs_chain_insert" BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain_insert();

-- Append-only: UPDATE/DELETE are refused unless a maintenance session explicitly sets
-- muhasib.audit_maintenance = 'on' (SET LOCAL inside a reviewed transaction). Any such
-- change still breaks the hash chain and is reported by the verify endpoint.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF COALESCE(current_setting('muhasib.audit_maintenance', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END
$fn$;

DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

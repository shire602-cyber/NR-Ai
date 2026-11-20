-- 0092_w2c_identity: identity, sessions, company roles and invitations; owned by workstream W2-C.
-- Idempotent: every statement is safe to re-run. Do not edit meta/_journal.json.

-- (a) R01-06/R01-13: token version + password change timestamp ------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;

-- (b) Findings recorded by this migration for an operator to review --------
CREATE TABLE IF NOT EXISTS "identity_migration_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "detail" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- (c) R01-05: case-insensitive unique emails ------------------------------
-- Lower-case every email whose lower-cased form is unique, record groups of
-- accounts that only differ by case, and build the unique index on
-- lower(email) only when no such group remains. The application lower-cases
-- and compares case-insensitively either way, so new duplicates are blocked
-- even while the index is skipped.
DO $$
DECLARE
  dup_groups integer;
BEGIN
  UPDATE "users" u
     SET "email" = lower(trim(u."email"))
   WHERE u."email" <> lower(trim(u."email"))
     AND NOT EXISTS (
       SELECT 1 FROM "users" o
        WHERE o."id" <> u."id" AND lower(trim(o."email")) = lower(trim(u."email"))
     );

  SELECT count(*) INTO dup_groups FROM (
    SELECT lower(trim("email")) FROM "users" GROUP BY 1 HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    INSERT INTO "identity_migration_findings" ("kind", "detail")
    SELECT 'case_duplicate_email',
           jsonb_build_object('email', g.e, 'userIds', g.ids)
      FROM (
        SELECT lower(trim("email")) AS e, jsonb_agg("id" ORDER BY "created_at") AS ids
          FROM "users" GROUP BY 1 HAVING count(*) > 1
      ) g
     WHERE NOT EXISTS (
       SELECT 1 FROM "identity_migration_findings" f
        WHERE f."kind" = 'case_duplicate_email' AND f."detail"->>'email' = g.e
     );
    RAISE NOTICE '0092: % case-duplicate email group(s) recorded in identity_migration_findings; skipping users_email_lower_unique', dup_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_unique" ON "users" (lower("email"));
  END IF;
END $$;

-- (d) R01-02/R01-03/R01-14: company role enum ------------------------------
UPDATE "company_users"
   SET "role" = CASE
     WHEN lower(trim("role")) IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer')
       THEN lower(trim("role"))
     WHEN lower(trim("role")) IN ('cfo','manager') THEN 'admin'
     WHEN lower(trim("role")) IN ('readonly','read_only','read-only') THEN 'viewer'
     ELSE 'employee'
   END
 WHERE "role" NOT IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_users_role_check') THEN
    ALTER TABLE "company_users" ADD CONSTRAINT "company_users_role_check"
      CHECK ("role" IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer'));
  END IF;
END $$;

-- (e) R01-04/R01-15: company team invitations ------------------------------
CREATE TABLE IF NOT EXISTS "company_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'employee',
  "token_hash" text NOT NULL UNIQUE,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "accepted_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamp,
  "last_sent_at" timestamp,
  "send_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_company_invitations_company"
  ON "company_invitations" ("company_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "company_invitations_pending_email_unique"
  ON "company_invitations" ("company_id", lower("email")) WHERE "status" = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_role_check') THEN
    ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_role_check"
      CHECK ("role" IN ('owner','admin','accountant','bookkeeper','approver','employee','viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_status_check') THEN
    ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_status_check"
      CHECK ("status" IN ('pending','accepted','revoked','expired'));
  END IF;
END $$;

-- (f) R01-04: convert placeholder users (empty password hash, created by the
-- old /team/invite) into pending invitations. The new token is random and
-- never shown, so the inviter resends to obtain a working link. Placeholder
-- memberships are removed; the placeholder user row is deleted when nothing
-- else references it, otherwise it keeps an unusable marker hash and the
-- registration flow lets the real owner of the address claim it.
INSERT INTO "company_invitations" ("company_id", "email", "role", "token_hash", "invited_by", "status", "expires_at")
SELECT cu."company_id",
       lower(trim(u."email")),
       cu."role",
       md5(random()::text || clock_timestamp()::text || cu."id"::text) || md5(cu."id"::text || random()::text),
       (SELECT o."user_id" FROM "company_users" o
         WHERE o."company_id" = cu."company_id" AND o."role" = 'owner' AND o."user_id" <> u."id"
         ORDER BY o."created_at" LIMIT 1),
       'pending',
       now() + interval '7 days'
  FROM "company_users" cu
  JOIN "users" u ON u."id" = cu."user_id"
 WHERE u."password_hash" = ''
   AND NOT EXISTS (
     SELECT 1 FROM "company_invitations" ci
      WHERE ci."company_id" = cu."company_id" AND lower(ci."email") = lower(trim(u."email"))
        AND ci."status" = 'pending'
   );

DELETE FROM "company_users" cu
 USING "users" u
 WHERE u."id" = cu."user_id" AND u."password_hash" = '';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT "id", "email" FROM "users" WHERE "password_hash" = '' LOOP
    BEGIN
      DELETE FROM "users" WHERE "id" = r."id";
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE "users" SET "password_hash" = '$placeholder$' || gen_random_uuid()::text
       WHERE "id" = r."id";
      INSERT INTO "identity_migration_findings" ("kind", "detail")
      VALUES ('placeholder_user_kept', jsonb_build_object('userId', r."id", 'email', r."email"));
    END;
  END LOOP;
END $$;

-- Preview migration timestamps overlapped the original firm provenance entries.
DO $preview$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'company_users'::regclass
      AND tgname = 'clear_removed_firm_membership_provenance'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $provenance$
-- 0141_firm_membership_provenance (W5-D): Idempotent firm grant membership provenance.
-- A legacy grant's boolean cannot distinguish the original row from an independent replacement.
-- Leave those IDs unset so an offboarding operation cannot take ownership of an unverified row.
ALTER TABLE "firm_company_grants" ADD COLUMN IF NOT EXISTS "membership_id" uuid
  REFERENCES "company_users" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_firm_company_grants_membership"
  ON "firm_company_grants" ("membership_id");

-- 0142_recover_firm_membership_provenance (W5-D): Idempotent recovery of recorded firm grants.
-- The transactional grant writer gave the membership and its grant the same PostgreSQL `now()`.
-- Older writes with differing timestamps cannot distinguish reassignment from a direct replacement.
-- Migration 0108 used the seeded NR firm's timestamp for its blanket grants, including direct ones.
UPDATE "firm_company_grants" AS grant_row
   SET "membership_id" = membership."id"
  FROM "company_users" AS membership, "firms" AS firm
 WHERE grant_row."membership_id" IS NULL
   AND grant_row."created_membership"
   AND firm."id" = grant_row."firm_id"
   AND membership."company_id" = grant_row."company_id"
   AND membership."user_id" = grant_row."user_id"
   AND membership."role" <> 'owner'
   AND membership."created_at" = grant_row."created_at"
   AND NOT (firm."is_nr" AND grant_row."created_at" = firm."created_at");

-- 0143_preserve_firm_grant_review (W5-D): Idempotent handling of known membership removal.
-- The FK clears membership_id on deletion. Clear the provenance flag first for that exact row,
-- so a known removal is distinguishable from a historical grant that never had a row ID.
CREATE OR REPLACE FUNCTION clear_removed_firm_membership_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE firm_company_grants SET created_membership = false WHERE membership_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS clear_removed_firm_membership_provenance ON company_users;
CREATE TRIGGER clear_removed_firm_membership_provenance BEFORE DELETE ON company_users
FOR EACH ROW EXECUTE FUNCTION clear_removed_firm_membership_provenance();
$provenance$;
  END IF;
END
$preview$;

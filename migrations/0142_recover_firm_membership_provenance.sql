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

-- 0141_firm_membership_provenance (W5-D): Idempotent firm grant membership provenance.
-- A legacy grant's boolean cannot distinguish the original row from an independent replacement.
-- Leave those IDs unset so an offboarding operation cannot take ownership of an unverified row.
ALTER TABLE "firm_company_grants" ADD COLUMN IF NOT EXISTS "membership_id" uuid
  REFERENCES "company_users" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_firm_company_grants_membership"
  ON "firm_company_grants" ("membership_id");

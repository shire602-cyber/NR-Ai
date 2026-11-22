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

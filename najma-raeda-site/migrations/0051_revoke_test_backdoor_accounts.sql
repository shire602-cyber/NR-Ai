-- Revoke the two test/backdoor firm_owner accounts that earlier migrations
-- (0023_seed_test_firm_owner.sql, 0024_fix_test_firm_owner_role.sql,
-- 0028_fix_test_credentials.sql) seeded into every environment running
-- migrations on boot. The cleartext passwords for these accounts were
-- committed in tests/test-firm-endpoints.sh and the firm_role='firm_owner'
-- flag bypasses per-company RBAC checks (server/middleware/rbac.ts), making
-- this a full cross-tenant compromise vector.
--
-- We intentionally do NOT hard-delete the user rows: they may be referenced
-- by audit_logs / activity_logs / journal_entries, and FTA mandates 5-year
-- retention of financial records. Instead we:
--   1. Replace password_hash with a non-bcrypt sentinel — bcrypt.compare()
--      returns false on malformed hash (verified against bcryptjs), so login
--      becomes impossible without a separate password reset flow.
--   2. Drop firm_role to NULL — disables the RBAC bypass even if the row is
--      ever re-enabled.
--   3. Force is_admin = false — defensive.
--   4. Delete the user-company associations so even if login were somehow
--      restored, the accounts would have no company-scoped access.
--
-- After this migration runs, OPERATORS MUST ALSO:
--   - Rotate JWT_SECRET in any environment that ever ran migrations 0023/0028
--     (existing tokens issued to these accounts remain valid until expiry).
--   - Query audit_logs and users.last_login_at for these emails to determine
--     whether the backdoor was ever used.

UPDATE users
SET password_hash = '$revoked$' || gen_random_uuid()::text,
    firm_role = NULL,
    is_admin = false
WHERE email IN ('nra.test.owner@testmail.com', 'test_firm_owner@nra.ae');

DELETE FROM company_users
WHERE user_id IN (
  SELECT id FROM users
  WHERE email IN ('nra.test.owner@testmail.com', 'test_firm_owner@nra.ae')
);

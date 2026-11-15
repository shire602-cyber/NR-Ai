-- ============================================================================
-- DRAFT / PROPOSAL — NOT auto-run. (Lives in docs/, outside migrations/, so the
-- Drizzle migrator never executes it.)  Addresses audit finding S-H3.
-- ============================================================================
--
-- PROBLEM
--   migrations/0054_promote_shire602_firm_owner.sql promotes a single hardcoded
--   personal account (shire602@gmail.com) to all-tenant superuser
--   (is_admin=true, user_type='admin', firm_role='firm_owner') in EVERY
--   environment that runs the migration chain — staging, test, demo, and any
--   third-party deployment of this codebase, not just the owner's production.
--   A privileged account baked into version control is a standing risk.
--
-- INTENT
--   Neutralise that baked-in promotion everywhere it should NOT apply, WITHOUT
--   stripping the owner's access in their own production (where this is the
--   legitimate owner account).
--
-- ⚠️  LOCK-OUT RISK: do NOT run this in the owner's production database. If you
--    run it there you remove your own admin access and must restore it through
--    a separate admin-management step. Run it only in environments where
--    shire602@gmail.com must NOT be an admin (staging/test/demo/forks).
--
-- RECOMMENDED LONG-TERM FIX (instead of relying on a committed migration):
--   1. Apply this revoke in all non-owner-production environments.
--   2. In the owner's production, grant admin through your normal
--      admin-management flow / an environment-scoped one-time seed — NOT via a
--      committed migration that ships to every deployment.
--   3. Treat migration 0054 as historical; do not replicate the pattern.
--
-- TO APPLY DELIBERATELY (manual, per-environment):
--   psql "$DATABASE_URL" -f docs/proposed-migrations/revoke-shire602-admin.sql
-- (Or, if you decide to make it part of the chain, move it into migrations/
--  with the next sequence number AND register it in migrations/meta/_journal.json.)
-- ----------------------------------------------------------------------------

UPDATE users
SET
  is_admin = false,
  user_type = 'customer',
  firm_role = NULL
WHERE lower(email) = 'shire602@gmail.com';

-- Optional, defensive: also drop any firm-level company assignments this
-- account picked up via the firm_owner role. Uncomment if desired.
-- DELETE FROM company_users
-- WHERE user_id IN (SELECT id FROM users WHERE lower(email) = 'shire602@gmail.com');

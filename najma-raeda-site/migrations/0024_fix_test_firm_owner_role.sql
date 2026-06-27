-- Fix: set firm_role = 'firm_owner' for the NRA test user.
-- The user was created via the register endpoint (migration 0023 DO block failed to run).
-- Idempotent: UPDATE is a no-op if already set.

UPDATE users
SET firm_role = 'firm_owner'
WHERE email = 'nra.test.owner@testmail.com';

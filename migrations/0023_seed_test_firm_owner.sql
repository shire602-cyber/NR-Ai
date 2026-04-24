-- One-time seed: create NRA test firm_owner user for endpoint testing.
-- Idempotent: all inserts use ON CONFLICT DO NOTHING; UPDATE is safe to re-run.

DO $$
DECLARE
  v_user_id  uuid;
  v_co_id    uuid;
BEGIN
  -- ── 1. Upsert the test user ───────────────────────────────────────────────
  INSERT INTO users (email, name, password_hash, is_admin, user_type, firm_role)
  VALUES (
    'nra.test.owner@testmail.com',
    'NRA Test Owner',
    '$2b$10$17KhNf4OVbKwuWeBLcJop.aECfiBQzfd2XVmAfIZ3AvYLgvhv59ea',
    false,
    'customer',
    'firm_owner'
  )
  ON CONFLICT (email) DO UPDATE
    SET firm_role = 'firm_owner'
  RETURNING id INTO v_user_id;

  -- If already existed, fetch the id
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM users WHERE email = 'nra.test.owner@testmail.com';
    -- Make sure firm_role is set even if the DO UPDATE path didn't fire
    UPDATE users SET firm_role = 'firm_owner' WHERE id = v_user_id;
  END IF;

  -- ── 2. Ensure the user has at least one company ───────────────────────────
  SELECT cu.company_id INTO v_co_id
  FROM company_users cu
  WHERE cu.user_id = v_user_id
  LIMIT 1;

  IF v_co_id IS NULL THEN
    INSERT INTO companies (name, base_currency, locale, company_type)
    VALUES ('NRA Test Firm', 'AED', 'en', 'customer')
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_co_id;

    INSERT INTO company_users (company_id, user_id, role)
    VALUES (v_co_id, v_user_id, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;

END $$;

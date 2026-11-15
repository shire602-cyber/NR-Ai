-- Fix test user credentials for production endpoint testing.
-- Ensures test_firm_owner@nra.ae exists with known password TestFirmOwner123!
-- and has firm_owner role with access to a test company.

-- Upsert the test firm owner user
INSERT INTO users (email, name, password_hash, is_admin, user_type, firm_role)
VALUES (
  'test_firm_owner@nra.ae',
  'Test Firm Owner',
  '$2b$10$1vXzRdibZKs7X1bF3hLHveIJW/E3RySW8KzE2SR0218tJh/O.zHUm',
  false,
  'customer',
  'firm_owner'
)
ON CONFLICT (email) DO UPDATE
  SET password_hash = '$2b$10$1vXzRdibZKs7X1bF3hLHveIJW/E3RySW8KzE2SR0218tJh/O.zHUm',
      firm_role = 'firm_owner';

-- Ensure a test company exists
INSERT INTO companies (name, base_currency, locale, company_type)
VALUES ('NRA Test Company', 'AED', 'en', 'customer')
ON CONFLICT (name) DO NOTHING;

-- Associate user with company
INSERT INTO company_users (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c
CROSS JOIN users u
WHERE c.name = 'NRA Test Company'
  AND u.email = 'test_firm_owner@nra.ae'
  AND NOT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.company_id = c.id AND cu.user_id = u.id
  );

-- Ensure a free subscription exists for the test company
INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start, current_period_end)
SELECT c.id, 'free', 'Free', 'active', now(), now() + interval '100 years'
FROM companies c
WHERE c.name = 'NRA Test Company'
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.company_id = c.id
  );

-- Idempotent seed: create NRA test firm_owner user for endpoint testing.
-- Rewritten without PL/pgSQL DO block for Drizzle migrator compatibility.

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
  SET firm_role = 'firm_owner';

INSERT INTO companies (name, base_currency, locale, company_type)
VALUES ('NRA Test Firm', 'AED', 'en', 'customer')
ON CONFLICT (name) DO NOTHING;

INSERT INTO company_users (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c
CROSS JOIN users u
WHERE c.name = 'NRA Test Firm'
  AND u.email = 'nra.test.owner@testmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.company_id = c.id AND cu.user_id = u.id
  );

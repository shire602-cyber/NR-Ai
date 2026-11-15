-- One-time owner access repair requested for the existing production account.
-- This does not create a user and does not set password material.
UPDATE users
SET
  is_admin = true,
  user_type = 'admin',
  firm_role = 'firm_owner',
  email_verified = true
WHERE lower(email) = 'shire602@gmail.com';

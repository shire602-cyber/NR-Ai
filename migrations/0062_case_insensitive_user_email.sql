-- Enforce account identity by case-insensitive email.
--
-- The app now lowercases newly-created user emails and performs lookups with
-- lower(email). This index closes the concurrent-signup gap and keeps OAuth
-- email linking deterministic.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY lower(trim(email))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Case-insensitive duplicate users.email values exist; merge or rename duplicate accounts before applying users_email_lower_unique';
  END IF;
END $$;

UPDATE users
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email));

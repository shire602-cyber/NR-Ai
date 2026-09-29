-- 0093_user_is_active: a real active flag on users.
-- Deactivation was expressed by prefixing the password hash, which a password
-- reset overwrote, silently re-enabling the account. Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Convert any account deactivated with the old marker and restore its hash.
UPDATE users
   SET is_active = false,
       password_hash = substr(password_hash, 14)
 WHERE password_hash LIKE '!deactivated!%';

-- Client-portal users could read every document of their company, including
-- files the firm uploaded for internal use. Sharing is now explicit. Documents
-- a portal user uploaded themselves stay visible to the portal.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_with_portal boolean NOT NULL DEFAULT false;

UPDATE documents d
   SET shared_with_portal = true
  FROM users u
 WHERE d.uploaded_by = u.id
   AND u.user_type = 'client_portal'
   AND d.shared_with_portal = false;

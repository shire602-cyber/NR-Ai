-- 0139_bind_portal_invite_and_verification_lifecycle (S5) binds verification to an email and closes invalid invitations.
-- Idempotent. Unbound verification and reset links cannot be carried forward safely.
ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS email text;
DELETE FROM email_verification_tokens WHERE email IS NULL;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS email text;
DELETE FROM password_reset_tokens WHERE email IS NULL;

-- Pending Microsoft callbacks with an email claim but no provider mailbox proof.
CREATE TABLE IF NOT EXISTS oauth_mailbox_challenges (
  challenge_hash text PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  issuer text NOT NULL,
  provider_subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  next_path text NOT NULL,
  expected_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oauth_mailbox_challenges_expires_at
  ON oauth_mailbox_challenges (expires_at);

CREATE OR REPLACE FUNCTION revoke_portal_invitations_after_contact_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE customer_portal_invitations
  SET status = 'revoked', revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
  WHERE contact_id = NEW.id AND company_id = NEW.company_id AND status IN ('pending', 'expired');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER customer_contacts_revoke_portal_invitations
AFTER UPDATE OF email, is_active ON customer_contacts
FOR EACH ROW WHEN (
  lower(btrim(coalesce(OLD.email, ''))) IS DISTINCT FROM lower(btrim(coalesce(NEW.email, '')))
  OR (OLD.is_active AND NOT NEW.is_active)
)
EXECUTE FUNCTION revoke_portal_invitations_after_contact_change();

CREATE OR REPLACE FUNCTION revoke_portal_invitation_after_delivery_failure()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE customer_portal_invitations
  SET status = 'revoked', revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
  WHERE id = NEW.related_entity_id AND last_outbox_id = NEW.id AND status = 'pending'
    AND expires_at > (now() AT TIME ZONE 'UTC');
  NEW.html := NULL;
  NEW.text_body := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER email_outbox_revoke_failed_portal_invitation
BEFORE UPDATE OF status ON email_outbox
FOR EACH ROW WHEN (
  NEW.category = 'portal_invite'
  AND NEW.status IN ('dead', 'bounced', 'complained', 'cancelled')
  AND OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION revoke_portal_invitation_after_delivery_failure();

-- Reconcile stale reservations that were created before these rules were enforced.
UPDATE customer_portal_invitations AS invite
SET status = 'revoked', revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
FROM customer_contacts AS contact
WHERE contact.id = invite.contact_id AND contact.company_id = invite.company_id
  AND invite.status IN ('pending', 'expired')
  AND (NOT contact.is_active OR nullif(lower(btrim(contact.email)), '') IS DISTINCT FROM invite.contact_email_at_issue);

UPDATE customer_portal_invitations AS invite
SET status = 'revoked', revoked_at = now() AT TIME ZONE 'UTC', updated_at = now() AT TIME ZONE 'UTC'
WHERE invite.status = 'pending' AND invite.expires_at > (now() AT TIME ZONE 'UTC') AND NOT EXISTS (
  SELECT 1 FROM email_outbox AS mail
  WHERE mail.id = invite.last_outbox_id AND mail.status NOT IN ('dead', 'bounced', 'complained', 'cancelled')
);

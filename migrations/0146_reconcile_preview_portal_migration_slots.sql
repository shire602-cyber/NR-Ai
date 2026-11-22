-- Apply the release portal migrations if a preview ledger occupied their timestamps.
DO $preview$
BEGIN
  IF to_regclass('public.oauth_mailbox_challenges') IS NULL THEN
    EXECUTE $portal$
-- 0138_secure_portal_invitations (S5) revokes legacy customer links and prepares the new flow.
-- Idempotent. Only the first application revokes existing invitations and clears old emails.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'customer_portal_invitations'::regclass
      AND attname = 'contact_email_at_issue' AND NOT attisdropped
  ) THEN
    ALTER TABLE customer_portal_invitations ADD COLUMN IF NOT EXISTS contact_email_at_issue text;

    -- Older links could be copied by the inviter or written to HTTP logs.
    UPDATE customer_portal_invitations
    SET status = 'revoked', revoked_at = now(), updated_at = now()
    WHERE status IN ('pending', 'expired');

    UPDATE email_delivery_events AS event
    SET detail = NULL
    FROM email_outbox AS message
    WHERE event.outbox_id = message.id AND message.category = 'portal_invite';

    UPDATE email_outbox
    SET html = NULL, text_body = NULL, last_error = NULL, updated_at = now(),
        status = CASE
          WHEN status IN ('queued', 'retrying', 'sending', 'blocked_no_provider', 'dead') THEN 'cancelled'
          ELSE status
        END
    WHERE category = 'portal_invite';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_portal_invitations_pending_email
ON customer_portal_invitations (lower(email), expires_at) WHERE status = 'pending';

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

$portal$;
  END IF;
END
$preview$;

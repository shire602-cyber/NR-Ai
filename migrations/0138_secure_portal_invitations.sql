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

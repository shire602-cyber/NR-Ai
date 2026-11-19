-- 0136_step5_portal_invitations (STEP5 S5): customer portal invitations (hashed single-use token, 7 days)
-- and portal-account bookkeeping. Idempotent: CREATE ... IF NOT EXISTS, guarded constraints and a
-- DELETE that removes only the company memberships of client_portal users (portal customers are never
-- company members; portal access comes only from customer_portal_accounts).
CREATE TABLE IF NOT EXISTS "customer_portal_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "name" text,
  "language" text NOT NULL DEFAULT 'en',
  "message" text,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamp NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "last_sent_at" timestamp,
  "send_count" integer NOT NULL DEFAULT 0,
  "last_outbox_id" uuid,
  "accepted_at" timestamp,
  "accepted_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "terms_accepted_at" timestamp,
  "revoked_at" timestamp,
  "revoked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_portal_invitations_token" ON "customer_portal_invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_portal_invitations_contact" ON "customer_portal_invitations" ("company_id", "contact_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_portal_invitations_company_created" ON "customer_portal_invitations" ("company_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_portal_invitations_pending" ON "customer_portal_invitations" ("company_id", "contact_id", lower("email")) WHERE "status" = 'pending';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_portal_invitations_status') THEN
    ALTER TABLE "customer_portal_invitations" ADD CONSTRAINT "chk_customer_portal_invitations_status"
      CHECK ("status" IN ('pending', 'accepted', 'revoked', 'expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_portal_invitations_language') THEN
    ALTER TABLE "customer_portal_invitations" ADD CONSTRAINT "chk_customer_portal_invitations_language"
      CHECK ("language" IN ('en', 'ar', 'bilingual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_portal_invitations_message') THEN
    ALTER TABLE "customer_portal_invitations" ADD CONSTRAINT "chk_customer_portal_invitations_message"
      CHECK ("message" IS NULL OR char_length("message") <= 500);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "customer_portal_accounts" ADD COLUMN IF NOT EXISTS "invitation_id" uuid;
--> statement-breakpoint
ALTER TABLE "customer_portal_accounts" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "customer_portal_accounts" ADD COLUMN IF NOT EXISTS "revoked_by" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_customer_portal_accounts_invitation') THEN
    ALTER TABLE "customer_portal_accounts" ADD CONSTRAINT "fk_customer_portal_accounts_invitation"
      FOREIGN KEY ("invitation_id") REFERENCES "customer_portal_invitations"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_portal_accounts_contact" ON "customer_portal_accounts" ("company_id", "contact_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- Portal customers are never company members.
DELETE FROM "company_users" cu USING "users" u WHERE cu."user_id" = u."id" AND u."user_type" = 'client_portal';

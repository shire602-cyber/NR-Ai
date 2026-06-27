ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "portal_access_token" text UNIQUE;
ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "portal_access_expires_at" timestamp;

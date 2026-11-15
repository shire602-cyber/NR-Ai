ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "share_token" text UNIQUE;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "share_token_expires_at" timestamp;

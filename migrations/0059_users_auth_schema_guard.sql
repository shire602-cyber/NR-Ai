-- Idempotent repair for production databases where the users table predates
-- the full auth schema selected by Drizzle during login/session reads.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_admin" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "user_type" text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS "firm_role" text,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "avatar_url" text,
  ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;

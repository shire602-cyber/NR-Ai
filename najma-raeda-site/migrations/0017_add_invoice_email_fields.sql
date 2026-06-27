ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_terms" text DEFAULT 'net30';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "last_reminder_sent_at" timestamp;

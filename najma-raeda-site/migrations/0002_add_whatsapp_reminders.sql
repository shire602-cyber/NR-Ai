-- Add WhatsApp support to reminder_settings table
ALTER TABLE "reminder_settings" 
ADD COLUMN IF NOT EXISTS "send_whatsapp" boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS "whatsapp_template" text;


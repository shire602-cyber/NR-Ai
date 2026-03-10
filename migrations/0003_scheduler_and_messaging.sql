-- Scheduled Jobs table for background job tracking
CREATE TABLE IF NOT EXISTS "scheduled_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_name" text NOT NULL,
  "job_type" text NOT NULL DEFAULT 'cron',
  "cron_expression" text,
  "status" text NOT NULL DEFAULT 'pending',
  "last_run_at" timestamp,
  "next_run_at" timestamp,
  "last_error" text,
  "run_count" integer NOT NULL DEFAULT 0,
  "fail_count" integer NOT NULL DEFAULT 0,
  "last_duration_ms" integer,
  "is_enabled" boolean NOT NULL DEFAULT true,
  "config" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Message Templates table for multi-language templates
CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'general',
  "language" text NOT NULL DEFAULT 'en',
  "subject" text,
  "body" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'whatsapp',
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- WhatsApp Web Sessions table for Baileys auth persistence
CREATE TABLE IF NOT EXISTS "whatsapp_web_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_name" text NOT NULL DEFAULT 'default',
  "status" text NOT NULL DEFAULT 'disconnected',
  "phone_number" text,
  "push_name" text,
  "auth_state" text,
  "messages_sent_today" integer NOT NULL DEFAULT 0,
  "last_message_at" timestamp,
  "last_connected_at" timestamp,
  "last_disconnected_at" timestamp,
  "daily_message_limit" integer NOT NULL DEFAULT 100,
  "message_delay_ms" integer NOT NULL DEFAULT 3000,
  "business_hours_start" integer NOT NULL DEFAULT 9,
  "business_hours_end" integer NOT NULL DEFAULT 18,
  "timezone" text NOT NULL DEFAULT 'Asia/Dubai',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Message Queue table for rate-limited outbound messages
CREATE TABLE IF NOT EXISTS "message_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipient_phone" text NOT NULL,
  "recipient_name" text,
  "message_type" text NOT NULL DEFAULT 'text',
  "content" text NOT NULL,
  "media_url" text,
  "media_file_name" text,
  "company_id" uuid REFERENCES "companies"("id"),
  "template_id" uuid REFERENCES "message_templates"("id"),
  "related_entity_type" text,
  "related_entity_id" uuid,
  "status" text NOT NULL DEFAULT 'queued',
  "priority" integer NOT NULL DEFAULT 5,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "last_error" text,
  "scheduled_for" timestamp,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed default message templates (English, Arabic, Somali)
INSERT INTO "message_templates" ("name", "category", "language", "body", "channel", "is_default") VALUES
  -- Document Reminders
  ('document_reminder', 'reminder', 'en', 'Dear {{clientName}}, this is a reminder to submit your {{documentType}} documents. Deadline: {{dueDate}}. Please submit them at your earliest convenience. - NR Accounting Services', 'whatsapp', true),
  ('document_reminder', 'reminder', 'ar', 'عزيزي {{clientName}}، هذا تذكير بتقديم مستندات {{documentType}} الخاصة بك. الموعد النهائي: {{dueDate}}. يرجى تقديمها في أقرب وقت ممكن. - خدمات NR المحاسبية', 'whatsapp', true),
  ('document_reminder', 'reminder', 'so', 'Mudane {{clientName}}, tani waa xusuusin aad u soo gudbiso dukumeentiyada {{documentType}}. Wakhtiga ugu dambeeya: {{dueDate}}. Fadlan soo gudbi sida ugu dhakhsaha badan. - NR Accounting Services', 'whatsapp', true),
  -- Invoice Notifications
  ('invoice_notification', 'invoice', 'en', 'Dear {{clientName}}, invoice #{{invoiceNumber}} for AED {{amount}} has been generated. Due date: {{dueDate}}. Thank you for your business. - NR Accounting Services', 'whatsapp', true),
  ('invoice_notification', 'invoice', 'ar', 'عزيزي {{clientName}}، تم إنشاء الفاتورة رقم #{{invoiceNumber}} بمبلغ {{amount}} درهم إماراتي. تاريخ الاستحقاق: {{dueDate}}. شكراً لتعاملكم معنا. - خدمات NR المحاسبية', 'whatsapp', true),
  ('invoice_notification', 'invoice', 'so', 'Mudane {{clientName}}, qaansheegta #{{invoiceNumber}} ee AED {{amount}} ayaa la sameeyay. Wakhtiga lacag bixinta: {{dueDate}}. Waad ku mahadsan tahay ganacsigaaga. - NR Accounting Services', 'whatsapp', true),
  -- Payment Reminders
  ('payment_reminder', 'reminder', 'en', 'Dear {{clientName}}, a friendly reminder that invoice #{{invoiceNumber}} for AED {{amount}} is overdue. Please arrange payment at your earliest convenience. - NR Accounting Services', 'whatsapp', true),
  ('payment_reminder', 'reminder', 'ar', 'عزيزي {{clientName}}، تذكير ودي بأن الفاتورة رقم #{{invoiceNumber}} بمبلغ {{amount}} درهم إماراتي قد تجاوزت موعد استحقاقها. يرجى ترتيب الدفع في أقرب وقت ممكن. - خدمات NR المحاسبية', 'whatsapp', true),
  ('payment_reminder', 'reminder', 'so', 'Mudane {{clientName}}, xusuusin saaxiibtinimo ah in qaansheegta #{{invoiceNumber}} ee AED {{amount}} ay ka dib dhacday. Fadlan u diyaari lacag bixinta sida ugu dhakhsaha badan. - NR Accounting Services', 'whatsapp', true),
  -- News Updates
  ('news_update', 'news', 'en', '📰 Tax & Compliance Update\n\n{{newsTitle}}\n\n{{newsSummary}}\n\nFor more details, contact NR Accounting Services.', 'whatsapp', true),
  ('news_update', 'news', 'ar', '📰 تحديث ضريبي وتنظيمي\n\n{{newsTitle}}\n\n{{newsSummary}}\n\nلمزيد من التفاصيل، تواصل مع خدمات NR المحاسبية.', 'whatsapp', true),
  ('news_update', 'news', 'so', '📰 Cusbitaan Canshuur & Waafaqid\n\n{{newsTitle}}\n\n{{newsSummary}}\n\nFaahfaahin dheeraad ah, la xiriir NR Accounting Services.', 'whatsapp', true),
  -- Service Promotions
  ('service_promotion', 'promotion', 'en', 'Dear {{clientName}}, we wanted to let you know about our {{serviceName}} service that could benefit your business. {{serviceDescription}} Contact us to learn more! - NR Accounting Services', 'whatsapp', true),
  ('service_promotion', 'promotion', 'ar', 'عزيزي {{clientName}}، نود إعلامك بخدمة {{serviceName}} التي يمكن أن تفيد عملك. {{serviceDescription}} تواصل معنا لمعرفة المزيد! - خدمات NR المحاسبية', 'whatsapp', true),
  ('service_promotion', 'promotion', 'so', 'Mudane {{clientName}}, waxaan rabnay inaan kugu wargelino adeegga {{serviceName}} oo faa''iido u noqon kara ganacsigaaga. {{serviceDescription}} Nala soo xiriir si aad wax badan uga ogaato! - NR Accounting Services', 'whatsapp', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- News Translations (cached AI translations for multilingual distribution)
CREATE TABLE IF NOT EXISTS "news_translations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "news_id" uuid NOT NULL REFERENCES "regulatory_news"("id") ON DELETE CASCADE,
  "language" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "content" text,
  "is_approved" boolean NOT NULL DEFAULT false,
  "reviewed_by" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "news_translations_news_id_language_unique" UNIQUE ("news_id", "language")
);

-- Phase 4: Payment Chasing Autopilot
-- Tracks reminder communications for overdue invoices with 4 escalation
-- levels (friendly → firm → urgent → final notice). Defaults templates
-- in EN/AR are seeded so customers get sensible behavior out of the box.

-- 1) Augment invoices with chase tracking columns -----------------------------
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "chase_level" integer NOT NULL DEFAULT 0;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "last_chased_at" timestamp;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "do_not_chase" boolean NOT NULL DEFAULT false;

-- 2) Chase log ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "payment_chases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "level" integer NOT NULL,
  "method" text NOT NULL DEFAULT 'whatsapp',
  "language" text NOT NULL DEFAULT 'en',
  "message_text" text NOT NULL,
  "days_overdue_at_send" integer NOT NULL DEFAULT 0,
  "amount_at_send" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'sent',
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "responded_at" timestamp,
  "paid_at" timestamp,
  "triggered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "meta" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_payment_chases_company_id" ON "payment_chases"("company_id");
CREATE INDEX IF NOT EXISTS "idx_payment_chases_invoice_id" ON "payment_chases"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_payment_chases_sent_at" ON "payment_chases"("sent_at");

-- 3) Templates ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "chase_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "level" integer NOT NULL,
  "language" text NOT NULL DEFAULT 'en',
  "subject" text,
  "body" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_chase_templates_lookup"
  ON "chase_templates"("company_id", "level", "language");

-- 4) Config -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "chase_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL UNIQUE REFERENCES "companies"("id") ON DELETE CASCADE,
  "auto_chase_enabled" boolean NOT NULL DEFAULT false,
  "chase_frequency_days" integer NOT NULL DEFAULT 7,
  "max_level" integer NOT NULL DEFAULT 4,
  "preferred_method" text NOT NULL DEFAULT 'whatsapp',
  "do_not_chase_contact_ids" text NOT NULL DEFAULT '[]',
  "default_language" text NOT NULL DEFAULT 'en',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp
);

-- 5) Seed system-default templates (company_id = NULL) ------------------------
-- Tone progression: friendly → firm → urgent → final notice. Placeholders
-- ({customerName}, {invoiceNumber}, {amount}, {currency}, {dueDate},
-- {daysOverdue}, {paymentLink}, {senderName}) are filled in at send time.

INSERT INTO "chase_templates" ("company_id", "level", "language", "subject", "body", "is_default")
VALUES
  (NULL, 1, 'en',
   'Friendly reminder: invoice {invoiceNumber}',
   'Dear {customerName},

This is a friendly reminder that invoice {invoiceNumber} for {currency} {amount} was due on {dueDate} and is now {daysOverdue} day(s) overdue.

If you have already sent payment, please disregard this message and accept our thanks. Otherwise, you can settle the invoice here: {paymentLink}

Kind regards,
{senderName}',
   true),
  (NULL, 2, 'en',
   'Reminder: invoice {invoiceNumber} is overdue',
   'Dear {customerName},

Our records show that invoice {invoiceNumber} for {currency} {amount}, due on {dueDate}, remains unpaid. It is now {daysOverdue} days past the due date.

Please arrange payment at your earliest convenience: {paymentLink}

If there is an issue with this invoice or you would like to discuss payment terms, please reply to this message and we will be glad to help.

Best regards,
{senderName}',
   true),
  (NULL, 3, 'en',
   'Urgent: invoice {invoiceNumber} is now {daysOverdue} days overdue',
   'Dear {customerName},

Despite our previous reminders, invoice {invoiceNumber} for {currency} {amount} (due {dueDate}) remains unpaid and is now {daysOverdue} days overdue.

We kindly request that you settle this balance within the next 7 days to avoid further action: {paymentLink}

If payment has been initiated, please share the transfer reference so we can reconcile your account.

Sincerely,
{senderName}',
   true),
  (NULL, 4, 'en',
   'Final notice: invoice {invoiceNumber}',
   'Dear {customerName},

This is a final notice regarding invoice {invoiceNumber} for {currency} {amount}, due on {dueDate} and now {daysOverdue} days overdue.

Failure to settle this account within 7 days will leave us no choice but to escalate this matter. We very much hope to resolve this amicably and would appreciate your immediate attention.

Payment link: {paymentLink}

Yours sincerely,
{senderName}',
   true);

-- Arabic defaults (RTL friendly; placeholders are language-neutral)
INSERT INTO "chase_templates" ("company_id", "level", "language", "subject", "body", "is_default")
VALUES
  (NULL, 1, 'ar',
   'تذكير ودي بشأن الفاتورة {invoiceNumber}',
   'عزيزي {customerName}،

هذا تذكير ودي بأن الفاتورة رقم {invoiceNumber} بقيمة {currency} {amount} كانت مستحقة في {dueDate} وقد تأخرت الآن بمقدار {daysOverdue} يوم.

إذا كنت قد قمت بالسداد بالفعل، نرجو تجاهل هذه الرسالة وتقبل شكرنا. وإلا يمكنك تسوية الفاتورة من خلال الرابط: {paymentLink}

مع أطيب التحيات،
{senderName}',
   true),
  (NULL, 2, 'ar',
   'تذكير: الفاتورة {invoiceNumber} متأخرة',
   'عزيزي {customerName}،

تشير سجلاتنا إلى أن الفاتورة {invoiceNumber} بقيمة {currency} {amount} المستحقة في {dueDate} لا تزال غير مسددة، وقد مضى على تاريخ استحقاقها {daysOverdue} يوماً.

يرجى تسوية المبلغ في أقرب وقت ممكن: {paymentLink}

في حال وجود أي استفسار أو رغبة في مناقشة شروط الدفع، يسعدنا مساعدتك.

أطيب التحيات،
{senderName}',
   true),
  (NULL, 3, 'ar',
   'عاجل: الفاتورة {invoiceNumber} متأخرة منذ {daysOverdue} يوماً',
   'عزيزي {customerName}،

على الرغم من تذكيراتنا السابقة، لا تزال الفاتورة {invoiceNumber} بقيمة {currency} {amount} (المستحقة في {dueDate}) غير مسددة، وقد مضى على تاريخ استحقاقها {daysOverdue} يوماً.

نرجو تسوية الرصيد خلال 7 أيام لتفادي أي إجراءات إضافية: {paymentLink}

إذا تمت عملية الدفع، يرجى مشاركة مرجع التحويل ليتسنى لنا تسوية الحساب.

مع خالص التقدير،
{senderName}',
   true),
  (NULL, 4, 'ar',
   'إشعار نهائي بشأن الفاتورة {invoiceNumber}',
   'عزيزي {customerName}،

هذا إشعار نهائي بشأن الفاتورة {invoiceNumber} بقيمة {currency} {amount} المستحقة في {dueDate}، والمتأخرة الآن منذ {daysOverdue} يوماً.

في حال عدم تسوية الحساب خلال 7 أيام، سنضطر للأسف إلى تصعيد الأمر. نأمل حل المسألة ودياً ونقدّر اهتمامك العاجل.

رابط الدفع: {paymentLink}

مع خالص التحية،
{senderName}',
   true);

-- 5-year FTA retention also applies to chase logs (they reference financial
-- records that must be preserved). Mirroring the pattern from 0036.
ALTER TABLE "payment_chases"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

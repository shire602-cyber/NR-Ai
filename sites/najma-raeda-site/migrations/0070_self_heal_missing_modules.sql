-- Self-healing migration: recreate every table/column the production
-- schema-health diff (2026-06-12) reported missing. The production Drizzle
-- ledger was baselined with migrations 0004–0061 marked applied without
-- running, so entire modules (quotes, credit notes, purchase orders,
-- recurring invoices, payment/document chasing, compliance calendar, VAT
-- autopilot periods, invoice numbering) 500 on first use. All source
-- migrations are already idempotent — this file replays them verbatim, plus
-- the individually missing columns. Every statement is a no-op on re-run.

-- ─── from 0004_add_recurring_invoices.sql ───
CREATE TABLE IF NOT EXISTS "recurring_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "currency" text NOT NULL DEFAULT 'AED',
  "frequency" text NOT NULL DEFAULT 'monthly',
  "start_date" timestamp NOT NULL,
  "next_run_date" timestamp NOT NULL,
  "end_date" timestamp,
  "lines_json" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_generated_invoice_id" uuid,
  "total_generated" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ─── from 0034_invoice_number_sequences.sql ───
-- Sprint 3.3: Sequential invoice numbering with no gaps (FTA requirement)
-- One sequence row per (company, document type, year). Allocation uses an
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern, which is atomic
-- under concurrent transactions and guarantees gap-free monotonic numbers.

CREATE TABLE IF NOT EXISTS "invoice_number_sequences" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "doc_type" text NOT NULL,
  "year" integer NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "doc_type", "year")
);

CREATE INDEX IF NOT EXISTS "idx_invoice_number_sequences_company"
  ON "invoice_number_sequences"("company_id");

-- ─── from 0047_vat_autopilot.sql ───
-- Phase 3: VAT Return Autopilot
-- Adds per-company VAT autopilot configuration and a vat_return_periods table
-- that tracks each filing window through draft → ready → submitted → accepted.
-- A jsonb `adjustments` column carries an audit-trailed list of manual overrides
-- applied on top of the auto-calculated VAT 201 box totals.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "vat_auto_calculate" boolean NOT NULL DEFAULT true;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "vat_period_start_month" integer NOT NULL DEFAULT 1;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vat_period_start_month_range'
  ) THEN
    ALTER TABLE "companies"
      ADD CONSTRAINT "vat_period_start_month_range"
      CHECK ("vat_period_start_month" >= 1 AND "vat_period_start_month" <= 12);
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS "vat_return_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "due_date" timestamp NOT NULL,
  "frequency" text NOT NULL DEFAULT 'quarterly',
  "status" text NOT NULL DEFAULT 'draft',
  "output_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "input_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "net_vat_payable" numeric(15,2) NOT NULL DEFAULT 0,
  "calculated_at" timestamp,
  "adjustments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "vat_return_id" uuid REFERENCES "vat_returns"("id"),
  "submitted_at" timestamp,
  "submitted_by" uuid REFERENCES "users"("id"),
  "fta_reference_number" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vat_return_periods_company_period_unique"
    UNIQUE ("company_id", "period_start", "period_end"),
  CONSTRAINT "vat_return_periods_status_check"
    CHECK ("status" IN ('draft','ready','submitted','accepted')),
  CONSTRAINT "vat_return_periods_frequency_check"
    CHECK ("frequency" IN ('quarterly','monthly'))
);

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_company_id"
  ON "vat_return_periods" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_due_date"
  ON "vat_return_periods" ("due_date");

CREATE INDEX IF NOT EXISTS "idx_vat_return_periods_status"
  ON "vat_return_periods" ("status");

-- ─── from 0048_payment_chasing.sql ───
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

DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "chase_templates" WHERE "company_id" IS NULL) THEN
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
  END IF;
END
$seed$;

-- 5-year FTA retention also applies to chase logs (they reference financial
-- records that must be preserved). Mirroring the pattern from 0036.
ALTER TABLE "payment_chases"
  ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp
  GENERATED ALWAYS AS ("created_at" + INTERVAL '5 years') STORED;

-- ─── from 0049_document_chasing.sql ───
-- Phase 5: Document Chasing Autopilot
-- Tracks UAE compliance document requirements per company, the escalating
-- chase pipeline used to collect them, and the calendar of upcoming
-- deadlines (trade-licence renewals, visa expiries, FTA filings, ESR, etc.)
-- that drive auto-scheduled reminders.

CREATE TABLE IF NOT EXISTS "document_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "description" text,
  "due_date" timestamp NOT NULL,
  "is_recurring" boolean NOT NULL DEFAULT false,
  "recurring_interval_days" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "received_at" timestamp,
  "uploaded_document_id" uuid,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_document_requirements_company_id"
  ON "document_requirements" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_document_requirements_due_date"
  ON "document_requirements" ("due_date");
CREATE INDEX IF NOT EXISTS "idx_document_requirements_status"
  ON "document_requirements" ("status");

CREATE TABLE IF NOT EXISTS "document_chases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "requirement_id" uuid NOT NULL REFERENCES "document_requirements"("id") ON DELETE CASCADE,
  "chase_level" text NOT NULL,
  "sent_via" text NOT NULL,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "message_content" text NOT NULL,
  "recipient_phone" text,
  "recipient_email" text,
  "response_received" boolean NOT NULL DEFAULT false,
  "response_received_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_document_chases_company_id"
  ON "document_chases" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_document_chases_requirement_id"
  ON "document_chases" ("requirement_id");
CREATE INDEX IF NOT EXISTS "idx_document_chases_sent_at"
  ON "document_chases" ("sent_at");

CREATE TABLE IF NOT EXISTS "compliance_calendar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "description" text NOT NULL,
  "event_date" timestamp NOT NULL,
  "reminder_days" text NOT NULL DEFAULT '30,14,7,0',
  "status" text NOT NULL DEFAULT 'upcoming',
  "completed_at" timestamp,
  "linked_requirement_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_compliance_calendar_company_id"
  ON "compliance_calendar" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_compliance_calendar_event_date"
  ON "compliance_calendar" ("event_date");

-- ─── from 0059_quotes.sql ───
-- Quotes (estimates) — convertible to invoices. Idempotent for databases of
-- any lineage.
CREATE TABLE IF NOT EXISTS "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "date" timestamp NOT NULL,
  "expiry_date" timestamp,
  "currency" text NOT NULL DEFAULT 'AED',
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "converted_invoice_id" uuid,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "quotes_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_quotes_company_id" ON "quotes" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_quotes_company_status" ON "quotes" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "quote_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" real NOT NULL,
  "unit_price" numeric(15,2) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated'
);
CREATE INDEX IF NOT EXISTS "idx_quote_lines_quote_id" ON "quote_lines" ("quote_id");

-- ─── from 0060_credit_notes.sql ───
-- Credit notes (FTA-compliant invoice corrections). Idempotent.
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "invoice_number" text,
  "date" timestamp NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "reason" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "credit_notes_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_credit_notes_company_id" ON "credit_notes" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_credit_notes_company_status" ON "credit_notes" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "credit_note_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credit_note_id" uuid NOT NULL REFERENCES "credit_notes"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" real NOT NULL,
  "unit_price" numeric(15,2) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated'
);
CREATE INDEX IF NOT EXISTS "idx_credit_note_lines_credit_note_id" ON "credit_note_lines" ("credit_note_id");

-- ─── from 0061_purchase_orders.sql ───
-- Purchase orders. Idempotent.
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "vendor_name" text NOT NULL,
  "vendor_trn" text,
  "date" timestamp NOT NULL,
  "expected_delivery_date" timestamp,
  "currency" text NOT NULL DEFAULT 'AED',
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_orders_company_number_unique" UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_company_id" ON "purchase_orders" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_company_status" ON "purchase_orders" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" real NOT NULL,
  "unit_price" numeric(15,2) NOT NULL,
  "vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05,
  "vat_supply_type" text DEFAULT 'standard_rated'
);
CREATE INDEX IF NOT EXISTS "idx_purchase_order_lines_po_id" ON "purchase_order_lines" ("purchase_order_id");

-- ─── individually missing columns ───
ALTER TABLE "customer_contacts"
  ADD COLUMN IF NOT EXISTS "whatsapp_number" text;
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "auto_posted" boolean NOT NULL DEFAULT false;
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "classifier_method" text;
ALTER TABLE "transaction_classifications"
  ADD COLUMN IF NOT EXISTS "classifier_method" text;
CREATE INDEX IF NOT EXISTS "idx_receipts_company_classifier_method"
  ON "receipts" ("company_id", "classifier_method");

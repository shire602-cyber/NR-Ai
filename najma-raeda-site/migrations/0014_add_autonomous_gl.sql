-- Autonomous GL Engine tables
-- AI auto-categorizes and auto-posts bank transactions to the GL

CREATE TABLE IF NOT EXISTS "ai_gl_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bank_transaction_id" uuid,
  "description" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "transaction_date" timestamp NOT NULL,
  "suggested_account_id" uuid,
  "suggested_category" text,
  "ai_confidence" numeric(3,2) DEFAULT 0,
  "ai_reason" text,
  "few_shot_examples_used" integer DEFAULT 0,
  "status" text DEFAULT 'pending_review',
  "journal_entry_id" uuid,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "user_selected_account_id" uuid,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ai_company_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "merchant_pattern" text,
  "description_pattern" text,
  "account_id" uuid NOT NULL,
  "times_applied" integer DEFAULT 0,
  "times_accepted" integer DEFAULT 0,
  "times_rejected" integer DEFAULT 0,
  "confidence" numeric(3,2) DEFAULT 0.5,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "month_end_close" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "status" text DEFAULT 'open',
  "checklist" text,
  "closing_journal_entry_id" uuid,
  "closed_by" uuid,
  "closed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_ai_gl_queue_company_status" ON "ai_gl_queue" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_ai_gl_queue_bank_txn" ON "ai_gl_queue" ("bank_transaction_id");
CREATE INDEX IF NOT EXISTS "idx_ai_company_rules_company" ON "ai_company_rules" ("company_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_month_end_close_company" ON "month_end_close" ("company_id", "status");

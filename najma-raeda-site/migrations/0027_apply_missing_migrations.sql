-- Consolidation: safely apply all previously missing migrations.
-- These were created but never registered in _journal.json, so they were silently skipped.
-- All statements are idempotent (IF NOT EXISTS / DO $$ ... IF ... END $$).

-- =========================================================
-- From 0015_fix_monetary_types
-- Convert real (4-byte float) to numeric(15,2) for exact decimal storage.
-- UAE FTA compliance requires exact monetary figures; real causes rounding drift.
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='journal_lines' AND column_name='debit' AND data_type='real'
  ) THEN
    ALTER TABLE journal_lines
      ALTER COLUMN debit TYPE numeric(15,2) USING debit::numeric(15,2),
      ALTER COLUMN credit TYPE numeric(15,2) USING credit::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invoices' AND column_name='subtotal' AND data_type='real'
  ) THEN
    ALTER TABLE invoices
      ALTER COLUMN subtotal TYPE numeric(15,2) USING subtotal::numeric(15,2),
      ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2),
      ALTER COLUMN total TYPE numeric(15,2) USING total::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invoice_lines' AND column_name='unit_price' AND data_type='real'
  ) THEN
    ALTER TABLE invoice_lines
      ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='receipts' AND column_name='amount' AND data_type='real'
  ) THEN
    ALTER TABLE receipts
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2),
      ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='unit_price' AND data_type='real'
  ) THEN
    ALTER TABLE products
      ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2),
      ALTER COLUMN cost_price TYPE numeric(15,2) USING cost_price::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='inventory_movements' AND column_name='unit_cost' AND data_type='real'
  ) THEN
    ALTER TABLE inventory_movements
      ALTER COLUMN unit_cost TYPE numeric(15,2) USING unit_cost::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bank_transactions' AND column_name='amount' AND data_type='real'
  ) THEN
    ALTER TABLE bank_transactions
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='budgets' AND column_name='budget_amount' AND data_type='real'
  ) THEN
    ALTER TABLE budgets
      ALTER COLUMN budget_amount TYPE numeric(15,2) USING budget_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='cash_flow_forecasts' AND column_name='predicted_inflow' AND data_type='real'
  ) THEN
    ALTER TABLE cash_flow_forecasts
      ALTER COLUMN predicted_inflow TYPE numeric(15,2) USING predicted_inflow::numeric(15,2),
      ALTER COLUMN predicted_outflow TYPE numeric(15,2) USING predicted_outflow::numeric(15,2),
      ALTER COLUMN predicted_balance TYPE numeric(15,2) USING predicted_balance::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ecommerce_transactions' AND column_name='amount' AND data_type='real'
  ) THEN
    ALTER TABLE ecommerce_transactions
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2),
      ALTER COLUMN platform_fees TYPE numeric(15,2) USING platform_fees::numeric(15,2),
      ALTER COLUMN net_amount TYPE numeric(15,2) USING net_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='transaction_classifications' AND column_name='amount' AND data_type='real'
  ) THEN
    ALTER TABLE transaction_classifications
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='subscription_plans' AND column_name='price_monthly' AND data_type='real'
  ) THEN
    ALTER TABLE subscription_plans
      ALTER COLUMN price_monthly TYPE numeric(15,2) USING price_monthly::numeric(15,2),
      ALTER COLUMN price_yearly TYPE numeric(15,2) USING price_yearly::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='engagements' AND column_name='monthly_fee' AND data_type='real'
  ) THEN
    ALTER TABLE engagements
      ALTER COLUMN monthly_fee TYPE numeric(15,2) USING monthly_fee::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='service_invoices' AND column_name='subtotal' AND data_type='real'
  ) THEN
    ALTER TABLE service_invoices
      ALTER COLUMN subtotal TYPE numeric(15,2) USING subtotal::numeric(15,2),
      ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2),
      ALTER COLUMN total TYPE numeric(15,2) USING total::numeric(15,2),
      ALTER COLUMN paid_amount TYPE numeric(15,2) USING paid_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='service_invoice_lines' AND column_name='unit_price' AND data_type='real'
  ) THEN
    ALTER TABLE service_invoice_lines
      ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2),
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tax_return_archive' AND column_name='tax_amount' AND data_type='real'
  ) THEN
    ALTER TABLE tax_return_archive
      ALTER COLUMN tax_amount TYPE numeric(15,2) USING tax_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='referral_codes' AND column_name='referrer_reward_value' AND data_type='real'
  ) THEN
    ALTER TABLE referral_codes
      ALTER COLUMN referrer_reward_value TYPE numeric(15,2) USING referrer_reward_value::numeric(15,2),
      ALTER COLUMN referee_reward_value TYPE numeric(15,2) USING referee_reward_value::numeric(15,2),
      ALTER COLUMN total_rewards_earned TYPE numeric(15,2) USING total_rewards_earned::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='referrals' AND column_name='referrer_reward_amount' AND data_type='real'
  ) THEN
    ALTER TABLE referrals
      ALTER COLUMN referrer_reward_amount TYPE numeric(15,2) USING referrer_reward_amount::numeric(15,2),
      ALTER COLUMN referee_reward_amount TYPE numeric(15,2) USING referee_reward_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='corporate_tax_returns' AND column_name='total_revenue' AND data_type='real'
  ) THEN
    ALTER TABLE corporate_tax_returns
      ALTER COLUMN total_revenue TYPE numeric(15,2) USING total_revenue::numeric(15,2),
      ALTER COLUMN total_expenses TYPE numeric(15,2) USING total_expenses::numeric(15,2),
      ALTER COLUMN total_deductions TYPE numeric(15,2) USING total_deductions::numeric(15,2),
      ALTER COLUMN taxable_income TYPE numeric(15,2) USING taxable_income::numeric(15,2),
      ALTER COLUMN exemption_threshold TYPE numeric(15,2) USING exemption_threshold::numeric(15,2),
      ALTER COLUMN tax_payable TYPE numeric(15,2) USING tax_payable::numeric(15,2);
  END IF;
END $$;

-- =========================================================
-- From 0016_add_indexes
-- Performance indexes for core tables.
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_id ON journal_entries (company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON journal_entries (company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_entry_number ON journal_entries (company_id, entry_number);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON journal_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON invoices (company_id, date);
CREATE INDEX IF NOT EXISTS idx_invoices_company_status ON invoices (company_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_company_id ON receipts (company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company_created_at ON receipts (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_id ON bank_transactions (company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_date ON bank_transactions (company_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_accounts_company_id ON accounts (company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_company_code ON accounts (company_id, code);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_company_id ON customer_contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_company_users_user_id ON company_users (user_id);
CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON company_users (company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company_id ON activity_logs (company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs (user_id);

-- =========================================================
-- From 0017_receipts_date_timestamp
-- Change receipts.date from text to timestamp.
-- =========================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='receipts' AND column_name='date' AND data_type='text'
  ) THEN
    ALTER TABLE receipts
      ALTER COLUMN date TYPE timestamp USING
        CASE
          WHEN date IS NULL OR trim(date) = '' THEN NULL
          ELSE date::timestamp
        END;
  END IF;
END $$;

-- =========================================================
-- From 0018_journal_entry_unique
-- Add unique constraint on (company_id, entry_number).
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'journal_entries_company_entry_number_unique'
      AND table_name = 'journal_entries'
  ) THEN
    -- Delete duplicates first to avoid constraint violation
    DELETE FROM journal_entries je1
    USING journal_entries je2
    WHERE je1.id > je2.id
      AND je1.company_id = je2.company_id
      AND je1.entry_number = je2.entry_number;

    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_company_entry_number_unique UNIQUE (company_id, entry_number);
  END IF;
END $$;

-- =========================================================
-- From 0019_companies_soft_delete  [CRITICAL]
-- Adds deleted_at and is_active to companies.
-- Without this, ALL company queries fail because Drizzle schema includes these columns.
-- =========================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- =========================================================
-- From 0020_add_firm_leads
-- Creates firm_leads table for CRM pipeline.
-- =========================================================

CREATE TABLE IF NOT EXISTS "firm_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "company_id" uuid,
  "stage" text DEFAULT 'prospect' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "notes" text,
  "score" integer DEFAULT 50,
  "converted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'firm_leads_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "firm_leads"
      ADD CONSTRAINT "firm_leads_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'firm_leads_company_id_companies_id_fk'
  ) THEN
    ALTER TABLE "firm_leads"
      ADD CONSTRAINT "firm_leads_company_id_companies_id_fk"
      FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- =========================================================
-- From 0020_invoice_contact_fk
-- Adds contact_id FK to invoices.
-- =========================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_contact_id ON invoices (contact_id);

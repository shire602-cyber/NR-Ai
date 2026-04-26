-- ============================================================================
-- 0029: Money precision, missing FK numerics, unique constraints, and indexes
-- ----------------------------------------------------------------------------
-- 1. Convert remaining real (4-byte float) columns to numeric(15,2) for money
--    and numeric(15,6) for exchange rates. UAE FTA compliance requires exact
--    monetary figures; floating-point storage causes drift on multi-line entries.
-- 2. Convert vat_rate columns from real to numeric(5,4) since IEEE-754 cannot
--    represent 0.05 exactly.
-- 3. Add unique constraints required by domain rules.
-- 4. Drop the (incorrectly) global unique constraint on companies.name.
-- 5. Add indexes on the most-queried FK columns.
-- All statements are idempotent (IF NOT EXISTS / DO blocks with guards).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Real -> numeric for monetary columns
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invoice_payments' AND column_name='amount' AND data_type='real'
  ) THEN
    ALTER TABLE invoice_payments
      ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='receipts' AND column_name='base_currency_amount' AND data_type='real'
  ) THEN
    ALTER TABLE receipts
      ALTER COLUMN base_currency_amount TYPE numeric(15,2) USING base_currency_amount::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='journal_lines' AND column_name='foreign_debit' AND data_type='real'
  ) THEN
    ALTER TABLE journal_lines
      ALTER COLUMN foreign_debit TYPE numeric(15,2) USING foreign_debit::numeric(15,2),
      ALTER COLUMN foreign_credit TYPE numeric(15,2) USING foreign_credit::numeric(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bank_transactions' AND column_name='balance' AND data_type='real'
  ) THEN
    ALTER TABLE bank_transactions
      ALTER COLUMN balance TYPE numeric(15,2) USING balance::numeric(15,2);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Real -> numeric(15,6) for exchange rates
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='journal_lines' AND column_name='exchange_rate' AND data_type='real'
  ) THEN
    ALTER TABLE journal_lines
      ALTER COLUMN exchange_rate TYPE numeric(15,6) USING exchange_rate::numeric(15,6);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invoices' AND column_name='exchange_rate' AND data_type='real'
  ) THEN
    ALTER TABLE invoices
      ALTER COLUMN exchange_rate TYPE numeric(15,6) USING exchange_rate::numeric(15,6);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='receipts' AND column_name='exchange_rate' AND data_type='real'
  ) THEN
    ALTER TABLE receipts
      ALTER COLUMN exchange_rate TYPE numeric(15,6) USING exchange_rate::numeric(15,6);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='exchange_rates' AND column_name='rate' AND data_type='real'
  ) THEN
    ALTER TABLE exchange_rates
      ALTER COLUMN rate TYPE numeric(15,6) USING rate::numeric(15,6);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Real -> numeric(5,4) for VAT rates
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invoice_lines' AND column_name='vat_rate' AND data_type='real'
  ) THEN
    ALTER TABLE invoice_lines
      ALTER COLUMN vat_rate TYPE numeric(5,4) USING vat_rate::numeric(5,4);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='vat_rate' AND data_type='real'
  ) THEN
    ALTER TABLE products
      ALTER COLUMN vat_rate TYPE numeric(5,4) USING vat_rate::numeric(5,4);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='service_invoice_lines' AND column_name='vat_rate' AND data_type='real'
  ) THEN
    ALTER TABLE service_invoice_lines
      ALTER COLUMN vat_rate TYPE numeric(5,4) USING vat_rate::numeric(5,4);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Drop incorrect global unique on companies.name
--     Two different firms can legitimately have same-named clients.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
   AND tc.table_schema    = ccu.table_schema
  WHERE tc.table_name = 'companies'
    AND tc.constraint_type = 'UNIQUE'
    AND ccu.column_name = 'name'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE companies DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Unique constraints
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'company_users_company_user_unique'
      AND table_name = 'company_users'
  ) THEN
    -- Remove duplicates first to allow constraint creation
    DELETE FROM company_users a
    USING company_users b
    WHERE a.id > b.id
      AND a.company_id = b.company_id
      AND a.user_id    = b.user_id;

    ALTER TABLE company_users
      ADD CONSTRAINT company_users_company_user_unique UNIQUE (company_id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_company_number_unique'
      AND table_name = 'invoices'
  ) THEN
    -- FTA requires unique invoice numbers per company; if duplicates exist we
    -- cannot silently delete them, so this will fail loudly until fixed by hand.
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_company_number_unique UNIQUE (company_id, number);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Indexes for hot FK columns
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_id    ON journal_entries (company_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id        ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id           ON invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company_id           ON receipts (company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account_id ON bank_transactions (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id   ON invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company_id      ON activity_logs (company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_company_id      ON company_users (company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_user_id         ON company_users (user_id);

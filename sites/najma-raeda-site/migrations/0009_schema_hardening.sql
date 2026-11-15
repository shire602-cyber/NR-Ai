-- Schema hardening migration
-- See docs/schema-hardening-runbook.md for operational runbook and safety notes.
--
-- Three independent changes combined into a single atomic migration:
--   1. real -> numeric(15,2) / numeric(10,6) / numeric(15,4) for all financial
--      columns across the accounting tables. IEEE-754 single precision rounds
--      at ~7 digits; numeric is what the books need.
--   2. NOT NULL on journal_lines.account_id (business logic already assumes
--      it; the schema was letting silent nulls in).
--   3. Uniqueness + FK indexes that routinely-hot queries need.
--
-- Pre-flight: the three dedup queries in the runbook MUST return zero rows
-- before this is applied. The two ADD CONSTRAINT UNIQUE statements will
-- otherwise abort the whole migration.

BEGIN;

-- =========================================================================
-- 1. real -> numeric type migration
-- =========================================================================
-- Money columns: numeric(15,2) — 13 digits before the decimal is enough for
-- any realistic AED balance and keeps the exact 2-decimal representation
-- the books use.
-- Rate columns:  numeric(10,6) — vat_rate (0.05), tax_rate (0.09),
-- confidence scores (0.00..1.00), conversion rates etc.
-- Quantity columns: numeric(15,4) — 4 decimal places lets us represent
-- fractional units of inventory accurately.

-- Every column named here is either a rate (0..1 probability, percentage)
-- or a physical quantity — both need a different precision than the
-- catch-all money default below. Each ALTER is guarded by information_schema
-- so the migration is safe to run against databases that haven't received
-- every previous feature (e.g. missing `products` because migration 0007
-- wasn't applied to this environment).

DO $$
DECLARE
  rec record;
  rate_cols text[]     := ARRAY[
    'invoice_lines.vat_rate',
    'products.vat_rate',
    'bank_transactions.ai_confidence',
    'bank_transactions.match_confidence',
    'anomaly_alerts.ai_confidence',
    'cash_flow_forecasts.confidence_level',
    'transaction_classifications.ai_confidence',
    'financial_kpis.change_percent',
    'financial_kpis.benchmark',
    'feature_usage_metrics.avg_duration',
    'feature_usage_metrics.conversion_rate',
    'feature_usage_metrics.error_rate'
  ];
  qty_cols text[]      := ARRAY[
    'invoice_lines.quantity',
    'invoice_lines.unit_price'
  ];
  spec text;
  parts text[];
BEGIN
  FOREACH spec IN ARRAY rate_cols LOOP
    parts := string_to_array(spec, '.');
    IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=parts[1]
                   AND column_name=parts[2] AND data_type='real') THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE numeric(10,6) USING %I::numeric(10,6)',
        parts[1], parts[2], parts[2]
      );
    END IF;
  END LOOP;
  FOREACH spec IN ARRAY qty_cols LOOP
    parts := string_to_array(spec, '.');
    IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=parts[1]
                   AND column_name=parts[2] AND data_type='real') THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE numeric(15,4) USING %I::numeric(15,4)',
        parts[1], parts[2], parts[2]
      );
    END IF;
  END LOOP;
END $$;

-- Catch-all: any remaining `real` column on any table gets bumped to
-- numeric(15,2). Rates and quantities above have already been handled with
-- their specific precision, so this fallback only fires on columns we
-- didn't name explicitly (e.g. VAT-201 boxes, tax rates, analytics KPIs,
-- payroll line items) — they should all be money.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name   = c.table_name
     WHERE c.data_type = 'real'
       AND c.table_schema = 'public'
       AND t.table_type   = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE numeric(15,2) USING %I::numeric(15,2)',
      rec.table_schema, rec.table_name, rec.column_name, rec.column_name
    );
  END LOOP;
END $$;

-- =========================================================================
-- 2. Referential integrity
-- =========================================================================

-- Business logic in storage.ts + every journal-entry creator assumes every
-- line has an account_id. Enforce it in the schema too so we can't silently
-- insert orphan lines anymore.
-- (If dedup pre-flight shows null rows, fix them first — see runbook.)
ALTER TABLE journal_lines ALTER COLUMN account_id SET NOT NULL;

-- =========================================================================
-- 3. Uniqueness constraints
-- =========================================================================
-- (company_id, number) on invoices — stops duplicate invoice numbers on
-- retries and double-submit races.
-- (company_id, code) on accounts — trial balance relies on unique codes.
--
-- Both use "IF NOT EXISTS" via a guarded DO block so re-running the
-- migration on an environment that already applied them is a no-op
-- instead of an error.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_company_number_unique'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_company_number_unique UNIQUE (company_id, number);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_company_code_unique'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_company_code_unique UNIQUE (company_id, code);
  END IF;
END $$;

-- =========================================================================
-- 4. Indexes on hot foreign-key paths
-- =========================================================================
-- Drizzle does not auto-index foreign keys. These three are the ones the
-- audit flagged as routinely-scanned in production (reports, VAT, ledger).

CREATE INDEX IF NOT EXISTS idx_invoices_company_date   ON invoices(company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account   ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company_date   ON receipts(company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON journal_entries(company_id, date);

-- =========================================================================
-- 5. Portal IDOR fix: invoices.contact_id FK
-- =========================================================================
-- Nullable so existing rows (which have no contact_id) stay valid. New
-- flows populate it, and the portal authorisation check prefers
-- contactId over the legacy name-based match. onDelete "set null" keeps
-- the invoice on record if the contact is later deleted.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id);

-- =========================================================================
-- 6. JWT revocation denylist
-- =========================================================================
-- Access tokens are stateless JWTs. /auth/logout and password-change
-- flows insert the token's jti + its original exp here so the auth
-- middleware can reject a stolen or logged-out token even though the
-- token cryptography is still valid. A periodic GC job removes rows
-- whose expires_at has passed.

CREATE TABLE IF NOT EXISTS jwt_revocations (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  jti         text          NOT NULL UNIQUE,
  user_id     uuid                REFERENCES users(id) ON DELETE CASCADE,
  reason      text          NOT NULL DEFAULT 'logout',
  expires_at  timestamp     NOT NULL,
  created_at  timestamp     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jwt_revocations_expires ON jwt_revocations(expires_at);

COMMIT;

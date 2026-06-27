-- =========================================================
-- Migration: Multi-currency support
-- Adds exchange_rates table and FX tracking fields to
-- invoices, receipts, and journal_lines.
-- Base currency is AED. debit/credit on journal_lines
-- always represent AED amounts after this migration.
-- =========================================================

-- Exchange rates lookup table
CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_currency"   TEXT NOT NULL DEFAULT 'AED',
  "target_currency" TEXT NOT NULL,
  "rate"            REAL NOT NULL,
  "date"            TIMESTAMP NOT NULL DEFAULT NOW(),
  "source"          TEXT NOT NULL DEFAULT 'manual', -- manual | api
  "created_at"      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by currency pair + date
CREATE INDEX IF NOT EXISTS "idx_exchange_rates_pair_date"
  ON "exchange_rates" ("base_currency", "target_currency", "date" DESC);

-- ── Invoices ────────────────────────────────────────────
-- exchange_rate: rate used at time of invoice (1 foreign = X AED)
-- base_currency_amount: total converted to AED
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "exchange_rate"        REAL NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "base_currency_amount" REAL NOT NULL DEFAULT 0;

-- Back-fill: AED invoices have rate=1 and base_currency_amount=total
UPDATE "invoices"
SET
  "exchange_rate"        = 1,
  "base_currency_amount" = COALESCE("total", 0)
WHERE "currency" = 'AED' OR "currency" IS NULL;

-- ── Receipts ────────────────────────────────────────────
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "exchange_rate"        REAL NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "base_currency_amount" REAL NOT NULL DEFAULT 0;

UPDATE "receipts"
SET
  "exchange_rate"        = 1,
  "base_currency_amount" = COALESCE("amount", 0)
WHERE "currency" = 'AED' OR "currency" IS NULL;

-- ── Journal Lines ───────────────────────────────────────
-- debit/credit remain the base-currency (AED) amounts.
-- foreign_* columns capture the original foreign currency detail.
ALTER TABLE "journal_lines"
  ADD COLUMN IF NOT EXISTS "foreign_currency" TEXT,
  ADD COLUMN IF NOT EXISTS "foreign_debit"    REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "foreign_credit"   REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exchange_rate"    REAL DEFAULT 1;

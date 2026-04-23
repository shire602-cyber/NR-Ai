-- Migration: Add bank_accounts table and extend bank_transactions
-- Adds managed bank account records linked to GL accounts, plus
-- match_status, balance, and bank_statement_account_id to bank_transactions.

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name_en" text NOT NULL,
  "bank_name" text NOT NULL,
  "account_number" text,
  "iban" text,
  "currency" text NOT NULL DEFAULT 'AED',
  "gl_account_id" uuid REFERENCES "accounts"("id"),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "bank_transactions"
  ADD COLUMN IF NOT EXISTS "bank_statement_account_id" uuid REFERENCES "bank_accounts"("id");
--> statement-breakpoint

ALTER TABLE "bank_transactions"
  ADD COLUMN IF NOT EXISTS "match_status" text NOT NULL DEFAULT 'unmatched';
--> statement-breakpoint

ALTER TABLE "bank_transactions"
  ADD COLUMN IF NOT EXISTS "balance" real;

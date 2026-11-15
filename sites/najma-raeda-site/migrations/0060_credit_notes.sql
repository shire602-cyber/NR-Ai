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

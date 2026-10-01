-- 0098_vendor_credit_notes: supplier credit / debit notes against vendor bills.
-- Raw-SQL tables, consistent with the bill-pay module (0010). Additive and idempotent.
--
-- A credit note reduces what we owe a vendor. Approval posts the reverse of the bill
-- entry (Dr A/P, Cr expense, Cr Input VAT; reverse-charge mirrored). Applying it to a
-- bill settles that bill's amount due without cash. Amounts are in the document
-- currency; the GL and VAT return convert at exchange_rate (like vendor_bills).

CREATE TABLE IF NOT EXISTS "vendor_credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vendor_name" text NOT NULL,
  "vendor_trn" text,
  "bill_id" uuid REFERENCES "vendor_bills"("id") ON DELETE SET NULL,
  "number" text NOT NULL,
  "vendor_reference" text,
  "date" date NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "exchange_rate" numeric(12,6) NOT NULL DEFAULT 1,
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total" numeric(15,2) NOT NULL DEFAULT 0,
  "reverse_charge" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'draft',
  "remaining_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "notes" text,
  "journal_entry_id" uuid,
  "void_journal_entry_id" uuid,
  "created_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp,
  "voided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vendor_credit_notes_status_check" CHECK ("status" IN ('draft', 'approved', 'void'))
);

CREATE TABLE IF NOT EXISTS "vendor_credit_note_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credit_note_id" uuid NOT NULL REFERENCES "vendor_credit_notes"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" numeric(15,4) NOT NULL DEFAULT 1,
  "unit_price" numeric(19,6) NOT NULL,
  "vat_rate" numeric(5,2) NOT NULL DEFAULT 5,
  "vat_supply_type" text NOT NULL DEFAULT 'standard',
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "line_total" numeric(15,2) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "vendor_credit_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "credit_note_id" uuid NOT NULL REFERENCES "vendor_credit_notes"("id") ON DELETE CASCADE,
  "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
  "amount" numeric(15,2) NOT NULL CHECK ("amount" > 0),
  "applied_at" timestamp NOT NULL DEFAULT now(),
  "applied_by" uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_vendor_credit_notes_company_number"
  ON "vendor_credit_notes"("company_id", "number");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_notes_company_date"
  ON "vendor_credit_notes"("company_id", "date");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_notes_bill_id"
  ON "vendor_credit_notes"("bill_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_note_lines_credit"
  ON "vendor_credit_note_lines"("credit_note_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_applications_credit"
  ON "vendor_credit_applications"("credit_note_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_applications_bill"
  ON "vendor_credit_applications"("bill_id");

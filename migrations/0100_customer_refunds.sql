-- 0100_customer_refunds: cash paid back to a customer against a credit note. Additive and idempotent.
--
-- A credit note that exceeds what the customer still owed (a paid invoice that is credited, or a credit
-- larger than the unpaid rest) leaves the customer with a credit. A refund pays that credit back:
-- Dr Accounts Receivable / Cr the bank account, dated refund_date. The amount is in the credit note's
-- currency; exchange_rate is AED per unit on the refund date (the cash side), the receivable is cleared
-- at the credit note's own rate and a difference goes to realised FX like an invoice payment.
-- A void keeps the row (voided_at, void_journal_entry_id) and posts the reversing entry.

CREATE TABLE IF NOT EXISTS "customer_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL,
  "credit_note_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "amount" numeric(15,2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "exchange_rate" numeric(15,6) NOT NULL DEFAULT 1,
  "refund_date" date NOT NULL,
  "bank_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "reference" text,
  "notes" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "voided_at" timestamp,
  "void_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_refunds_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_customer_refunds_company_id" ON "customer_refunds"("company_id");
CREATE INDEX IF NOT EXISTS "idx_customer_refunds_credit_note_id" ON "customer_refunds"("credit_note_id");
CREATE INDEX IF NOT EXISTS "idx_customer_refunds_contact_id" ON "customer_refunds"("contact_id");

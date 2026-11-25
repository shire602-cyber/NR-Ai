-- 0096_w3b_purchases (W3-B): procure-to-pay — bill state machine, payments with FX, vendor master,
-- debit notes, prepayments, recurring bills, PO receipts / 3-way match, expense-claim policies,
-- approval rules. Idempotent: every statement is a no-op on re-run (IF NOT EXISTS guards,
-- ON CONFLICT DO NOTHING seeds, duplicate-safe unique indexes). No posted data is edited.

-- ─── Vendor master (R04-16) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vendors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "name_ar" text,
  "trn" text,
  "email" text,
  "phone" text,
  "address" text,
  "emirate" text,
  "country" text NOT NULL DEFAULT 'AE',
  "payment_terms_days" integer NOT NULL DEFAULT 30,
  "currency" text NOT NULL DEFAULT 'AED',
  "default_expense_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "iban" text,
  "bank_name" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_vendors_company_id" ON "vendors"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vendors_company_trn"
  ON "vendors"("company_id", "trn") WHERE "trn" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vendors_company_lower_name"
  ON "vendors"("company_id", lower("name"));

-- ─── Approval rules (R04-19) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "document_type" text NOT NULL,
  "min_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "max_amount" numeric(15,2),
  "step_order" integer NOT NULL DEFAULT 1,
  "required_permission" text NOT NULL DEFAULT 'documents.approve',
  "required_role" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_approval_rules_company_doc"
  ON "approval_rules"("company_id", "document_type");

CREATE TABLE IF NOT EXISTS "approval_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,
  "rule_id" uuid REFERENCES "approval_rules"("id") ON DELETE SET NULL,
  "step_order" integer NOT NULL DEFAULT 1,
  "decision" text NOT NULL DEFAULT 'approved',
  "decided_by" uuid NOT NULL,
  "comment" text,
  "decided_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_document"
  ON "approval_decisions"("company_id", "document_type", "document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_approval_decisions_step"
  ON "approval_decisions"("document_type", "document_id", "step_order")
  WHERE "decision" = 'approved';

CREATE TABLE IF NOT EXISTS "approval_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "allow_single_member_self_approval" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- ─── Purchase orders: vendor link, maker-checker, receipts, 3-way match (R04-09/10/17) ─
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_id" uuid
  REFERENCES "vendors"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sent_to" text;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid;
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "account_id" uuid
  REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "quantity_received" real NOT NULL DEFAULT 0;
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "quantity_billed" real NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "purchase_order_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "received_date" timestamp NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_po_receipts_po" ON "purchase_order_receipts"("purchase_order_id");

CREATE TABLE IF NOT EXISTS "purchase_order_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "receipt_id" uuid NOT NULL REFERENCES "purchase_order_receipts"("id") ON DELETE CASCADE,
  "purchase_order_line_id" uuid NOT NULL REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE,
  "quantity" real NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_po_receipt_lines_receipt" ON "purchase_order_receipt_lines"("receipt_id");

-- ─── Vendor bills: state machine, VAT (R04-04, R04-21), FX, vendor link, attachments ─
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "vendor_id" uuid
  REFERENCES "vendors"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "place_of_supply" text;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "is_import" boolean NOT NULL DEFAULT false;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "customs_declaration_no" text;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "import_vat_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "designated_zone" boolean NOT NULL DEFAULT false;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "recoverable_vat_percent" numeric(5,2) NOT NULL DEFAULT 100;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "withholding_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid
  REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'manual';
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "origin_ref" text;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "attachment_path" text;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "attachment_name" text;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "voided_by" uuid;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "status_reason" text;
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_vendor_id" ON "vendor_bills"("vendor_id");

ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "vat_supply_type" text NOT NULL DEFAULT 'standard_rated';
ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "vat_amount" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "product_id" uuid;
ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "purchase_order_line_id" uuid
  REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL;

-- Payments: chosen cash/bank account, payment-date rate, base amounts, reversal rows (R14-05,
-- R04-13, R04-14). A voided payment keeps its row and gets an equal negative "reversal" row, so
-- every SUM(amount) reader (aging, FX exposure) nets it out without a status filter.
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'payment';
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "payment_account_id" uuid
  REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(12,6);
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "ap_amount_base" numeric(15,2);
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "cash_amount_base" numeric(15,2);
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "fx_difference" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "source_document_id" uuid;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "reverses_payment_id" uuid;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;
ALTER TABLE "bill_payments" ADD COLUMN IF NOT EXISTS "voided_by" uuid;

-- ─── Debit notes / vendor credits and vendor prepayments (R04-18) ────────────
CREATE TABLE IF NOT EXISTS "vendor_debit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "vendor_name" text NOT NULL,
  "debit_note_number" text NOT NULL,
  "bill_id" uuid REFERENCES "vendor_bills"("id") ON DELETE SET NULL,
  "note_date" timestamp NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "exchange_rate" numeric(12,6) NOT NULL DEFAULT 1,
  "subtotal" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "total_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "amount_applied" numeric(15,2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'open',
  "reason" text,
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_vendor_debit_notes_company" ON "vendor_debit_notes"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vendor_debit_notes_number"
  ON "vendor_debit_notes"("company_id", "debit_note_number");

CREATE TABLE IF NOT EXISTS "vendor_prepayments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "vendor_name" text NOT NULL,
  "payment_date" timestamp NOT NULL,
  "currency" text NOT NULL DEFAULT 'AED',
  "exchange_rate" numeric(12,6) NOT NULL DEFAULT 1,
  "amount" numeric(15,2) NOT NULL,
  "amount_applied" numeric(15,2) NOT NULL DEFAULT 0,
  "payment_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "reference" text,
  "status" text NOT NULL DEFAULT 'open',
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_vendor_prepayments_company" ON "vendor_prepayments"("company_id");

-- ─── Recurring bills (R04-18; job bills.recurring) ───────────────────────────
CREATE TABLE IF NOT EXISTS "recurring_bills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "template" jsonb NOT NULL,
  "frequency" text NOT NULL DEFAULT 'monthly',
  "next_run_on" date NOT NULL,
  "end_on" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_bill_id" uuid,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_recurring_bills_due" ON "recurring_bills"("is_active", "next_run_on");

-- ─── Document number sequences (R04-12: no COUNT(*)+1) ───────────────────────
CREATE TABLE IF NOT EXISTS "purchase_doc_sequences" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "doc_type" text NOT NULL,
  "next_value" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("company_id", "doc_type")
);
INSERT INTO "purchase_doc_sequences" ("company_id", "doc_type", "next_value")
SELECT c.company_id, 'expense_claim', c.n + 1
  FROM (SELECT company_id, COUNT(*)::int AS n FROM "expense_claims" GROUP BY company_id) c
ON CONFLICT ("company_id", "doc_type") DO NOTHING;

-- ─── Expense claims: policies, item VAT evidence, multi-currency, reimbursement (R04-12/20) ─
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "payment_account_id" uuid
  REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "paid_by" uuid;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "item_type" text NOT NULL DEFAULT 'expense';
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "quantity" numeric(12,4);
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "unit_rate" numeric(15,4);
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "supplier_trn" text;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "has_tax_invoice" boolean NOT NULL DEFAULT false;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "vat_recoverable" boolean NOT NULL DEFAULT false;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "original_currency" text;
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "original_amount" numeric(15,2);
ALTER TABLE "expense_claim_items" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(12,6);

CREATE TABLE IF NOT EXISTS "expense_claim_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "mileage_rate" numeric(15,4) NOT NULL DEFAULT 0,
  "per_diem_rate" numeric(15,2) NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_category_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "receipt_required" boolean NOT NULL DEFAULT false,
  "receipt_threshold" numeric(15,2) NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_expense_category_policies"
  ON "expense_category_policies"("company_id", lower("category"));

-- Claim numbers unique per company. Existing duplicates (from the old COUNT(*)+1 race) are left
-- untouched; the index is only created on databases without them (the sequence above prevents
-- new duplicates either way). scripts/qa/find-purchases-ledger-drift.mjs lists any duplicates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "expense_claims" WHERE "claim_number" IS NOT NULL
     GROUP BY "company_id", "claim_number" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "uniq_expense_claims_company_number"
      ON "expense_claims"("company_id", "claim_number");
  END IF;
END $$;

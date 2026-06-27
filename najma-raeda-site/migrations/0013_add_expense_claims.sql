CREATE TABLE IF NOT EXISTS "expense_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "claim_number" text,
  "title" text NOT NULL,
  "description" text,
  "total_amount" numeric(12,2) DEFAULT 0,
  "currency" text DEFAULT 'AED',
  "status" text DEFAULT 'draft',
  "submitted_at" timestamp,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "review_notes" text,
  "paid_at" timestamp,
  "payment_reference" text,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_claim_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "claim_id" uuid NOT NULL REFERENCES "expense_claims"("id") ON DELETE CASCADE,
  "expense_date" timestamp NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "receipt_url" text,
  "merchant_name" text,
  "created_at" timestamp DEFAULT now()
);

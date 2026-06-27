CREATE TABLE IF NOT EXISTS "corporate_tax_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "tax_period_start" timestamp NOT NULL,
  "tax_period_end" timestamp NOT NULL,
  "total_revenue" real NOT NULL DEFAULT 0,
  "total_expenses" real NOT NULL DEFAULT 0,
  "total_deductions" real NOT NULL DEFAULT 0,
  "taxable_income" real NOT NULL DEFAULT 0,
  "exemption_threshold" real NOT NULL DEFAULT 375000,
  "tax_rate" real NOT NULL DEFAULT 0.09,
  "tax_payable" real NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "filed_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "recurring_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "customer_name" text NOT NULL,
  "customer_trn" text,
  "currency" text NOT NULL DEFAULT 'AED',
  "frequency" text NOT NULL DEFAULT 'monthly',
  "start_date" timestamp NOT NULL,
  "next_run_date" timestamp NOT NULL,
  "end_date" timestamp,
  "lines_json" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_generated_invoice_id" uuid,
  "total_generated" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);

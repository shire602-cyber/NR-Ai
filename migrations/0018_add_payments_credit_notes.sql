-- Migration: Add invoice payments table, credit note support, and recurring invoice fields

-- Add recurring and credit note fields to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS original_invoice_id uuid REFERENCES invoices(id),
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_interval text,
  ADD COLUMN IF NOT EXISTS next_recurring_date timestamp,
  ADD COLUMN IF NOT EXISTS recurring_end_date timestamp;

-- Create invoice_payments table for detailed payment tracking
CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount real NOT NULL,
  date timestamp NOT NULL,
  method text NOT NULL DEFAULT 'bank',
  reference text,
  notes text,
  payment_account_id uuid REFERENCES accounts(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- Index for fast lookup by invoice
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_company_id ON invoice_payments(company_id);

-- Index for recurring invoice scheduler
CREATE INDEX IF NOT EXISTS idx_invoices_recurring ON invoices(is_recurring, next_recurring_date) WHERE is_recurring = true;

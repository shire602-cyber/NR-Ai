-- Add contact_id FK to invoices table.
-- Proper FK enables join-based lookups and future CRM features while keeping customerName for display.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_contact_id ON invoices (contact_id);

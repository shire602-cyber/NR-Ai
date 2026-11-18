-- 0129_wq1_sales_documents (WQ1 sales documents finished; W3-A sales): document language, source, attachments and the sent/viewed log of invoices.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only.
--
-- * invoices.document_language: the language the server PDF is printed in for this document
--   (en | ar; NULL = the company's locale, as before).
-- * invoices.source: where the document came from (app | api | recurring | quote | cash_sale |
--   import | shopify); the invoice list filters on it ("Source: API").
-- * invoice_attachments: files kept with an invoice (bytes in file storage under storage_key).
-- * invoice_events: the per-invoice log of emails (with their outbox id and honest status) and
--   share-link views.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_language text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';
CREATE INDEX IF NOT EXISTS idx_invoices_company_source ON invoices (company_id, source);

CREATE TABLE IF NOT EXISTS invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  storage_key text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice ON invoice_attachments (invoice_id);

CREATE TABLE IF NOT EXISTS invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  recipient text,
  status text,
  outbox_id uuid,
  user_id uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice_created ON invoice_events (invoice_id, created_at);

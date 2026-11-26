-- 0159_preserve_invoice_line_document_discounts (e-invoice posting audit).
-- Idempotent: keep the allocation made before the line quantity is stored as real.
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS document_discount_amount numeric(15,2);

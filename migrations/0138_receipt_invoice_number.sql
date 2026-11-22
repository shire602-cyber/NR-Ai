-- 0138_receipt_invoice_number (S2): Preserve document references entered during receipt review.
-- Idempotent: existing receipt rows keep a null reference until one is recorded.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS invoice_number text;

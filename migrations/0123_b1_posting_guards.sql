-- 0123_b1_posting_guards (B1 accounting re-audit; W4-B fixed assets / W3-A sales residual): asset disposals on credit are invoiced.
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- NH3: a fixed asset sold on credit is billed with a sales tax invoice (FDL 8/2017 Art. 65) that
-- carries the receivable, the aging and the output VAT. The disposal records the invoice it was
-- billed with; the VAT engine then reports the supply once, from the invoice.
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS disposal_invoice_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fixed_assets_disposal_invoice
  ON fixed_assets (disposal_invoice_id) WHERE disposal_invoice_id IS NOT NULL;

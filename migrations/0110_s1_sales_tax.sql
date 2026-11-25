-- 0110_s1_sales_tax (S1 final sweep, after W5-E): sales and tax residuals.
-- Idempotent: every statement can run twice.
--   * invoice_lines.margin_scheme / margin_purchase_cost: profit-margin scheme lines
--     (VAT Decree-Law Art. 29, second-hand goods); Box 1 reports the margin only.
--   * products.gtin / rcm_goods_type: item GTIN (PINT AE scheme 0160) and the domestic
--     reverse-charge goods type (BTAE-09 NatureCode) so AE-category invoices can be e-invoiced.
--   * invoices.restock: a credit note's "return to stock?" choice (false = write-off).

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS margin_scheme boolean NOT NULL DEFAULT false;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS margin_purchase_cost numeric(15, 2);

ALTER TABLE products ADD COLUMN IF NOT EXISTS gtin text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS rcm_goods_type text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS restock boolean;

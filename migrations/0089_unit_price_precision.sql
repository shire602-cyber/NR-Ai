-- 0089_unit_price_precision: keep 6 decimals on unit prices/costs and exact
-- decimal quantities. Unit prices were numeric(15,2), so 3 x 33.333333 was
-- stored as 3 x 33.33 = 99.99 while the document totals said 100.00, and the
-- VAT return recomputed from the mutated prices. Quantities were real
-- (single-precision float). Line amount/total columns stay numeric(15,2).
-- Widening only: no data is lost. Idempotent: re-running is a no-op.

ALTER TABLE invoice_lines
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

ALTER TABLE quote_lines
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

ALTER TABLE credit_note_lines
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

ALTER TABLE purchase_order_lines
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

ALTER TABLE service_invoice_lines
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

-- Vendor bill lines are written with raw SQL (bill-pay.routes.ts); same defect.
ALTER TABLE bill_line_items
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6),
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);

ALTER TABLE products
  ALTER COLUMN unit_price TYPE numeric(19,6) USING unit_price::numeric(19,6);

ALTER TABLE inventory_movements
  ALTER COLUMN unit_cost TYPE numeric(19,6) USING unit_cost::numeric(19,6);

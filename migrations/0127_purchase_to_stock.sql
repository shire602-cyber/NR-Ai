-- 0127_purchase_to_stock: the purchase-to-stock chain and refunds of customer credit. Additive and idempotent.
--
-- Bill lines and purchase-order lines name the product they buy (product_id); a bill can say which purchase order
-- it bills (purchase_order_id) so goods received earlier clear GRNI instead of being counted twice. Stock movements
-- carry their own date (movement_date) and the document they came from. Vendor-credit lines name the returned product.
-- (source_bill_id / source_vendor_credit_id are plain uuids: a foreign key would make a movement insert wait for the
-- document row lock the approval holds on another connection.)
-- customer_credit_refunds pays an overpayment credit (account 2050) back to the customer.

ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_credit_note_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "movement_date" timestamp;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_bill_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_vendor_credit_id" uuid;

CREATE INDEX IF NOT EXISTS "idx_bill_line_items_product_id" ON "bill_line_items"("product_id") WHERE "product_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_po" ON "inventory_movements"("purchase_order_id") WHERE "purchase_order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_bill" ON "inventory_movements"("source_bill_id") WHERE "source_bill_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "customer_credit_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "customer_contacts"("id") ON DELETE RESTRICT,
  "amount" numeric(15,2) NOT NULL,
  "refund_date" date NOT NULL,
  "bank_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "reference" text,
  "notes" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "voided_at" timestamp,
  "void_journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_credit_refunds_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "idx_customer_credit_refunds_contact" ON "customer_credit_refunds"("company_id", "contact_id");

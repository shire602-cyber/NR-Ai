-- 0099_inventory_costing
-- Weighted-average inventory costing and cost-of-goods-sold posting (Phase 6, stream B).
--
--  * invoice_lines.product_id / quote_lines.product_id: optional link to the product sold.
--  * products.track_inventory: only tracked products consume stock and post COGS on issue.
--  * products.average_cost: running weighted-average unit cost (6 dp).
--  * companies.inventory_costing_enabled: company-level switch for posting COGS to the ledger.
--  * inventory_movements.source_invoice_id: the invoice a movement was generated from.
-- Fully idempotent.

ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_invoice_lines_product_id" ON "invoice_lines" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_quote_lines_product_id" ON "quote_lines" ("product_id");

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_inventory" boolean NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "average_cost" numeric(19,6) NOT NULL DEFAULT 0;
-- Seed the running average with the cost price that was already on file (only on the first run).
UPDATE "products" SET "average_cost" = COALESCE("cost_price", 0) WHERE "average_cost" = 0 AND COALESCE("cost_price", 0) > 0;

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "inventory_costing_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_source_invoice_id" ON "inventory_movements" ("source_invoice_id");

-- 0101_inventory_ledger_tie_out
-- Inventory (account 1070) equals the sum of the products' stock values (Phase 6 review fixes).
--
--  * products.inventory_value: value of the stock on hand as the ledger holds it. Value goes in at
--    cost, comes out at the average, and the last unit out takes the remainder (no rounding residue).
--  * inventory_movements.total_cost: the exact value that moved with each movement; journals post it.
-- Fully idempotent. The backfill only touches rows that are still at their defaults.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "inventory_value" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "total_cost" numeric(15,2);

UPDATE "products"
   SET "inventory_value" = ROUND("current_stock" * "average_cost", 2)
 WHERE "track_inventory" = true AND "current_stock" > 0 AND "inventory_value" = 0;

UPDATE "inventory_movements"
   SET "total_cost" = ROUND("quantity" * COALESCE("unit_cost", 0), 2)
 WHERE "total_cost" IS NULL;

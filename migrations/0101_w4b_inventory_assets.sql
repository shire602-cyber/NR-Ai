-- 0101_w4b_inventory_assets: workstream W4-B — inventory costing + COGS, warehouses, stocktakes,
-- bundles, GRNI; fixed-asset classes, nullable useful life, method enum, audit trail; cost-centre
-- type / Arabic name and bill-line tagging. Idempotent: every statement is safe to re-run.

-- ── Products: inventory accounting fields (R10-14, R10-15) ───────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_type" text NOT NULL DEFAULT 'inventory';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_inventory" boolean NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "inventory_account_id" uuid;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cogs_account_id" uuid;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorder_point" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorder_quantity" integer;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_value" numeric(15,2) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_product_type_check') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_product_type_check"
      CHECK (product_type IN ('inventory', 'service', 'bundle'));
  END IF;
END $$;
--> statement-breakpoint

-- ── Inventory movements: cost, ledger and document links ─────────────────────
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "total_cost" numeric(15,2);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "movement_date" date;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_type" text;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_line_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "lot_number" text;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "serial_number" text;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reverses_movement_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reversed_by_movement_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "meta" jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_movements_idempotency"
  ON "inventory_movements" ("company_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_source"
  ON "inventory_movements" ("company_id", "source_type", "source_id");
--> statement-breakpoint

-- ── Settings, cost layers, warehouses, stock per location ────────────────────
CREATE TABLE IF NOT EXISTS "inventory_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "costing_method" text NOT NULL DEFAULT 'weighted_average',
  "allow_negative_stock" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_settings_method_check" CHECK (costing_method IN ('weighted_average', 'fifo'))
);

CREATE TABLE IF NOT EXISTS "inventory_cost_layers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "movement_id" uuid,
  "layer_date" date NOT NULL,
  "original_qty" integer NOT NULL,
  "remaining_qty" integer NOT NULL,
  "remaining_value" numeric(15,2) NOT NULL,
  "lot_number" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_inventory_cost_layers_product"
  ON "inventory_cost_layers" ("product_id", "layer_date");

CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "warehouses_company_code_unique" UNIQUE ("company_id", "code")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_warehouses_one_default"
  ON "warehouses" ("company_id") WHERE "is_default";

CREATE TABLE IF NOT EXISTS "inventory_stock_levels" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL DEFAULT 0,
  CONSTRAINT "inventory_stock_levels_product_warehouse" UNIQUE ("product_id", "warehouse_id")
);
--> statement-breakpoint

-- ── Stocktakes, bundles, goods received not invoiced ─────────────────────────
CREATE TABLE IF NOT EXISTS "stocktakes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "warehouse_id" uuid,
  "count_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "journal_entry_id" uuid,
  "created_by" uuid,
  "posted_by" uuid,
  "posted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "stocktakes_status_check" CHECK (status IN ('draft', 'posted'))
);
CREATE INDEX IF NOT EXISTS "idx_stocktakes_company" ON "stocktakes" ("company_id");

CREATE TABLE IF NOT EXISTS "stocktake_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "stocktake_id" uuid NOT NULL REFERENCES "stocktakes"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "system_qty" integer NOT NULL,
  "counted_qty" integer NOT NULL,
  "variance_qty" integer NOT NULL DEFAULT 0,
  "variance_value" numeric(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "product_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "bundle_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "component_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL,
  CONSTRAINT "product_components_bundle_component" UNIQUE ("bundle_product_id", "component_product_id"),
  CONSTRAINT "product_components_quantity_check" CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS "inventory_grni" (
  "purchase_order_line_id" uuid PRIMARY KEY,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL,
  "received_qty" integer NOT NULL DEFAULT 0,
  "received_value" numeric(15,2) NOT NULL DEFAULT 0,
  "cleared_qty" integer NOT NULL DEFAULT 0,
  "cleared_value" numeric(15,2) NOT NULL DEFAULT 0,
  "billed_ahead_qty" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- ── Cost centres: type + Arabic name; cost-centre tag on bill lines (R10-11, R10-18, R10-19) ──
ALTER TABLE "cost_centers" ADD COLUMN IF NOT EXISTS "name_ar" text;
ALTER TABLE "cost_centers" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'cost_centre';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_centers_type_check') THEN
    ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_type_check"
      CHECK (type IN ('cost_centre', 'project', 'job'));
  END IF;
END $$;
ALTER TABLE "bill_line_items" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
--> statement-breakpoint

-- ── Fixed assets (R10-04, R10-06, R10-17) ────────────────────────────────────
ALTER TABLE "fixed_assets" ALTER COLUMN "useful_life_years" DROP NOT NULL;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "asset_class_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "is_depreciable" boolean NOT NULL DEFAULT true;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "cost_account_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "accumulated_account_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "expense_account_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "tax_useful_life_years" integer;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "tax_depreciation_method" text;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "revaluation_surplus" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "impairment_loss" numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "capitalization_entry_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_entry_id" uuid;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "buyer_name" text;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_vat" numeric(15,2);
UPDATE "fixed_assets" SET "is_depreciable" = false
  WHERE lower(trim("category")) = 'land' AND "is_depreciable";
UPDATE "fixed_assets" SET "depreciation_method" = 'straight_line'
  WHERE "depreciation_method" IS NULL OR "depreciation_method" NOT IN ('straight_line', 'declining_balance');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_depreciation_method_check') THEN
    ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_method_check"
      CHECK (depreciation_method IN ('straight_line', 'declining_balance'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fixed_asset_classes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_depreciable" boolean NOT NULL DEFAULT true,
  "useful_life_years" integer,
  "depreciation_method" text NOT NULL DEFAULT 'straight_line',
  "cost_account_id" uuid,
  "accumulated_account_id" uuid,
  "expense_account_id" uuid,
  "tax_useful_life_years" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "fixed_asset_classes_company_code_unique" UNIQUE ("company_id", "code"),
  CONSTRAINT "fixed_asset_classes_method_check"
    CHECK (depreciation_method IN ('straight_line', 'declining_balance'))
);

CREATE TABLE IF NOT EXISTS "fixed_asset_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "event_date" date,
  "amount" numeric(15,2),
  "journal_entry_id" uuid,
  "details" jsonb,
  "actor_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fixed_asset_events_asset" ON "fixed_asset_events" ("asset_id", "created_at");

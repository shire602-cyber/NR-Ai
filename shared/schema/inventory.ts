// Products, inventory movements and inventory depth (W4-B).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { money, vatRateType } from "./columns";
import { companies } from "./companies";

// ===========================
// Products / Inventory
// ===========================
export const products = pgTable(
  "products",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    sku: text("sku"),
    description: text("description"),
    unitPrice: money("unit_price").notNull().default(0),
    costPrice: money("cost_price").default(0),
    vatRate: vatRateType("vat_rate").notNull().default(0.05),
    unit: text("unit").notNull().default("pcs"), // pcs, kg, m, hr, etc.
    currentStock: integer("current_stock").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").default(10),
    isActive: boolean("is_active").notNull().default(true),
    // W4-B (migration 0101): inventory accounting (R10-14, R10-15, R10-16).
    productType: text("product_type").notNull().default("inventory"), // inventory | service | bundle
    trackInventory: boolean("track_inventory").notNull().default(true),
    inventoryAccountId: uuid("inventory_account_id"), // default 1070
    cogsAccountId: uuid("cogs_account_id"), // default 5005
    reorderPoint: integer("reorder_point"),
    reorderQuantity: integer("reorder_quantity"),
    stockValue: money("stock_value").notNull().default(0), // value on hand (AED), == GL
    // S1 (migration 0110): e-invoicing item identity for domestic reverse charge (PINT AE).
    gtin: text("gtin"), // GTIN-8/12/13/14, scheme 0160
    rcmGoodsType: text("rcm_goods_type"), // RCM_GOODS_TYPE_CODES (BTAE-09), null = not RCM goods
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_products_company_id").on(table.companyId),
  })
);

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// ===========================
// Inventory Movements
// ===========================
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // purchase | sale | adjustment | return
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost"),
    reference: text("reference"), // e.g., "Invoice INV-001" or "Manual adjustment"
    notes: text("notes"),
    // W4-B (migration 0101): costing, ledger and document links.
    totalCost: money("total_cost"), // signed change in stock value (AED)
    movementDate: pgDate("movement_date"),
    sourceType: text("source_type"), // bill | invoice | credit_note | po_receipt | manual | stocktake | transfer | write_down
    sourceId: uuid("source_id"),
    sourceLineId: uuid("source_line_id"),
    journalEntryId: uuid("journal_entry_id"),
    warehouseId: uuid("warehouse_id"),
    lotNumber: text("lot_number"),
    serialNumber: text("serial_number"),
    reversesMovementId: uuid("reverses_movement_id"),
    reversedByMovementId: uuid("reversed_by_movement_id"),
    idempotencyKey: text("idempotency_key"),
    meta: jsonb("meta"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    productIdIdx: index("idx_inventory_movements_product_id").on(table.productId),
    companyIdIdx: index("idx_inventory_movements_company_id").on(table.companyId),
  })
);

export const insertInventoryMovementSchema = createInsertSchema(inventoryMovements).omit({
  id: true,
  createdAt: true,
});

export type InsertInventoryMovement = z.infer<typeof insertInventoryMovementSchema>;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;

// ===========================
// W4-B inventory depth (migration 0101): settings, cost layers, warehouses,
// stock per location, stocktakes, bundles and goods-received-not-invoiced.
// ===========================
export const inventorySettings = pgTable("inventory_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  costingMethod: text("costing_method").notNull().default("weighted_average"), // weighted_average | fifo
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InventorySettings = typeof inventorySettings.$inferSelect;

export const inventoryCostLayers = pgTable(
  "inventory_cost_layers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    movementId: uuid("movement_id"),
    layerDate: pgDate("layer_date").notNull(),
    originalQty: integer("original_qty").notNull(),
    remainingQty: integer("remaining_qty").notNull(),
    remainingValue: money("remaining_value").notNull(),
    lotNumber: text("lot_number"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("idx_inventory_cost_layers_product").on(table.productId, table.layerDate),
  })
);
export type InventoryCostLayer = typeof inventoryCostLayers.$inferSelect;

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyCodeUnique: unique("warehouses_company_code_unique").on(table.companyId, table.code),
  })
);
export type Warehouse = typeof warehouses.$inferSelect;

export const inventoryStockLevels = pgTable(
  "inventory_stock_levels",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
  },
  (table) => ({
    productWarehouseUnique: unique("inventory_stock_levels_product_warehouse").on(
      table.productId,
      table.warehouseId
    ),
  })
);
export type InventoryStockLevel = typeof inventoryStockLevels.$inferSelect;

export const stocktakes = pgTable(
  "stocktakes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id"),
    countDate: pgDate("count_date").notNull(),
    status: text("status").notNull().default("draft"), // draft | posted
    notes: text("notes"),
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_stocktakes_company").on(table.companyId),
  })
);
export type Stocktake = typeof stocktakes.$inferSelect;

export const stocktakeLines = pgTable("stocktake_lines", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  stocktakeId: uuid("stocktake_id")
    .notNull()
    .references(() => stocktakes.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  systemQty: integer("system_qty").notNull(),
  countedQty: integer("counted_qty").notNull(),
  varianceQty: integer("variance_qty").notNull().default(0),
  varianceValue: money("variance_value").notNull().default(0),
});
export type StocktakeLine = typeof stocktakeLines.$inferSelect;

export const productComponents = pgTable(
  "product_components",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bundleProductId: uuid("bundle_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    componentProductId: uuid("component_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (table) => ({
    bundleComponentUnique: unique("product_components_bundle_component").on(
      table.bundleProductId,
      table.componentProductId
    ),
  })
);
export type ProductComponent = typeof productComponents.$inferSelect;

export const inventoryGrni = pgTable("inventory_grni", {
  purchaseOrderLineId: uuid("purchase_order_line_id").primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  receivedQty: integer("received_qty").notNull().default(0),
  receivedValue: money("received_value").notNull().default(0),
  clearedQty: integer("cleared_qty").notNull().default(0),
  clearedValue: money("cleared_value").notNull().default(0),
  billedAheadQty: integer("billed_ahead_qty").notNull().default(0),
});
export type InventoryGrni = typeof inventoryGrni.$inferSelect;

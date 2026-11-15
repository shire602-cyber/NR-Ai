/**
 * Inventory write contracts (W4-B: R10-01, R10-09, R10-14 .. R10-16). companyId is server-owned.
 * Extends the W2-D product contract with costing / ledger fields.
 */
import { z } from "zod";
import { createProductBody, updateProductBody } from "./products";
import { zDate, zMoneyFils, zText, zUuid } from "./primitives";

export const PRODUCT_TYPES = ["inventory", "service", "bundle"] as const;
export const COSTING_METHODS = ["weighted_average", "fifo"] as const;

const inventoryProductFields = {
  productType: z.enum(PRODUCT_TYPES).optional(),
  trackInventory: z.boolean().optional(),
  inventoryAccountId: zUuid.optional().nullable(),
  cogsAccountId: zUuid.optional().nullable(),
  reorderPoint: z.number().int().nonnegative().optional().nullable(),
  reorderQuantity: z.number().int().nonnegative().optional().nullable(),
};

export const createInventoryProductBody = createProductBody.extend({
  ...inventoryProductFields,
  openingStockDate: zDate.optional(),
});
export type CreateInventoryProductBody = z.output<typeof createInventoryProductBody>;

export const updateInventoryProductBody = updateProductBody.extend(inventoryProductFields);
export type UpdateInventoryProductBody = z.output<typeof updateInventoryProductBody>;

const lot = zText(64).optional().nullable();

export const stockMovementBody = z
  .object({
    type: z.enum(["purchase", "sale", "adjustment", "return"]),
    quantity: z
      .number({ invalid_type_error: "Quantity must be a number" })
      .int("Quantity must be an integer")
      .refine((n) => n !== 0, { message: "Quantity must not be zero" }),
    unitCost: zMoneyFils.optional().nullable(),
    date: zDate.optional(),
    counterAccountId: zUuid.optional().nullable(),
    warehouseId: zUuid.optional().nullable(),
    lotNumber: lot,
    serialNumber: lot,
    reference: zText(255).optional().nullable(),
    notes: zText(2000).optional().nullable(),
  })
  .refine((v) => v.type === "adjustment" || v.quantity > 0, {
    message:
      "Quantity must be positive: the movement type sets the direction. Use type 'adjustment' for a signed stock-take correction.",
    path: ["quantity"],
  });
export type StockMovementBody = z.output<typeof stockMovementBody>;

export const inventorySettingsBody = z
  .object({
    costingMethod: z.enum(COSTING_METHODS).optional(),
    allowNegativeStock: z.boolean().optional(),
  })
  .refine((v) => v.costingMethod !== undefined || v.allowNegativeStock !== undefined, {
    message: "Nothing to update",
  });
export type InventorySettingsBody = z.output<typeof inventorySettingsBody>;

export const writeDownBody = z.object({
  amount: zMoneyFils.refine((n) => n > 0, "Amount must be greater than zero"),
  date: zDate.optional(),
  reason: zText(500, { min: 1 }),
});
export type WriteDownBody = z.output<typeof writeDownBody>;

export const warehouseBody = z.object({
  code: zText(32, { min: 1 }),
  name: zText(255, { min: 1 }),
  nameAr: zText(255).optional().nullable(),
  isDefault: z.boolean().optional(),
});
export type WarehouseBody = z.output<typeof warehouseBody>;

export const updateWarehouseBody = warehouseBody
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateWarehouseBody = z.output<typeof updateWarehouseBody>;

export const transferBody = z.object({
  productId: zUuid,
  fromWarehouseId: zUuid,
  toWarehouseId: zUuid,
  quantity: z.number().int().positive(),
  date: zDate.optional(),
  lotNumber: lot,
  notes: zText(2000).optional().nullable(),
});
export type TransferBody = z.output<typeof transferBody>;

export const stocktakeBody = z.object({
  warehouseId: zUuid.optional().nullable(),
  countDate: zDate,
  notes: zText(2000).optional().nullable(),
  lines: z
    .array(z.object({ productId: zUuid, countedQty: z.number().int().nonnegative() }).strict())
    .min(1)
    .max(5000),
});
export type StocktakeBody = z.output<typeof stocktakeBody>;

export const bundleComponentsBody = z.object({
  components: z
    .array(z.object({ productId: zUuid, quantity: z.number().int().positive() }).strict())
    .max(100),
});
export type BundleComponentsBody = z.output<typeof bundleComponentsBody>;

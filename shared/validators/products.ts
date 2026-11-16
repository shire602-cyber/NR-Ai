/**
 * Product + inventory-movement write contracts (W2-D: R10-03, R10-07, R17-09).
 * companyId is server-owned (taken from the URL / the product row).
 */
import { z } from "zod";
import { zText } from "./primitives";
import { isValidGtin, RCM_GOODS_TYPES } from "../vat-classification";

const money = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Must be a non-negative amount with at most 2 decimal places",
    });
    return z.NEVER;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n > 999_999_999_999.99) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount is out of range" });
    return z.NEVER;
  }
  return n;
});

const vatRate = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1, "VAT rate must be a fraction 0..1");

const sku = z
  .union([z.literal(""), zText(64), z.null()])
  .transform((v) => (v === "" || v === null ? null : v));

/** GTIN (GS1, 8/12/13/14 digits, check digit verified); "" or null clears it. */
const gtin = z.union([z.literal(""), z.string().trim(), z.null()]).transform((v, ctx) => {
  if (v === "" || v === null) return null;
  if (!isValidGtin(v)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "GTIN must be 8, 12, 13 or 14 digits with a valid check digit",
    });
    return z.NEVER;
  }
  return v;
});

const productFields = {
  name: zText(255, { min: 1 }),
  nameAr: zText(255).optional().nullable(),
  sku: sku.optional(),
  description: zText(2000).optional().nullable(),
  unitPrice: money,
  costPrice: money.optional().nullable(),
  vatRate: vatRate.optional(),
  unit: zText(32, { min: 1 }).optional(),
  lowStockThreshold: z.number().int().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
  // S1 (W4-C follow-up): e-invoicing identity for domestic reverse-charge goods.
  gtin: gtin.optional(),
  rcmGoodsType: z.enum(RCM_GOODS_TYPES).optional().nullable(),
};

export const createProductBody = z.object({
  ...productFields,
  // Opening stock only; later changes go through inventory movements.
  currentStock: z.number().int().nonnegative().optional(),
});
export type CreateProductBody = z.output<typeof createProductBody>;

/** Stock is never edited directly: record a movement (adjustment) instead. */
export const updateProductBody = z.object(productFields).partial();
export type UpdateProductBody = z.output<typeof updateProductBody>;

export const inventoryMovementBody = z
  .object({
    type: z.enum(["purchase", "sale", "adjustment", "return"]),
    quantity: z
      .number({
        error: (iss) =>
          iss.code === "invalid_type" && iss.input !== undefined
            ? "Quantity must be a number"
            : undefined,
      })
      .int("Quantity must be an integer")
      .refine((n) => n !== 0, { message: "Quantity must not be zero" }),
    unitCost: money.optional().nullable(),
    reference: zText(255).optional().nullable(),
    notes: zText(2000).optional().nullable(),
  })
  // Direction is carried by `type`; only an adjustment may be signed.
  .refine((v) => v.type === "adjustment" || v.quantity > 0, {
    message:
      "Quantity must be positive: the movement type sets the direction. Use type 'adjustment' for a signed stock-take correction.",
    path: ["quantity"],
  });
export type InventoryMovementBody = z.output<typeof inventoryMovementBody>;

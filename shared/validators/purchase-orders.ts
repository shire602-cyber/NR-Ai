/**
 * Purchase order write contracts (W3-B: R04-06, R04-09, R04-10, R04-17).
 * `number`, `status`, `companyId` and totals are server-owned (strictBody rejects them).
 */
import { z } from "zod";
import { zCurrency, zDate, zEmail, zMoney, zSupplyType, zText, zTrn, zUuid } from "./primitives";
import { zBillVatRate, zFxRate, zPositiveQuantity } from "./bills";

export const zPoQuantity = zPositiveQuantity.refine((n) => n <= 1e9, "Quantity is out of range");

export const poLineSchema = z
  .object({
    description: zText(500, { min: 1 }),
    quantity: zPoQuantity,
    unitPrice: zMoney,
    /** 0 or 5 (percent; 0.05 accepted). Stored as 0 / 0.05. */
    vatRate: zBillVatRate.optional().nullable(),
    vatSupplyType: zSupplyType.optional().nullable(),
    productId: zUuid.optional().nullable(),
    accountId: zUuid.optional().nullable(),
  })
  .strict();
export type PoLineInput = z.output<typeof poLineSchema>;

const poFields = {
  vendorId: zUuid.optional().nullable(),
  vendorName: zText(255, { min: 1 }),
  vendorTrn: z
    .union([zTrn, z.literal("").transform(() => null)])
    .optional()
    .nullable(),
  date: zDate,
  expectedDeliveryDate: zDate.optional().nullable(),
  currency: zCurrency.optional(),
  notes: zText(2000).optional().nullable(),
  lines: z.array(poLineSchema).min(1, "At least one line is required").max(500),
};

export const poCreateSchema = z.object(poFields);
export type PoCreateInput = z.output<typeof poCreateSchema>;

export const poUpdateSchema = z
  .object({
    ...poFields,
    vendorName: poFields.vendorName.optional(),
    date: poFields.date.optional(),
    lines: poFields.lines.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type PoUpdateInput = z.output<typeof poUpdateSchema>;

export const poCancelSchema = z.object({ reason: zText(500).optional().nullable() });

export const poSendSchema = z.object({
  /** Email the PO to the vendor. Without it the PO is marked sent (delivered manually). */
  to: zEmail.optional().nullable(),
  message: zText(2000).optional().nullable(),
});

const poQuantityLine = z.object({ lineId: zUuid, quantity: zPoQuantity }).strict();

export const poReceiveSchema = z.object({
  receivedDate: zDate.optional(),
  notes: zText(1000).optional().nullable(),
  /** Omit to receive every outstanding quantity. */
  lines: z.array(poQuantityLine).min(1).max(500).optional(),
});
export type PoReceiveInput = z.output<typeof poReceiveSchema>;

export const poConvertSchema = z.object({
  billNumber: zText(64).optional().nullable(),
  billDate: zDate.optional(),
  dueDate: zDate.optional().nullable(),
  exchangeRate: zFxRate.optional().nullable(),
  /** Omit to bill everything received and not yet billed (or ordered, when nothing is tracked). */
  // Keep the original quantity for validation with the route's INVALID_QUANTITY code.
  lines: z
    .array(poQuantityLine.extend({ quantity: z.union([z.number(), z.string()]) }))
    .min(1)
    .max(500)
    .optional(),
});
export type PoConvertInput = z.output<typeof poConvertSchema>;

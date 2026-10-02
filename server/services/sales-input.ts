// Request-body handling shared by the sales document routes (Phase 8 D1).
//
// Invoices and quotes used to spread the whole request body into the insert, so a client could set
// `invoiceType`, `status`, `salesOrderId` or `lateFeeForInvoiceId` (mass assignment). Only the fields below
// are taken from a body; everything the server owns (status, type, links, totals) is set by the server.

import { z } from "zod";

/** Header fields a client may set on an invoice. */
export const INVOICE_WRITABLE_FIELDS = [
  "customerName",
  "customerTrn",
  "customerAddress",
  "dueDate",
  "paymentTerms",
  "currency",
  "exchangeRate",
  "contactId",
  "reverseCharge",
  "emirate",
] as const;

/** Header fields a client may set on a quote. */
export const QUOTE_WRITABLE_FIELDS = [
  "customerName",
  "customerTrn",
  "contactId",
  "expiryDate",
  "currency",
  "notes",
] as const;

export function pickWritable<T extends Record<string, unknown>>(
  body: T | null | undefined,
  allowed: readonly string[]
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object") return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key) && (body as any)[key] !== undefined) {
      out[key] = (body as any)[key];
    }
  }
  return out;
}

/** The document discount a client sends: `discountType` percent | amount and `discountValue`. */
export const documentDiscountSchema = z.object({
  discountType: z.enum(["percent", "amount"]).nullable().optional(),
  discountValue: z.coerce.number().finite().min(0).max(9_000_000_000_000).nullable().optional(),
});

export type DocumentDiscountInput = z.infer<typeof documentDiscountSchema>;

export const lineDiscountFields = {
  lineKind: z.enum(["item", "shipping"]).optional().default("item"),
  discountType: z.enum(["percent", "amount"]).optional().nullable(),
  discountValue: z.coerce.number().finite().min(0).max(9_000_000_000_000).optional().nullable(),
  // The price list the unit price came from (checked against the company by the route).
  priceListId: z.string().uuid("priceListId must be a valid UUID").optional().nullable(),
  // The sales order line this line bills (only honoured on an invoice made from that order).
  salesOrderLineId: z.string().uuid("salesOrderLineId must be a valid UUID").optional().nullable(),
};

// Line schemas and totals shared by the invoice routes and the credit-note service.
// Moved out of invoices.routes.ts unchanged (Phase 8 D1 extraction), plus the Phase 8 line fields.

import { z } from "zod";
import Decimal from "decimal.js";
import { UAE_VAT_RATE } from "../constants";
import { deriveVatSupplyType } from "./vat-supply-type";
import { requiredQuantity, requiredUnitPrice } from "./document-line-limits";
import { lineDiscountFields } from "./sales-input";

// The document total must fit numeric(15,2) (largest value 9,999,999,999,999.99)
// with room for the VAT uplift. Per-line quantity / unit-price limits live in
// document-line-limits (shared with quotes, credit notes, POs, recurring).
export const MAX_DOCUMENT_TOTAL = 9_000_000_000_000; // 9 trillion

export const invoiceLineObject = z.object({
  description: z.string().trim().min(1, "Line description is required").max(1000),
  quantity: requiredQuantity,
  unitPrice: requiredUnitPrice,
  // UAE has exactly two VAT rates: 0% (zero-rated/exempt lines) and 5%
  // (standard). Accept either decimal (0.05) or percent (5) form — a typo
  // like 0.5 must be rejected, not silently baked into a tax invoice.
  vatRate: z.coerce
    .number()
    .finite()
    .transform((v) => (v === 5 ? UAE_VAT_RATE : v))
    .pipe(
      z.number().refine((v) => v === 0 || v === UAE_VAT_RATE, {
        message: "VAT rate must be 0% or 5% (UAE)",
      })
    )
    .default(UAE_VAT_RATE),
  // Optional: standard_rated | zero_rated | exempt | out_of_scope. Normalised
  // below so a 0% line is never stored as standard-rated by default.
  vatSupplyType: z
    .enum(["standard_rated", "zero_rated", "exempt", "out_of_scope"])
    .optional()
    .nullable(),
  // Optional income account for this line's net amount (null = default account).
  revenueAccountId: z.string().uuid("revenueAccountId must be a valid UUID").optional().nullable(),
  // Optional product sold on this line. With "Post inventory to ledger" on, issuing the invoice
  // consumes its stock and posts cost of goods sold (inventory-costing.service).
  productId: z.string().uuid("productId must be a valid UUID").optional().nullable(),
  // Phase 8 D2: the project this line bills; revenue posts tagged with it. Absent on an update = keep the old line's.
  projectId: z.string().uuid("projectId must be a valid UUID").optional().nullable(),
  // Phase 8 D1: `shipping` marks the (single) delivery line; the discount belongs to this line.
  ...lineDiscountFields,
});

// The RATE decides the supply type (deriveVatSupplyType): a taxed line is
// always standard-rated, whatever type was sent.
export const withDerivedSupplyType = <T extends { vatRate: number; vatSupplyType?: string | null }>(
  line: T
) => ({
  ...line,
  vatSupplyType: deriveVatSupplyType(line.vatRate, line.vatSupplyType),
});

export const invoiceLineInputSchema = invoiceLineObject.transform(withDerivedSupplyType);

// A credit-note line may name the original invoice line it credits, so the
// revenue account is resolved from that id instead of matching descriptions.
export const creditNoteLineInputSchema = invoiceLineObject
  .extend({ originalLineId: z.string().uuid("originalLineId must be a valid UUID").optional().nullable() })
  .transform(withDerivedSupplyType);

export const invoiceLinesInputSchema = z
  .array(invoiceLineInputSchema)
  .min(1, "At least one invoice line is required");

export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;
export type CreditNoteLineInput = z.infer<typeof creditNoteLineInputSchema>;

export function calculateInvoiceTotals(lines: InvoiceLineInput[]) {
  let subtotalD = new Decimal(0);
  let vatAmountD = new Decimal(0);

  for (const line of lines) {
    const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
    subtotalD = subtotalD.plus(lineTotal);
    vatAmountD = vatAmountD.plus(lineTotal.times(line.vatRate ?? UAE_VAT_RATE));
  }

  return {
    subtotal: subtotalD.toDecimalPlaces(2).toNumber(),
    vatAmount: vatAmountD.toDecimalPlaces(2).toNumber(),
    total: subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber(),
  };
}

export const round2Num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;


/**
 * Sales-document write contracts (W3-A: R07-01, R03-02, R03-03, R03-07, R03-10, R03-20).
 *
 * Server-owned fields (companyId, status, number, totals, journalEntryId, exchange-rate-derived
 * base amounts, share tokens, e-invoice state, ...) are never declared here, so `strictBody`
 * rejects them with a 400 VALIDATION_ERROR instead of spreading them into a Drizzle write.
 * Line objects are `.strict()` too: an unknown line field (e.g. a misspelt discount) is a 400,
 * never silently dropped.
 */
import { z } from "zod";
import { toFils } from "../money";
import { normaliseSupportedVatRate } from "../vat-classification";
import {
  SUPPLY_TYPES,
  zCurrency,
  zDate,
  zDateIn,
  zEmirate,
  zText,
  zTrn,
  zUuid,
} from "./primitives";

/** Money in major units with at most 2 decimals, strictly positive → integer fils. */
export const zPositiveFils = z.union([z.number(), z.string()]).transform((value, ctx) => {
  try {
    const fils = toFils(value);
    if (fils <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    return fils;
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "Invalid amount",
    });
    return z.NEVER;
  }
});

/** Line quantity: > 0, at most 4 decimals. */
export const zLineQuantity = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const s = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(s) || Number(s) <= 0 || Number(s) > 1e9) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Line quantity must be greater than 0 with at most 4 decimal places",
    });
    return z.NEVER;
  }
  return Number(s);
});

/**
 * VAT rate: 0, 5 / 0.05 (UAE) or 15 / 0.15 (KSA) → decimal. The company's jurisdiction is checked
 * when the lines are priced (resolveSupplyType: a 15% line on a UAE company is a 400).
 */
export const zInvoiceVatRate = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const r = normaliseSupportedVatRate(value);
  if (r === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "VAT rate must be 0% or 5% (UAE), or 15% for a KSA company",
    });
    return z.NEVER;
  }
  return r;
});

export const DISCOUNT_TYPES = ["amount", "percent"] as const;
export const zDiscountType = z.enum(DISCOUNT_TYPES);

/** Discount value: amount (2dp) or percent (0..100, up to 4dp). Checked against type in refine. */
export const zDiscountValue = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).trim())))
  .refine((n) => Number.isFinite(n) && n >= 0, "Discount must be zero or more");

export function discountRefine(
  v: { discountType?: string | null; discountValue?: number | null },
  ctx: z.RefinementCtx
) {
  const hasType = v.discountType != null;
  const hasValue = v.discountValue != null;
  if (hasType !== hasValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasType ? "discountValue" : "discountType"],
      message: "discountType and discountValue must be given together",
    });
    return;
  }
  if (!hasType) return;
  const value = v.discountValue as number;
  if (v.discountType === "percent") {
    if (value > 100 || !/^\d+(?:\.\d{1,4})?$/.test(String(value))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Percent discount must be between 0 and 100 with at most 4 decimals",
      });
    }
  } else {
    try {
      toFils(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Amount discount must have at most 2 decimal places",
      });
    }
  }
}

const lineShape = {
  description: zText(1000, { min: 1 }),
  quantity: zLineQuantity,
  unitPrice: zPositiveFils,
  vatRate: zInvoiceVatRate.optional(),
  /** standard_rated | zero_rated | exempt | out_of_scope | reverse_charge (R07-01). */
  vatSupplyType: z.enum(SUPPLY_TYPES).optional().nullable(),
  discountType: zDiscountType.optional().nullable(),
  discountValue: zDiscountValue.optional().nullable(),
  productId: zUuid.optional().nullable(),
  costCenterId: zUuid.optional().nullable(),
};

export const salesLineInputSchema = z.object(lineShape).strict().superRefine(discountRefine);
export type SalesLineInput = z.output<typeof salesLineInputSchema>;

export const salesLinesSchema = z
  .array(salesLineInputSchema)
  .min(1, "At least one invoice line is required")
  .max(500, "An invoice can carry at most 500 lines");

/** Money in major units with at most 2 decimals, zero or more → integer fils. */
export const zNonNegativeFils = z.union([z.number(), z.string()]).transform((value, ctx) => {
  try {
    const fils = toFils(value);
    if (fils < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount cannot be negative" });
      return z.NEVER;
    }
    return fils;
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "Invalid amount",
    });
    return z.NEVER;
  }
});

/**
 * Invoice lines add the profit-margin scheme (S1, R07-15; VAT Decree-Law Art. 29, second-hand
 * goods): `marginScheme: true` makes the line price VAT-inclusive with VAT on the margin over
 * `marginPurchaseCost` (the line's purchase cost, major units, fils after parsing).
 */
export const invoiceLineInputSchema = z
  .object({
    ...lineShape,
    marginScheme: z.boolean().optional(),
    marginPurchaseCost: zNonNegativeFils.optional().nullable(),
    /** E3 (J1-r3): the income account a standard-rated line posts to (null = by item type). */
    revenueAccountId: zUuid.optional().nullable(),
  })
  .strict()
  .superRefine(discountRefine)
  .superRefine((v, ctx) => {
    if (v.marginScheme && (v.marginPurchaseCost === undefined || v.marginPurchaseCost === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["marginPurchaseCost"],
        message: "A profit-margin scheme line needs its purchase cost",
      });
    }
    if (v.marginScheme && v.vatSupplyType && v.vatSupplyType !== "standard_rated") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vatSupplyType"],
        message: "The profit-margin scheme applies to standard-rated supplies only",
      });
    }
  });
export type InvoiceLineInput = z.output<typeof invoiceLineInputSchema>;

export const invoiceLinesSchema = z
  .array(invoiceLineInputSchema)
  .min(1, "At least one invoice line is required")
  .max(500, "An invoice can carry at most 500 lines");

export const zPaymentTerms = z
  .string()
  .trim()
  .regex(/^(due_on_receipt|net\d{1,3}|custom)$/, "Payment terms must be due_on_receipt or netN");

/** WQ1: languages a sales document can be printed in (the PDF engine's locales). */
export const DOCUMENT_LANGUAGES = ["en", "ar"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** WQ1: where an invoice came from (invoices.source). */
export const INVOICE_SOURCES = [
  "app",
  "api",
  "recurring",
  "quote",
  "cash_sale",
  "import",
  "shopify",
] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

const zExchangeRateInput = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine(
    (n) => Number.isFinite(n) && n > 0 && n < 1_000_000 && /^\d+(\.\d{1,6})?$/.test(String(n)),
    "Exchange rate must be positive with at most 6 decimals"
  );

/** Invoice dates: a supply that has happened (today + 1 day tolerance for timezone skew). */
const zInvoiceDate = zDateIn({ maxDaysAhead: 1 });

export const invoiceHeaderShape = {
  contactId: zUuid.optional().nullable(),
  customerName: zText(300).optional(),
  customerTrn: z
    .union([zTrn, z.literal("")])
    .optional()
    .nullable()
    // Omitted stays undefined (keep the stored TRN on PUT); only explicit null / "" clears it.
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  customerAddress: zText(1000).optional().nullable(),
  date: zInvoiceDate,
  dueDate: zDate.optional().nullable(),
  supplyDate: zInvoiceDate.optional().nullable(),
  paymentTerms: zPaymentTerms.optional().nullable(),
  currency: zCurrency.optional(),
  exchangeRate: zExchangeRateInput.optional().nullable(),
  reverseCharge: z.boolean().optional(),
  placeOfSupplyEmirate: zEmirate.optional().nullable(),
  discountType: zDiscountType.optional().nullable(),
  discountValue: zDiscountValue.optional().nullable(),
  notes: zText(4000).optional().nullable(),
  templateId: zUuid.optional().nullable(),
  /** WQ1: the PDF language of this document (null = the company's locale). */
  documentLanguage: z.enum(DOCUMENT_LANGUAGES).optional().nullable(),
  lines: invoiceLinesSchema,
};

export const createInvoiceSchema = z
  .object(invoiceHeaderShape)
  .strict()
  .superRefine(discountRefine);
export type CreateInvoiceInput = z.output<typeof createInvoiceSchema>;

/** PUT /api/invoices/:id — same fields, all optional (drafts only, except EDITABLE_AFTER_ISSUE). */
export const updateInvoiceSchema = z
  .object({
    ...invoiceHeaderShape,
    date: zInvoiceDate.optional(),
    lines: invoiceLinesSchema.optional(),
  })
  .strict()
  .superRefine(discountRefine);
export type UpdateInvoiceInput = z.output<typeof updateInvoiceSchema>;

/** Fields an issued tax invoice may still change (they do not alter the supply or the tax). */
export const EDITABLE_AFTER_ISSUE = [
  "notes",
  "paymentTerms",
  "dueDate",
  "documentLanguage",
] as const;

/** PATCH /api/invoices/:id/status — issue / void / cancel only. Payment goes through /payments. */
export const INVOICE_STATUS_TARGETS = ["sent", "posted", "void", "cancelled"] as const;
export const invoiceStatusSchema = z
  .object({
    status: z.string().trim(),
    reason: zText(500).optional(),
  })
  .strict();

/** Credit note against an invoice. Omit `lines` (or send {}) to credit the remaining balance. */
export const creditNoteRequestSchema = z
  .object({
    lines: salesLinesSchema.optional(),
    /** S1: product lines go back into stock (default) or are written off (false). */
    restock: z.boolean().optional(),
    reason: zText(500).optional(),
    date: zInvoiceDate.optional(),
  })
  .strict();
export type CreditNoteRequest = z.output<typeof creditNoteRequestSchema>;

/** Debit note: an additional charge against an issued invoice (its own DN- numbering). */
export const debitNoteRequestSchema = z
  .object({
    lines: salesLinesSchema,
    reason: zText(500).optional(),
    date: zInvoiceDate.optional(),
  })
  .strict();
export type DebitNoteRequest = z.output<typeof debitNoteRequestSchema>;

/** Pagination query for GET /api/companies/:id/invoices. */
export const invoiceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
  all: z.enum(["true", "false"]).optional(),
  status: z.string().max(40).optional(),
  type: z.enum(["invoice", "credit_note", "debit_note"]).optional(),
  /** WQ1 (13.5): "Source: API" and the other origins. */
  source: z.enum(INVOICE_SOURCES).optional(),
});

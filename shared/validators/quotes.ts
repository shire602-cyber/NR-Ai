/**
 * Quote and recurring-invoice-template write contracts (W3-A: R03-11, R03-12, R03-23, R03-24).
 *
 * Same line contract as invoices (shared/validators/invoices.ts): supply type per line,
 * discounts, strict objects. `number`, `status`, `convertedInvoiceId`, `companyId` and totals
 * are server-owned and rejected by strictBody.
 */
import { z } from "zod";
import {
  salesLinesSchema,
  zDiscountType,
  zDiscountValue,
  zLineQuantity,
  zPaymentTerms,
} from "./invoices";
import { zCurrency, zDate, zEmail, zEmirate, zText, zTrn, zUuid } from "./primitives";

const trn = z
  .union([zTrn, z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const quoteShape = {
  contactId: zUuid.optional().nullable(),
  customerName: zText(300).optional(),
  customerTrn: trn,
  customerAddress: zText(1000).optional().nullable(),
  date: zDate,
  expiryDate: zDate.optional().nullable(),
  currency: zCurrency.optional(),
  paymentTerms: zPaymentTerms.optional().nullable(),
  placeOfSupplyEmirate: zEmirate.optional().nullable(),
  discountType: zDiscountType.optional().nullable(),
  discountValue: zDiscountValue.optional().nullable(),
  notes: zText(4000).optional().nullable(),
  lines: salesLinesSchema,
};

export const createQuoteSchema = z.object(quoteShape).strict();
export type CreateQuoteInput = z.output<typeof createQuoteSchema>;

export const updateQuoteSchema = z
  .object({ ...quoteShape, date: zDate.optional(), lines: salesLinesSchema.optional() })
  .strict();
export type UpdateQuoteInput = z.output<typeof updateQuoteSchema>;

export const QUOTE_STATUS_TARGETS = ["sent", "accepted", "declined", "expired"] as const;
export const quoteStatusSchema = z.object({ status: z.enum(QUOTE_STATUS_TARGETS) }).strict();

/**
 * Convert (all or part of) a quote to a draft invoice. Omit `lines` to bill
 * everything not yet billed; give `{ quoteLineId, quantity }` for progress
 * billing (partial invoices).
 */
export const convertQuoteSchema = z
  .object({
    date: zDate.optional(),
    lines: z
      .array(z.object({ quoteLineId: zUuid, quantity: zLineQuantity }).strict())
      .min(1)
      .max(500)
      .optional(),
  })
  .strict();
export type ConvertQuoteInput = z.output<typeof convertQuoteSchema>;

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;

const recurringShape = {
  contactId: zUuid.optional().nullable(),
  customerName: zText(300).optional(),
  customerTrn: trn,
  customerAddress: zText(1000).optional().nullable(),
  currency: zCurrency.optional(),
  frequency: z.enum(RECURRING_FREQUENCIES),
  startDate: zDate,
  endDate: zDate.optional().nullable(),
  paymentTerms: zPaymentTerms.optional().nullable(),
  placeOfSupplyEmirate: zEmirate.optional().nullable(),
  /** true: generated invoices are issued (posted); false: left as drafts for review. */
  autoIssue: z.boolean().optional(),
  /** Email each issued invoice to `sendToEmail` through the configured email provider. */
  autoSend: z.boolean().optional(),
  sendToEmail: zEmail.optional().nullable(),
  lines: salesLinesSchema,
};

export const createRecurringInvoiceSchema = z
  .object(recurringShape)
  .strict()
  .superRefine((v, ctx) => {
    if (v.autoSend && !v.sendToEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sendToEmail"],
        message: "sendToEmail is required when autoSend is on",
      });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "endDate is before startDate",
      });
    }
  });
export type CreateRecurringInvoiceInput = z.output<typeof createRecurringInvoiceSchema>;

export const updateRecurringInvoiceSchema = z
  .object({
    ...recurringShape,
    frequency: z.enum(RECURRING_FREQUENCIES).optional(),
    startDate: zDate.optional(),
    nextRunDate: zDate.optional(),
    lines: salesLinesSchema.optional(),
  })
  .strict();
export type UpdateRecurringInvoiceInput = z.output<typeof updateRecurringInvoiceSchema>;

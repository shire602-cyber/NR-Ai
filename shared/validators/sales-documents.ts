/**
 * WQ1 sales-document write contracts: invoice attachments, one receipt applied across several
 * invoices (Receive payment), a cash sale and sending a quote by email.
 *
 * Amounts are integer fils after parsing. Status, numbers, totals and journal ids stay
 * server-owned (strictBody answers 400 for anything not declared here).
 */
import { z } from "zod";
import { discountRefine, invoiceHeaderShape, zNonNegativeFils, zPositiveFils } from "./invoices";
import { zDate, zEmail, zText, zUuid } from "./primitives";

const zPaymentRate = z.coerce.number().finite().positive().max(1_000_000).optional().nullable();

/** POST /api/invoices/:id/attachments — base64 data URL (max ~7 MB decoded). */
export const invoiceAttachmentBody = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    data: z.string().min(1).max(10_000_000),
  })
  .strict();
export type InvoiceAttachmentBody = z.output<typeof invoiceAttachmentBody>;

export const receivePaymentAllocationSchema = z
  .object({ invoiceId: zUuid, amount: zPositiveFils })
  .strict();

/**
 * POST /api/companies/:companyId/receive-payments — one receipt from a customer applied to
 * several open invoices. `amount` is what the customer paid, in the invoices' currency;
 * anything above the allocations becomes a customer credit. `bankFee` (company base currency)
 * is what the bank kept: the bank account receives amount - fee.
 */
export const receivePaymentSchema = z
  .object({
    contactId: zUuid.optional().nullable(),
    customerName: zText(300).optional().nullable(),
    paymentAccountId: zUuid,
    date: zDate,
    amount: zPositiveFils,
    /** Base-currency units per 1 invoice-currency unit on the receipt date (realised FX). */
    exchangeRate: zPaymentRate,
    bankFee: zNonNegativeFils.optional().nullable(),
    method: zText(40).optional(),
    reference: zText(200).optional().nullable(),
    notes: zText(1000).optional().nullable(),
    allocations: z
      .array(receivePaymentAllocationSchema)
      .min(1, "Apply the payment to at least one invoice")
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.allocations.map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocations"],
        message: "Each invoice can be listed once",
      });
    }
    const applied = v.allocations.reduce((s, a) => s + a.amount, 0);
    if (applied > v.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocations"],
        message: "The amounts applied are more than the payment",
      });
    }
  });
export type ReceivePaymentInput = z.output<typeof receivePaymentSchema>;

/**
 * POST /api/companies/:companyId/cash-sales — an invoice paid on the spot: the customer is
 * optional ("Cash customer"), the paid-through cash/bank account is required.
 */
const cashSaleBuyerTypeSchema = z.enum(["consumer", "business", "government"]);

export const cashSaleEInvoiceBuyerSchema = z
  .object({ buyerType: cashSaleBuyerTypeSchema, contactId: zUuid.optional() })
  .strict()
  .superRefine(({ buyerType, contactId }, ctx) => {
    if (buyerType === "consumer" ? !!contactId : !contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contactId"],
        message:
          buyerType === "consumer" ? "Remove the contact for a consumer" : "Choose a buyer contact",
      });
    }
  });

export type CashSaleEInvoiceBuyer = z.output<typeof cashSaleEInvoiceBuyerSchema>;

export const cashSaleSchema = z
  .object({
    ...invoiceHeaderShape,
    customerName: zText(300).optional().nullable(),
    buyerType: cashSaleBuyerTypeSchema.optional(),
    paymentAccountId: zUuid,
    method: zText(40).optional(),
    reference: zText(200).optional().nullable(),
  })
  .strict()
  .superRefine(discountRefine);
export type CashSaleInput = z.output<typeof cashSaleSchema>;

/** POST /api/quotes/:id/send-email — the quote PDF goes through the email outbox. */
export const quoteSendEmailSchema = z
  .object({
    to: zEmail,
    subject: zText(300).optional(),
    message: zText(5000).optional(),
  })
  .strict();
export type QuoteSendEmailInput = z.output<typeof quoteSendEmailSchema>;

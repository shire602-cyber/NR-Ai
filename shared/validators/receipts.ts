/**
 * Receipt write contracts (W2-D: R05-01, R05-03, R05-05, R05-19b, R17-02, R17-09).
 *
 * Server-owned fields (companyId, posted, autoPosted, journalEntryId, uploadedBy, imagePath,
 * contentSha256, ...) are never declared here, so `strictBody` rejects them with a 400.
 */
import { z } from "zod";
import { filsToNumber, toFils } from "../money";
import { sanitizePlainText, zCurrency, zDate, zText, zUuid } from "./primitives";

function amountSchema(kind: "positive" | "nonNegative") {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    try {
      const fils = toFils(value);
      if (kind === "positive" && fils <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
        return z.NEVER;
      }
      if (kind === "nonNegative" && fils < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be zero or more" });
        return z.NEVER;
      }
      return filsToNumber(fils);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : "Invalid amount",
      });
      return z.NEVER;
    }
  });
}

/** Amount in major units as a JS number (receipt columns are numeric(15,2) mapped to number). */
const zAmountPositive = amountSchema("positive");
const zAmountNonNegative = amountSchema("nonNegative");

const zExchangeRate = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0 && n < 1_000_000, "Exchange rate must be positive");

export const receiptLineSchema = z
  .object({
    accountId: zUuid,
    amount: zAmountPositive,
    vatAmount: zAmountNonNegative.optional().nullable(),
    costCenterId: zUuid.optional().nullable(),
    description: zText(200).optional().nullable(),
  })
  .strict();
export type ReceiptLineInput = z.output<typeof receiptLineSchema>;

const clippedText = (max: number) =>
  z.string().transform((v) => sanitizePlainText(v).slice(0, max));

const merchant = zText(200).optional().nullable();
const invoiceNumber = zText(200).optional().nullable();
const vatAmount = zAmountNonNegative.optional().nullable();
const currency = zCurrency.optional();
const exchangeRate = zExchangeRate.optional();
const category = zText(100).optional().nullable();
const accountId = zUuid.optional().nullable();
const lines = z.array(receiptLineSchema).min(1).max(50).optional().nullable();

/** Cross-field rule shared by every receipt write: VAT can never exceed the amount. */
function refineReceipt(v: { amount?: number; vatAmount?: number | null }, ctx: z.RefinementCtx) {
  if (v.amount !== undefined && v.vatAmount != null && v.vatAmount > v.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatAmount"],
      message: "VAT amount cannot exceed the receipt amount",
    });
  }
}

export const createReceiptBody = z
  .object({
    merchant,
    invoiceNumber,
    date: zDate,
    // When `lines` are supplied the route derives amount/vatAmount from them.
    amount: zAmountPositive.optional(),
    vatAmount,
    currency,
    exchangeRate,
    category,
    accountId,
    paymentAccountId: accountId,
    reverseCharge: z.boolean().optional(),
    rawText: zText(50_000).optional().nullable(),
    supplierTrn: z.string().max(40).optional().nullable(),
    lines,
    // Upload + classifier metadata handled by the route (never stored as-is).
    imageData: z.string().max(25_000_000).optional().nullable(),
    // Classifier metadata is advisory: sanitised and truncated rather than rejected.
    suggestedCategory: clippedText(100).optional().nullable(),
    classifierMethod: clippedText(40).optional().nullable(),
    classifierConfidence: z.number().finite().optional().nullable(),
    classifierReason: clippedText(500).optional().nullable(),
    confirmDuplicate: z.boolean().optional(),
  })
  .superRefine(refineReceipt)
  .superRefine((v, ctx) => {
    if (v.amount === undefined && !v.lines) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Required" });
    }
  });
export type CreateReceiptBody = z.output<typeof createReceiptBody>;

export const updateReceiptBody = z
  .object({
    merchant,
    invoiceNumber,
    date: zDate.optional(),
    amount: zAmountPositive.optional(),
    vatAmount,
    currency,
    exchangeRate,
    category,
    accountId,
    paymentAccountId: accountId,
    reverseCharge: z.boolean().optional(),
    supplierTrn: z.string().max(40).optional().nullable(),
    lines,
  })
  .superRefine(refineReceipt);
export type UpdateReceiptBody = z.output<typeof updateReceiptBody>;

export const postReceiptBody = z
  .object({
    accountId,
    paymentAccountId: zUuid,
  })
  .strict();
export type PostReceiptBody = z.output<typeof postReceiptBody>;

export const reviseReceiptBody = z
  .object({
    merchant,
    invoiceNumber,
    date: zDate.optional(),
    amount: zAmountPositive.optional(),
    vatAmount,
    currency,
    exchangeRate,
    category,
    accountId,
    paymentAccountId: accountId,
    reverseCharge: z.boolean().optional(),
    lines,
    reason: zText(500).optional().nullable(),
  })
  .superRefine(refineReceipt);
export type ReviseReceiptBody = z.output<typeof reviseReceiptBody>;

export const splitReceiptBody = z
  .object({
    parts: z
      .array(
        z
          .object({
            merchant,
            date: zDate.optional(),
            amount: zAmountPositive,
            vatAmount,
            category,
          })
          .strict()
          .superRefine(refineReceipt)
      )
      .min(2)
      .max(20),
  })
  .strict();
export type SplitReceiptBody = z.output<typeof splitReceiptBody>;

/** Midnight-UTC Date for a canonical YYYY-MM-DD string. */
export function receiptDateToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

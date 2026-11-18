/**
 * VAT write contracts (W4-E). Used with `strictBody`: unknown and server-owned keys are a 400.
 * TRNs are validated on every VAT write path: 15 digits starting with 100.
 */
import { z } from "zod";
import { validateUaeTrn } from "../receipt-ocr-parser";
import { zDate, zEmirate, zText, zUuid } from "./primitives";

/** UAE TRN: 15 digits, starts with 100 (spaces and dashes are ignored). */
export const zUaeTrn = z.string().transform((value, ctx) => {
  const v = validateUaeTrn(value);
  if (!v.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.issue ?? "Invalid TRN" });
    return z.NEVER;
  }
  return v.trn as string;
});

/** Optional TRN where an empty string means "none". */
export const zOptionalUaeTrn = z
  .union([z.literal(""), zUaeTrn])
  .optional()
  .nullable()
  // Omitted stays undefined; only explicit null / "" clears it.
  .transform((v) => (v === undefined ? undefined : v ? v : null));

const zAmount = z.coerce
  .number()
  .finite()
  .min(-1e12)
  .max(1e12)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "At most 2 decimals");

export const VAT_WORKPAPER_ROW_CATEGORIES = [
  "standard_sale",
  "tourist_refund",
  "reverse_charge_output",
  "zero_rated_sale",
  "exempt_sale",
  "import",
  "import_adjustment",
  "standard_expense",
  "reverse_charge_input",
  "manual_adjustment",
] as const;

const rowFields = {
  rowCategory: z.enum(VAT_WORKPAPER_ROW_CATEGORIES),
  vat201Box: z.string().trim().max(60).optional().nullable(),
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  documentDate: z.string().max(40).optional().nullable(),
  counterpartyName: z.string().trim().max(255).optional().nullable(),
  counterpartyTrn: zOptionalUaeTrn,
  emirate: z.string().trim().max(80).optional().nullable(),
  taxableAmount: zAmount.optional().nullable(),
  vatAmount: zAmount.optional().nullable(),
  adjustmentAmount: zAmount.optional().nullable(),
  grossAmount: zAmount.optional().nullable(),
  status: z.enum(["draft", "approved", "excluded"]).optional(),
  sourceMethod: z.enum(["manual", "ocr", "import", "generated"]).optional(),
  sourceDocumentType: z.string().trim().max(80).optional().nullable(),
  sourceDocumentId: zUuid.optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  auditReason: z.string().trim().max(2000).optional().nullable(),
  vatOverrideReason: z.string().trim().max(2000).optional().nullable(),
};

export const vatWorkpaperRowBody = z.object(rowFields).strict();
export const vatWorkpaperRowPatchBody = z.object(rowFields).partial().strict();
export const vatWorkpaperBulkRowsBody = z
  .object({ rows: z.array(vatWorkpaperRowBody).min(1).max(2000) })
  .strict();
export const vatWorkpaperBulkStatusBody = z
  .object({
    to: z.enum(["approved", "excluded"]),
    rowIds: z.array(zUuid).max(2000).optional(),
  })
  .strict();

export const VAT_WORKPAPER_STATES = ["draft", "prepared", "reviewed", "filed", "locked"] as const;
export const vatWorkpaperStatusBody = z
  .object({
    // Legacy names are accepted and mapped: in_review/ready -> prepared, generated -> reviewed.
    status: z.enum([...VAT_WORKPAPER_STATES, "in_review", "ready", "generated"]),
    notes: z.string().trim().max(4000).optional().nullable(),
    reason: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

export const createCompanyVatWorkpaperBody = z
  .object({
    periodStart: z.string().max(40),
    periodEnd: z.string().max(40),
    dueDate: z.string().max(40).optional().nullable(),
    notes: z.string().trim().max(4000).optional().nullable(),
  })
  .strict();

export const generateVatReturnBody = z.object({ periodStart: zDate, periodEnd: zDate }).strict();

export const submitVatReturnBody = z
  .object({
    adjustmentAmount: zAmount.optional().nullable(),
    adjustmentReason: zText(2000).optional().nullable(),
    notes: zText(4000).optional().nullable(),
    ftaReferenceNumber: z.string().trim().max(100).optional().nullable(),
    reconciliationOverrideReason: zText(2000).optional().nullable(),
    declarantName: zText(200).optional().nullable(),
    declarantPosition: zText(200).optional().nullable(),
    /** E2 (J3-r2): the day the return was filed on EmaraTax (with ftaReferenceNumber). */
    filedOn: zDate.optional().nullable(),
  })
  .strict();

/**
 * Only descriptive fields; boxes come from the engine and change through adjustments. E2
 * (J3-r2): payment status is not editable here; it follows the settlement entry
 * (POST /api/vat-returns/:id/settlement), so the return and the ledger cannot disagree.
 */
export const patchVatReturnBody = z
  .object({
    notes: zText(4000).optional().nullable(),
    declarantName: zText(200).optional().nullable(),
    declarantPosition: zText(200).optional().nullable(),
  })
  .strict();

export const markVatReturnReadyBody = z
  .object({ overrideReason: zText(2000).optional().nullable() })
  .strict();

export const amendVatReturnBody = z.object({ reason: zText(2000, { min: 3 }) }).strict();

/** POST /api/vat-returns/:id/settlement: the VAT paid to (or refunded by) the FTA. */
export const settleVatReturnBody = z
  .object({
    date: zDate,
    paymentAccountId: zUuid,
    reference: zText(200).optional().nullable(),
  })
  .strict();

/** POST /api/vat-returns/:id/settlement/reverse */
export const reverseVatReturnSettlementBody = z
  .object({ date: zDate, reason: zText(1000, { min: 3 }) })
  .strict();

export const VAT_RETURN_ADJUSTMENT_KINDS = [
  "tourist_refund",
  "import_adjustment",
  "output_correction",
  "input_correction",
  "voluntary_disclosure_output",
  "voluntary_disclosure_input",
] as const;

export const vatReturnAdjustmentBody = z
  .object({
    periodStart: zDate,
    periodEnd: zDate,
    kind: z.enum(VAT_RETURN_ADJUSTMENT_KINDS),
    emirate: zEmirate.optional().nullable(),
    amount: zAmount.default(0),
    vatAmount: zAmount,
    reason: zText(2000, { min: 3 }),
    reference: zText(120).optional().nullable(),
    correctsPeriodStart: zDate.optional().nullable(),
    correctsPeriodEnd: zDate.optional().nullable(),
  })
  .strict();

export const badDebtReliefClaimBody = z
  .object({
    invoiceId: zUuid,
    claimDate: zDate,
    writtenOff: z.boolean(),
    customerNotified: z.boolean(),
    customerNotifiedAt: zDate.optional().nullable(),
    notes: zText(2000).optional().nullable(),
  })
  .strict();

export const badDebtReliefReverseBody = z
  .object({ date: zDate, reason: zText(2000, { min: 3 }) })
  .strict();

export const vatRecoveryRuleBody = z
  .object({
    matchType: z.enum(["category", "account_code", "account_id"]),
    matchValue: zText(200, { min: 1 }),
    recoverablePercent: z.coerce.number().min(0).max(100),
    label: zText(200, { min: 1 }),
  })
  .strict();

export const vatGroupBody = z
  .object({
    name: zText(200, { min: 1 }),
    groupTrn: zUaeTrn,
    memberCompanyIds: z.array(zUuid).max(100),
  })
  .strict();

export const vatAutopilotStatusBody = z
  .object({
    companyId: zUuid,
    status: z.enum(["draft", "ready", "submitted", "accepted"]),
    ftaReferenceNumber: z.string().trim().min(1).max(100).optional(),
    overrideReason: zText(2000).optional().nullable(),
  })
  .strict();

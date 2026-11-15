/**
 * Request schemas for the corporate-tax module (W4-A: R08-04, R08-06,
 * R08-09, R08-15..R08-19). Mounted with strictBody on the server; the client
 * can reuse them for form validation.
 */
import { z } from "zod";
import { CT_ACCOUNT_TAX_TAGS, CT_ADJUSTMENT_CATEGORY_KEYS } from "../ct-workpaper";
import { parseIsoDate, zDateIn, zMoneyFils, zMoneyFilsSigned, zText, zUuid } from "./primitives";

/** Non-negative AED amount (≤ 2 dp, finite, numeric(15,2)) → number. */
export const zCtAmount = zMoneyFils.transform((fils) => fils / 100);
/** Signed AED amount → number. */
export const zCtSignedAmount = zMoneyFilsSigned.transform((fils) => fils / 100);

const zCtDate = zDateIn({ min: "2023-01-01", maxDaysAhead: 3700 });

/** Adjustment category is a closed enum; the category fixes sign and share (R08-06). */
export const zCtAdjustmentCategory = z.enum(CT_ADJUSTMENT_CATEGORY_KEYS as [string, ...string[]]);

export const ctAdjustmentSchema = z
  .object({
    id: zText(80, { min: 1 }),
    category: zCtAdjustmentCategory,
    amount: zCtAmount,
    label: zText(200).optional(),
    notes: zText(1000).optional(),
    source: z.enum(["manual", "ledger"]).optional(),
    accountId: zUuid.optional(),
  })
  .strict();
export type CtAdjustmentInput = z.output<typeof ctAdjustmentSchema>;

export const ctAdjustmentsSchema = z.array(ctAdjustmentSchema).max(200);

export const ctWorkpaperRowSchema = z
  .object({
    id: zText(120, { min: 1 }),
    label: zText(200, { min: 1 }),
    type: z.enum(["revenue", "expense"]),
    amount: zCtAmount,
    notes: zText(1000).optional(),
  })
  .strict();

const ctInterestSchema = z
  .object({
    netInterestExpense: zCtSignedAmount.optional(),
    depreciationAmortisation: zCtAmount.optional(),
  })
  .strict();

const ctQfzpOverrideSchema = z
  .object({
    qualifyingRevenue: zCtAmount.optional(),
    nonQualifyingRevenue: zCtAmount.optional(),
    nonQualifyingTaxableIncome: zCtAmount.optional(),
  })
  .strict();

/** Longest tax period accepted: 18 months (first period may be 6..18 months, FDL Art. 57). */
export const CT_MAX_PERIOD_DAYS = 550;
export const CT_MIN_PERIOD_DAYS = 28;

function periodDays(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  );
}

/** Create: period required and sane; figures optional (pulled from books when absent). */
export const createCtReturnSchema = z
  .object({
    taxPeriodStart: zCtDate,
    taxPeriodEnd: zCtDate,
    totalRevenue: zCtAmount.optional(),
    totalExpenses: zCtAmount.optional(),
    totalDeductions: zCtAmount.optional(),
    adjustments: ctAdjustmentsSchema.optional(),
    smallBusinessReliefElected: z.boolean().optional(),
    relatedPartyNotes: zText(5000).optional(),
    workpaper: z
      .object({
        source: z.enum(["manual_workpaper", "journal_calculation"]).optional(),
        rows: z.array(ctWorkpaperRowSchema).max(2000),
      })
      .passthrough()
      .optional(),
    notes: zText(5000).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const days = periodDays(v.taxPeriodStart, v.taxPeriodEnd);
    if (days <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taxPeriodEnd"],
        message: "taxPeriodEnd must be after taxPeriodStart",
      });
    } else if (days < CT_MIN_PERIOD_DAYS || days > CT_MAX_PERIOD_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taxPeriodEnd"],
        message: `Tax period must be between ${CT_MIN_PERIOD_DAYS} days and 18 months`,
      });
    }
  });
export type CreateCtReturnBody = z.output<typeof createCtReturnSchema>;

/** PATCH: only editable fields of a draft/computed return. Status and rates are not here. */
export const patchCtReturnSchema = z
  .object({
    taxPeriodStart: zCtDate.optional(),
    taxPeriodEnd: zCtDate.optional(),
    totalRevenue: zCtAmount.optional(),
    totalExpenses: zCtAmount.optional(),
    totalDeductions: zCtAmount.optional(),
    adjustments: ctAdjustmentsSchema.optional(),
    smallBusinessReliefElected: z.boolean().optional(),
    relatedPartyNotes: zText(5000).nullable().optional(),
    notes: zText(5000).nullable().optional(),
  })
  .strict();
export type PatchCtReturnBody = z.output<typeof patchCtReturnSchema>;

export const computeCtReturnSchema = z
  .object({
    adjustments: ctAdjustmentsSchema.optional(),
    smallBusinessReliefElected: z.boolean().optional(),
    relatedPartyNotes: zText(5000).nullable().optional(),
    interest: ctInterestSchema.optional(),
    qfzp: ctQfzpOverrideSchema.optional(),
  })
  .strict();
export type ComputeCtReturnBody = z.output<typeof computeCtReturnSchema>;

export const CT_TRANSITION_TARGETS = ["computed", "reviewed", "filed", "paid", "void"] as const;

export const transitionCtReturnSchema = z
  .object({
    to: z.enum(CT_TRANSITION_TARGETS),
    /** Filing: the reference number shown by EmaraTax after manual upload. */
    filingReference: zText(120).optional(),
    /** Filing: post the CT provision (Dr tax expense / Cr CT payable). */
    postProvision: z.boolean().optional(),
    note: zText(1000).optional(),
  })
  .strict();
export type TransitionCtReturnBody = z.output<typeof transitionCtReturnSchema>;

export const amendCtReturnSchema = z.object({ reason: zText(1000, { min: 3 }) }).strict();

export const ctProfileSchema = z
  .object({
    isQfzp: z.boolean().optional(),
    freeZone: zText(120).nullable().optional(),
    mneGroupRevenue: zCtAmount.nullable().optional(),
    incorporationDate: zDateIn({ min: "1950-01-01", maxDaysAhead: 0 }).nullable().optional(),
    tradeLicenceExpiry: zDateIn({ min: "2000-01-01", maxDaysAhead: 3700 }).nullable().optional(),
    exciseRegistered: z.boolean().optional(),
    uboLastConfirmed: zDateIn({ min: "2000-01-01", maxDaysAhead: 0 }).nullable().optional(),
    einvoicingRevenueBand: z.enum(["ge_50m", "lt_50m"]).nullable().optional(),
  })
  .strict();
export type CtProfileBody = z.output<typeof ctProfileSchema>;

export const ctAdviserConfirmationSchema = z
  .object({
    adviserName: zText(200, { min: 2 }),
    note: zText(2000).optional(),
  })
  .strict();

export const ctRelatedPartySchema = z
  .object({
    name: zText(200, { min: 1 }),
    relationship: z.enum(["related_party", "connected_person"]),
    jurisdiction: zText(120).nullable().optional(),
    nature: zText(500).nullable().optional(),
    periodYear: z.number().int().min(2023).max(2100).nullable().optional(),
    transactionValue: zCtAmount.optional(),
    notes: zText(2000).nullable().optional(),
  })
  .strict();
export type CtRelatedPartyBody = z.output<typeof ctRelatedPartySchema>;

export const ctAccountTagSchema = z
  .object({
    accountId: zUuid,
    taxTag: z.enum(CT_ACCOUNT_TAX_TAGS).nullable(),
  })
  .strict();

/** Query-string date helper for the calculate endpoint. */
export function readCtDate(value: unknown): string | null {
  return parseIsoDate(value);
}

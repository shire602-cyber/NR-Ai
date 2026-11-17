/**
 * Fixed-asset write contracts (W4-B: R10-04, R10-06, R10-08, R10-17). companyId, status and
 * journal ids are server-owned. Money is parsed to integer fils.
 */
import { z } from "zod";
import { zDate, zMoneyFils, zPeriodMonth, zPeriodYear, zText, zUuid } from "./primitives";

export const DEPRECIATION_METHODS = ["straight_line", "declining_balance"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

/** Categories that never depreciate (IAS 16: land has an unlimited useful life). */
export const NON_DEPRECIABLE_CATEGORIES = ["land"] as const;
export const isNonDepreciableCategory = (category: string | null | undefined): boolean =>
  (NON_DEPRECIABLE_CATEGORIES as readonly string[]).includes((category ?? "").trim().toLowerCase());

const optText = (max: number) =>
  z
    .union([zText(max), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v));

const lifeYears = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    // Omitted stays undefined so PATCH keeps the stored life; null / "" clears it.
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Useful life must be 1-100 whole years",
      });
      return z.NEVER;
    }
    return n;
  });

const method = z.enum(DEPRECIATION_METHODS, {
  error: () => "depreciationMethod must be straight_line or declining_balance",
});

const assetFields = {
  assetName: zText(255, { min: 1 }),
  assetNameAr: optText(255),
  assetNumber: optText(64),
  category: zText(64, { min: 1 }),
  assetClassId: zUuid.optional().nullable(),
  purchaseDate: zDate,
  purchaseCost: zMoneyFils,
  salvageValue: zMoneyFils.optional().nullable(),
  usefulLifeYears: lifeYears,
  depreciationMethod: method.optional().nullable(),
  taxUsefulLifeYears: lifeYears,
  taxDepreciationMethod: method.optional().nullable(),
  costCenterId: zUuid.optional().nullable(),
  costAccountId: zUuid.optional().nullable(),
  accumulatedAccountId: zUuid.optional().nullable(),
  expenseAccountId: zUuid.optional().nullable(),
  location: optText(255),
  serialNumber: optText(128),
  notes: optText(2000),
};

export const createFixedAssetBody = z
  .object({
    ...assetFields,
    paymentAccountId: zUuid.optional().nullable(),
    /** X4: recoverable input VAT paid with the asset (fils); needs a payment account. */
    inputVat: zMoneyFils.optional().nullable(),
  })
  .refine((v) => !v.inputVat || !!v.paymentAccountId, {
    message: "Input VAT needs the account the asset was paid from",
    path: ["inputVat"],
  })
  .refine((v) => (v.salvageValue ?? 0) <= v.purchaseCost, {
    message: "salvageValue cannot exceed purchaseCost",
    path: ["salvageValue"],
  });
export type CreateFixedAssetBody = z.output<typeof createFixedAssetBody>;

export const updateFixedAssetBody = z
  .object({
    assetName: assetFields.assetName.optional(),
    assetNameAr: assetFields.assetNameAr,
    assetNumber: assetFields.assetNumber,
    category: assetFields.category.optional(),
    purchaseDate: assetFields.purchaseDate.optional(),
    purchaseCost: assetFields.purchaseCost.optional(),
    salvageValue: assetFields.salvageValue,
    usefulLifeYears: assetFields.usefulLifeYears,
    depreciationMethod: assetFields.depreciationMethod,
    taxUsefulLifeYears: assetFields.taxUsefulLifeYears,
    taxDepreciationMethod: assetFields.taxDepreciationMethod,
    costCenterId: assetFields.costCenterId,
    location: assetFields.location,
    serialNumber: assetFields.serialNumber,
    notes: assetFields.notes,
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type UpdateFixedAssetBody = z.output<typeof updateFixedAssetBody>;

export const depreciatePeriodBody = z.object({
  month: zPeriodMonth.optional(),
  year: zPeriodYear.optional(),
});
export type DepreciatePeriodBody = z.output<typeof depreciatePeriodBody>;

export const runDepreciationBody = z.object({ month: zPeriodMonth, year: zPeriodYear });
export type RunDepreciationBody = z.output<typeof runDepreciationBody>;

export const capitalizeBody = z
  .object({
    paymentAccountId: zUuid.optional().nullable(),
    /** Capitalise an asset already owned at go-live against Opening Balance Equity (3040). */
    openingBalance: z.boolean().optional(),
    date: zDate.optional(),
  })
  .refine((v) => !!v.paymentAccountId !== (v.openingBalance === true), {
    message: "Give either paymentAccountId or openingBalance: true",
  });
export type CapitalizeBody = z.output<typeof capitalizeBody>;

export const DISPOSAL_VAT_TREATMENTS = [
  "standard",
  "zero_rated",
  "exempt",
  "out_of_scope",
] as const;

export const disposeBody = z
  .object({
    disposalDate: zDate,
    /** Net proceeds (excluding VAT). 0 for a scrapping. */
    disposalAmount: zMoneyFils.optional().default(0),
    /** Cash / bank account receiving the money. Default 1010 Cash on Hand. */
    proceedsAccountId: zUuid.optional().nullable(),
    /** Sold on credit: debit Accounts Receivable (1040) instead of cash. */
    onCredit: z.boolean().optional(),
    buyerName: optText(255),
    /** Sale of a business asset is a taxable supply (5% VAT) unless stated otherwise. */
    vatTreatment: z.enum(DISPOSAL_VAT_TREATMENTS).optional(),
    notes: optText(2000),
  })
  .refine((v) => !(v.onCredit && v.proceedsAccountId), {
    message: "Choose either a proceeds account or onCredit, not both",
    path: ["proceedsAccountId"],
  })
  .refine((v) => !v.onCredit || !!v.buyerName, {
    message: "buyerName is required when the asset is sold on credit",
    path: ["buyerName"],
  });
export type DisposeBody = z.output<typeof disposeBody>;

export const revalueBody = z.object({
  date: zDate,
  /** New fair value (carrying amount after the revaluation). */
  fairValue: zMoneyFils,
  notes: optText(2000),
});
export type RevalueBody = z.output<typeof revalueBody>;

export const impairBody = z.object({
  date: zDate,
  amount: zMoneyFils.refine((n) => n > 0, "Amount must be greater than zero"),
  notes: optText(2000),
});
export type ImpairBody = z.output<typeof impairBody>;

export const assetClassBody = z.object({
  code: zText(32, { min: 1 }),
  name: zText(255, { min: 1 }),
  nameAr: optText(255),
  isDepreciable: z.boolean().optional(),
  usefulLifeYears: lifeYears,
  depreciationMethod: method.optional(),
  taxUsefulLifeYears: lifeYears,
  costAccountId: zUuid.optional().nullable(),
  accumulatedAccountId: zUuid.optional().nullable(),
  expenseAccountId: zUuid.optional().nullable(),
});
export type AssetClassBody = z.output<typeof assetClassBody>;

export const importAssetsBody = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().optional(),
  /** Capitalise every imported asset against Opening Balance Equity (go-live register). */
  openingBalance: z.boolean().optional(),
});
export type ImportAssetsBody = z.output<typeof importAssetsBody>;

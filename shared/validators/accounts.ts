/**
 * Chart-of-accounts write contracts (W2-D: R02-05, R02-06/R17-03, R02-16c, R17-09).
 *
 * `companyId` and `isSystemAccount` are server-owned and never declared here.
 */
import { z } from "zod";
import { zAccountType, zText, zUuid } from "./primitives";

export const ACCOUNT_SUB_TYPES_BY_TYPE = {
  asset: [
    "cash",
    "bank",
    "receivable",
    "inventory",
    "current_asset",
    "other_current_asset",
    "fixed_asset",
    "non_current_asset",
  ],
  liability: ["payable", "current_liability", "long_term_liability", "non_current_liability"],
  equity: ["owner_equity", "retained_earnings", "drawings"],
  income: ["operating_revenue", "other_income"],
  expense: ["cost_of_sales", "operating_expense", "depreciation", "other_expense"],
} as const;

export type AccountTypeName = keyof typeof ACCOUNT_SUB_TYPES_BY_TYPE;

export const ACCOUNT_SUB_TYPES: readonly string[] = Object.values(ACCOUNT_SUB_TYPES_BY_TYPE).flat();

export const zAccountSubType = z
  .string()
  .refine((s) => ACCOUNT_SUB_TYPES.includes(s), "Unknown account sub type");

/** True when `subType` is a valid sub type for the given account type. */
export function isSubTypeForType(type: string, subType: string): boolean {
  const allowed = (ACCOUNT_SUB_TYPES_BY_TYPE as Record<string, readonly string[]>)[type];
  return !!allowed && allowed.includes(subType);
}

const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, "Account code must be 1-20 letters, digits, . _ -");

const vatType = z.enum(["input", "output", "zero_rated", "exempt"]);

const baseFields = {
  code,
  nameEn: zText(200, { min: 1 }),
  nameAr: zText(200).optional().nullable(),
  description: zText(500).optional().nullable(),
  type: zAccountType,
  subType: zAccountSubType.optional().nullable(),
  isVatAccount: z.boolean().optional(),
  vatType: vatType.optional().nullable(),
  isActive: z.boolean().optional(),
  parentId: zUuid.optional().nullable(),
};

function refineAccount(
  v: { type?: string; subType?: string | null; isVatAccount?: boolean; vatType?: string | null },
  ctx: z.RefinementCtx
) {
  if (v.type && v.subType && !isSubTypeForType(v.type, v.subType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subType"],
      message: `Sub type "${v.subType}" is not valid for a ${v.type} account`,
    });
  }
  if (v.isVatAccount === true && !v.vatType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatType"],
      message: "vatType is required when isVatAccount is true",
    });
  }
  if (v.isVatAccount === false && v.vatType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vatType"],
      message: "vatType must be empty when isVatAccount is false",
    });
  }
}

export const createAccountBody = z.object(baseFields).superRefine(refineAccount);
export type CreateAccountBody = z.output<typeof createAccountBody>;

export const updateAccountBody = z.object(baseFields).partial().superRefine(refineAccount);
export type UpdateAccountBody = z.output<typeof updateAccountBody>;

export const archiveAccountBody = z.object({ reason: zText(500).optional().nullable() }).strict();

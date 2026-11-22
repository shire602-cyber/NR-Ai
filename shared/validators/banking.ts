/**
 * Banking write contracts (W3-C: R06-01, R06-04, R06-13, R06-15, R06-17, R06-20, R06-21, R06-22).
 *
 * Mount with `strictBody(schema)`. Money is validated through shared/money.ts (no floats, more
 * than two decimals is rejected); amounts come out as integer fils (`*Fils`) unless noted.
 */
import { z } from "zod";
import { toFils, MoneyError } from "../money";
import { zCurrency, zDate, zText, zUuid } from "./primitives";

// ─── Money helpers ─────────────────────────────────────────────────────────

function filsSchema(sign: "positive" | "nonNegative" | "signed") {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    let fils: number;
    try {
      fils = toFils(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof MoneyError ? err.message : "Invalid amount",
      });
      return z.NEVER;
    }
    if (sign === "positive" && fils <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    if (sign === "nonNegative" && fils < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be zero or more" });
      return z.NEVER;
    }
    return fils;
  });
}

/** Integer fils, > 0. */
export const zBankAmountFils = filsSchema("positive");
/** Integer fils, >= 0. */
export const zBankAmountFilsNonNegative = filsSchema("nonNegative");
/** Integer fils, any sign. */
export const zBankAmountFilsSigned = filsSchema("signed");

// ─── Bank accounts (R06-01, R06-17) ────────────────────────────────────────

/** Suggestions only: bankName is free text (R06-17). */
export const UAE_BANK_SUGGESTIONS = [
  "Emirates NBD",
  "ADCB",
  "FAB",
  "Mashreq",
  "Mashreq Neo",
  "RAKBANK",
  "CBD",
  "Dubai Islamic Bank",
  "ADIB",
  "Emirates Islamic",
  "HSBC UAE",
  "Standard Chartered UAE",
  "Citibank UAE",
  "Wio Bank",
  "Liv",
  "Zand",
  "Ajman Bank",
  "Sharjah Islamic Bank",
  "NBF",
  "Bank of Baroda",
  "Other",
] as const;

const zBankName = zText(120, { min: 1 });
const zAccountNumber = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9 -]*$/, "Account number may contain letters, digits, spaces and dashes");
const zIbanLoose = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .max(34)
      .regex(/^[A-Z0-9]*$/, "IBAN may contain letters and digits only")
  );

const bankAccountFields = {
  nameEn: zText(255, { min: 1 }),
  bankName: zBankName,
  accountNumber: zAccountNumber.nullable().optional(),
  iban: zIbanLoose.nullable().optional(),
  currency: zCurrency.optional(),
  /** Existing GL account (asset, sub_type bank or cash). Omit to auto-create one in 1020-1029. */
  glAccountId: zUuid.nullable().optional(),
  openingBalance: zBankAmountFilsSigned.optional(),
  openingBalanceDate: zDate.nullable().optional(),
};

/** `name` is accepted as an alias of `nameEn`. */
export const bankAccountCreateBody = z
  .object({
    ...bankAccountFields,
    nameEn: bankAccountFields.nameEn.optional(),
    name: zText(255, { min: 1 }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.nameEn && !v.name)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nameEn (or name) is required",
        path: ["nameEn"],
      });
  })
  .transform(({ name, ...rest }) => ({ ...rest, nameEn: (rest.nameEn ?? name) as string }));
export type BankAccountCreateBody = z.output<typeof bankAccountCreateBody>;

export const bankAccountUpdateBody = z
  .object({
    nameEn: bankAccountFields.nameEn.optional(),
    bankName: zBankName.optional(),
    accountNumber: bankAccountFields.accountNumber,
    iban: bankAccountFields.iban,
    currency: zCurrency.optional(),
    isActive: z.boolean().optional(),
    /** Same as POST .../relink (kept for existing callers). */
    glAccountId: zUuid.optional(),
    openingBalance: zBankAmountFilsSigned.optional(),
    openingBalanceDate: zDate.nullable().optional(),
  })
  .strict();
export type BankAccountUpdateBody = z.output<typeof bankAccountUpdateBody>;

/** Relink to another GL account; unreconciled rows follow (R06-01). */
export const bankAccountRelinkBody = z.object({ glAccountId: zUuid }).strict();

// ─── Matching (R06-03, R06-05, R06-13, R06-21) ─────────────────────────────

export const MATCH_TARGET_TYPES = ["invoice", "bill", "journal", "receipt", "transfer"] as const;
export type MatchTargetType = (typeof MATCH_TARGET_TYPES)[number];

const zIdempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9:_\-.]+$/, "Idempotency key may contain letters, digits and :_-.");

export const bankAllocationInput = z
  .object({
    type: z.enum(["invoice", "bill"]),
    id: zUuid,
    amount: zBankAmountFils,
  })
  .strict();

/**
 * Either a single target (`matchedType` + `matchedId`, optional partial `amount`) or a split
 * (`allocations`, summing exactly to the bank line). `matchedType: "journal_entry"` is accepted as
 * an alias of `journal` (auto-reconcile suggestions).
 */
export const bankMatchBody = z
  .object({
    matchedType: z
      .enum([...MATCH_TARGET_TYPES, "journal_entry"])
      .transform((t) => (t === "journal_entry" ? "journal" : t))
      .optional(),
    matchedId: zUuid.optional(),
    amount: zBankAmountFils.optional(),
    allocations: z.array(bankAllocationInput).min(1).max(50).optional(),
    /** transfer: the counterpart line on the other bank account, reconciled by the same entry. */
    counterpartTransactionId: zUuid.optional(),
    /** Cross-currency invoice settlement: AED per unit of the invoice currency on the bank date. */
    exchangeRate: z
      .union([z.number(), z.string()])
      .transform((v) => Number(v))
      .refine((n) => Number.isFinite(n) && n > 0 && n < 100000, "exchangeRate must be > 0")
      .optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const single = v.matchedType !== undefined || v.matchedId !== undefined;
    if (single && v.allocations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send either matchedType/matchedId or allocations, not both",
        path: ["allocations"],
      });
    }
    if (!single && !v.allocations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "matchedType and matchedId (or allocations) are required",
        path: ["matchedType"],
      });
    }
    if (single && (!v.matchedType || !v.matchedId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "matchedType and matchedId are both required",
        path: [v.matchedType ? "matchedId" : "matchedType"],
      });
    }
  });
export type BankMatchBody = z.output<typeof bankMatchBody>;

export const VAT_TREATMENTS = ["none", "standard", "zero_rated", "exempt"] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

/**
 * Create a journal entry from a bank line (R06-21): contra account, optional 5% VAT split
 * (amount is VAT-inclusive), bank fee line and FX difference line.
 */
export const bankCreateEntryBody = z
  .object({
    accountId: zUuid,
    memo: zText(500).nullable().optional(),
    vatTreatment: z.enum(VAT_TREATMENTS).optional(),
    /** Override the computed 5% VAT (fils); must not exceed the gross. */
    vatAmount: zBankAmountFilsNonNegative.optional(),
    /** Bank fee contained in (outflow) or deducted from (inflow) the bank line. */
    bankFee: zBankAmountFils.optional(),
    bankFeeAccountId: zUuid.optional(),
    /** Contra amount in base currency when it differs from the bank amount (FX difference). */
    contraAmount: zBankAmountFils.optional(),
    costCenterId: zUuid.nullable().optional(),
    /** draft = entry for review; the line is reconciled only when the draft is posted. */
    postingMode: z.enum(["posted", "draft"]).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  })
  .strict();
export type BankCreateEntryBody = z.output<typeof bankCreateEntryBody>;

export const autoReconcileApplyBody = z
  .object({
    matches: z
      .array(
        z
          .object({
            bankTransactionId: zUuid,
            matchedType: z
              .enum(["invoice", "bill", "journal", "journal_entry", "receipt"])
              .transform((t) => (t === "journal_entry" ? "journal" : t)),
            matchedId: zUuid,
          })
          .passthrough()
      )
      .min(1)
      .max(500),
  })
  .strict();
export type AutoReconcileApplyBody = z.output<typeof autoReconcileApplyBody>;

// ─── Transactions (R06-22) ──────────────────────────────────────────────────

export const bankTransactionEditBody = z
  .object({
    description: zText(500, { min: 1 }).optional(),
    category: zText(120).nullable().optional(),
    reference: zText(120).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const bankTransactionExcludeBody = z.object({ reason: zText(500, { min: 3 }) }).strict();

export const bankTransactionDeleteBody = z.object({ reason: zText(500, { min: 3 }) }).strict();

// ─── Reconciliation rules (R06-04, R06-15) ──────────────────────────────────

export const RULE_MATCH_TYPES = ["exact", "contains", "starts_with", "regex"] as const;
export const RULE_MATCH_FIELDS = ["description", "reference", "amount"] as const;

const ruleShape = {
  name: zText(200, { min: 1 }),
  matchField: z.enum(RULE_MATCH_FIELDS).optional(),
  matchType: z.enum(RULE_MATCH_TYPES, {
    error: () => `matchType must be one of: ${RULE_MATCH_TYPES.join(", ")}`,
  }),
  matchValue: z.string().trim().min(1).max(300),
  /** GL account the rule posts to (required). */
  accountId: zUuid,
  vatTreatment: z.enum(VAT_TREATMENTS),
  requireReview: z.boolean().optional(),
  direction: z.enum(["any", "inflow", "outflow"]).optional(),
  category: zText(120).nullable().optional(),
  memo: zText(500).nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
};

/** A regex that does not compile, or is pathological, is rejected at create time (R06-15). */
export function regexProblem(pattern: string): string | null {
  if (pattern.length > 300) return "Pattern is too long";
  // Nested quantifiers such as (a+)+ are catastrophic-backtracking prone.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return "Nested quantifiers are not allowed";
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid regular expression";
  }
}

function refineRule(
  v: { matchType?: string; matchValue?: string; matchField?: string },
  ctx: z.RefinementCtx
) {
  if (v.matchType === "regex" && v.matchValue !== undefined) {
    const problem = regexProblem(v.matchValue);
    if (problem)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid regex: ${problem}`,
        path: ["matchValue"],
      });
  }
  if (v.matchField === "amount" && v.matchType && v.matchType !== "exact" && v.matchValue) {
    // amount rules compare the formatted amount; only exact makes sense.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Amount rules must use matchType exact",
      path: ["matchType"],
    });
  }
}

export const reconciliationRuleCreateBody = z.object(ruleShape).strict().superRefine(refineRule);
export type ReconciliationRuleCreateBody = z.output<typeof reconciliationRuleCreateBody>;

export const reconciliationRuleUpdateBody = z
  .object({
    name: ruleShape.name.optional(),
    matchField: ruleShape.matchField,
    matchType: ruleShape.matchType.optional(),
    matchValue: ruleShape.matchValue.optional(),
    accountId: zUuid.optional(),
    vatTreatment: z.enum(VAT_TREATMENTS).optional(),
    requireReview: z.boolean().optional(),
    direction: ruleShape.direction,
    category: ruleShape.category,
    memo: ruleShape.memo,
    priority: ruleShape.priority,
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine(refineRule);
export type ReconciliationRuleUpdateBody = z.output<typeof reconciliationRuleUpdateBody>;

// ─── Reconciliation statement (R06-20) ──────────────────────────────────────

export const reconciliationStatementBody = z
  .object({
    periodStart: zDate.nullable().optional(),
    periodEnd: zDate,
    statementClosingBalance: zBankAmountFilsSigned,
  })
  .strict();
export type ReconciliationStatementBody = z.output<typeof reconciliationStatementBody>;

// ─── AI / PDF import (R06-12) ───────────────────────────────────────────────

export const aiStatementImportBody = z
  .object({
    bankAccountId: zUuid,
    fileName: zText(255).optional(),
    transactions: z
      .array(
        z
          .object({
            date: z.string().max(40),
            description: z.string().max(1000),
            amount: z.union([z.number(), z.string()]),
            reference: z.string().max(200).nullable().optional(),
            balance: z.union([z.number(), z.string()]).nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(5000),
    allowDuplicates: z.boolean().optional(),
  })
  .strict();
export type AiStatementImportBody = z.output<typeof aiStatementImportBody>;

// ─── Financial-data authorization and processing (R06-14, R06-19) ──────────

export const BANK_FEED_PROVIDERS = ["lean", "tarabut", "wio"] as const;
export type BankFeedProviderId = (typeof BANK_FEED_PROVIDERS)[number];

export const bankFeedConnectBody = z
  .object({
    provider: z.enum(BANK_FEED_PROVIDERS),
    redirectUrl: z.string().trim().max(500),
    bankAccountId: zUuid.optional(),
  })
  .strict();

export const bankFeedCallbackBody = z
  .object({
    provider: z.enum(BANK_FEED_PROVIDERS).optional(),
    code: z
      .string()
      .min(1)
      .max(4000)
      .refine((code) => code.trim().length > 0),
    state: z.string().trim().min(16).max(200),
  })
  .strict();

export const bankAuthorizationHandoffBody = z
  .object({ search: z.string().min(1).max(24_000) })
  .strict();

export const bankFeedSyncBody = z
  .object({
    fromDate: zDate.optional(),
    toDate: zDate.optional(),
  })
  .strict();

export const manualBankConnectionBody = z
  .object({
    bankName: zText(120, { min: 1 }),
    accountName: zText(200).nullable().optional(),
    bankAccountId: zUuid.nullable().optional(),
    iban: zIbanLoose.nullable().optional(),
  })
  .strict();

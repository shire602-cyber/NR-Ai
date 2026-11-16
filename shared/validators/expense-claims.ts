/**
 * Expense claim write contracts (W3-B: R04-03, R04-06, R04-12, R04-20).
 * Server-owned fields (status, submitted_by, claim_number, totals, reviewed_by) are not declared.
 */
import { z } from "zod";
import { zCurrency, zDate, zHttpsUrl, zMoney, zMoneyFils, zText, zTrn, zUuid } from "./primitives";
import { zFxRate } from "./bills";

export const EXPENSE_ITEM_TYPES = ["expense", "mileage", "per_diem"] as const;

const zItemQuantity = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0 && n <= 100_000, "Quantity must be greater than zero");

export const expenseClaimItemSchema = z
  .object({
    expense_date: zDate,
    category: zText(100, { min: 1 }),
    description: zText(500, { min: 1 }),
    item_type: z.enum(EXPENSE_ITEM_TYPES).optional(),
    /** Net amount (item currency) in fils. Mileage / per-diem items compute it from the rate. */
    amount: zMoneyFils.optional(),
    vat_amount: zMoneyFils.optional().nullable(),
    /** Kilometres (mileage) or days (per diem). */
    quantity: zItemQuantity.optional().nullable(),
    currency: zCurrency.optional(),
    exchange_rate: zFxRate.optional().nullable(),
    supplier_trn: z
      .union([zTrn, z.literal("").transform(() => null)])
      .optional()
      .nullable(),
    has_tax_invoice: z.boolean().optional(),
    receipt_url: zHttpsUrl.optional().nullable(),
    merchant_name: zText(200).optional().nullable(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const type = item.item_type ?? "expense";
    if (type === "expense" && (item.amount === undefined || item.amount <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Amount must be greater than zero",
      });
    }
    if (type !== "expense" && (item.quantity === undefined || item.quantity === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: type === "mileage" ? "Kilometres are required" : "Days are required",
      });
    }
    if ((item.vat_amount ?? 0) > 0 && type !== "expense") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vat_amount"],
        message: "Mileage and per-diem items carry no VAT",
      });
    }
    if (item.amount !== undefined && (item.vat_amount ?? 0) > item.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vat_amount"],
        message: "VAT cannot exceed the amount",
      });
    }
  });
export type ExpenseClaimItemInput = z.output<typeof expenseClaimItemSchema>;

export const expenseClaimCreateSchema = z.object({
  title: zText(200, { min: 1 }),
  description: zText(2000).optional().nullable(),
  currency: zCurrency.optional(),
  items: z.array(expenseClaimItemSchema).max(200).optional(),
});
export type ExpenseClaimCreateInput = z.output<typeof expenseClaimCreateSchema>;

export const expenseClaimUpdateSchema = z
  .object({
    title: zText(200, { min: 1 }).optional(),
    description: zText(2000).optional().nullable(),
    currency: zCurrency.optional(),
    items: z.array(expenseClaimItemSchema).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type ExpenseClaimUpdateInput = z.output<typeof expenseClaimUpdateSchema>;

export const expenseClaimReviewSchema = z.object({
  review_notes: zText(2000).optional().nullable(),
});

export const expenseClaimRejectSchema = z.object({
  review_notes: zText(2000, { min: 1 }),
});

export const expenseClaimMarkPaidSchema = z.object({
  payment_reference: zText(255).optional().nullable(),
  /** Cash / bank account credited; default 1020 Bank. */
  payment_account_id: zUuid.optional().nullable(),
  payment_date: zDate.optional(),
});
export type ExpenseClaimMarkPaidInput = z.output<typeof expenseClaimMarkPaidSchema>;

/** S2 (R04-20): reimburse an approved claim on the employee's next payroll run. */
export const expenseClaimPayrollSchema = z
  .object({
    enabled: z.boolean(),
    /** Employee paid through payroll; default: the employee whose email matches the submitter. */
    employee_id: zUuid.optional().nullable(),
  })
  .strict();
export type ExpenseClaimPayrollInput = z.output<typeof expenseClaimPayrollSchema>;

export const expenseClaimSettingsSchema = z.object({
  mileage_rate: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .refine(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1000,
      "Mileage rate must be between 0 and 1000"
    )
    .optional(),
  per_diem_rate: zMoney.optional(),
});

export const expenseCategoryPolicySchema = z.object({
  category: zText(100, { min: 1 }),
  receipt_required: z.boolean(),
  receipt_threshold: zMoney.optional(),
});

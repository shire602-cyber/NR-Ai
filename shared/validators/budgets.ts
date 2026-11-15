/**
 * Budget plan and line validators (W3-E: R13-10).
 *
 * Plans: end >= start and at most 12 calendar months, so each month column
 * (jan..dec) maps to exactly one year-month (R13-11). Lines: month amounts are
 * strict decimals (no "abc"/NaN) and non-negative unless the line is a contra
 * line. `status` is not accepted here: approval goes through /approve.
 */
import { z } from "zod";
import { zDate, zMoneySigned, zText, zUuid } from "./primitives";

export const BUDGET_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
export type BudgetMonth = (typeof BUDGET_MONTHS)[number];

const fiscalYear = z
  .union([z.number(), z.string().regex(/^\d{4}$/, "Must be a four-digit year")])
  .transform((v) => (typeof v === "string" ? parseInt(v, 10) : v))
  .pipe(z.number().int().min(1990).max(2200));

/** Calendar months from `start` to `end` inclusive (dates are YYYY-MM-DD). */
export function budgetMonthSpan(start: string, end: string): number {
  return (
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    (Number(end.slice(5, 7)) - Number(start.slice(5, 7))) +
    1
  );
}

export function checkBudgetDates(
  start: string | undefined,
  end: string | undefined,
  ctx: z.RefinementCtx
): void {
  if (!start || !end) return;
  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date must be on or after the start date",
    });
    return;
  }
  if (budgetMonthSpan(start, end) > 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "A budget plan covers at most 12 months; create a new plan for the next period",
    });
  }
}

const planShape = {
  name: zText(255, { min: 1 }),
  fiscalYear,
  startDate: zDate,
  endDate: zDate,
  notes: zText(2000).optional().nullable(),
  costCenterId: zUuid.optional().nullable(),
  classTag: zText(100).optional().nullable(),
  alertThresholdPct: z.number().min(0).max(1000).optional(),
};

export const budgetPlanCreateBody = z
  .object(planShape)
  .strict()
  .superRefine((v, ctx) => checkBudgetDates(v.startDate, v.endDate, ctx));

export const budgetPlanUpdateBody = z
  .object({
    ...planShape,
    name: planShape.name.optional(),
    fiscalYear: fiscalYear.optional(),
    startDate: zDate.optional(),
    endDate: zDate.optional(),
    // Approval is a separate endpoint (maker-checker); only closing is a plain update.
    status: z.enum(["draft", "closed"]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => checkBudgetDates(v.startDate, v.endDate, ctx));

const monthAmount = zMoneySigned.optional().nullable();

const lineShape = {
  accountId: zUuid.optional().nullable(),
  category: zText(255, { min: 1 }),
  description: zText(1000).optional().nullable(),
  costCenterId: zUuid.optional().nullable(),
  isContra: z.boolean().optional(),
  jan: monthAmount,
  feb: monthAmount,
  mar: monthAmount,
  apr: monthAmount,
  may: monthAmount,
  jun: monthAmount,
  jul: monthAmount,
  aug: monthAmount,
  sep: monthAmount,
  oct: monthAmount,
  nov: monthAmount,
  dec: monthAmount,
};

/** Months with a negative amount on a non-contra line. */
export function negativeBudgetMonths(
  v: Partial<Record<BudgetMonth, string | null | undefined>> & { isContra?: boolean }
): BudgetMonth[] {
  if (v.isContra) return [];
  return BUDGET_MONTHS.filter((m) => {
    const raw = v[m];
    return raw !== undefined && raw !== null && Number(raw) < 0;
  });
}

export function checkBudgetLineAmounts(
  v: Partial<Record<BudgetMonth, string | null | undefined>> & { isContra?: boolean },
  ctx: z.RefinementCtx
): void {
  for (const m of negativeBudgetMonths(v)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [m],
      message: "Budget amounts cannot be negative unless the line is marked as a contra line",
    });
  }
}

export const budgetLineCreateBody = z
  .object(lineShape)
  .strict()
  .superRefine((v, ctx) => checkBudgetLineAmounts(v, ctx));

export const budgetLineUpdateBody = z
  .object(lineShape)
  .partial()
  .strict()
  .superRefine((v, ctx) => checkBudgetLineAmounts(v, ctx));

export const budgetCopyBody = z
  .object({
    fiscalYear,
    name: zText(255, { min: 1 }).optional(),
    /** Optional uplift applied to every month, in percent (e.g. 5 = +5%). */
    adjustPct: z.number().min(-100).max(1000).optional(),
  })
  .strict();

export const budgetImportBody = z
  .object({
    /** CSV text with header: category,account_code,jan..dec (the client sends xlsx rows as csv). */
    csv: z.string().min(1).max(500_000),
    replace: z.boolean().optional(),
  })
  .strict();

export type BudgetPlanCreate = z.output<typeof budgetPlanCreateBody>;
export type BudgetPlanUpdate = z.output<typeof budgetPlanUpdateBody>;
export type BudgetLineCreate = z.output<typeof budgetLineCreateBody>;
export type BudgetLineUpdate = z.output<typeof budgetLineUpdateBody>;

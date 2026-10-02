// Employee loan and advance maths (UAE Labour Law). Pure: no database.
//
//   - an instalment may not exceed 20 % of the monthly wage (basic plus all allowances) when the loan is made;
//   - when a payroll run deducts, loan instalments plus the run's other deductions may not take more than 50 %
//     of the gross pay (Art. 25): what does not fit is deferred and added as a new last instalment;
//   - the last instalment absorbs rounding so the schedule adds up to the principal exactly.

import Decimal from "decimal.js";

const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export const LOAN_INSTALMENT_CAP_PCT = 0.2;
export const RUN_DEDUCTION_CAP_PCT = 0.5;

export function maxInstalment(monthlyWage: number): number {
  return r2(new Decimal(monthlyWage).times(LOAN_INSTALMENT_CAP_PCT));
}

export interface ScheduleItem {
  sequence: number;
  periodYear: number;
  periodMonth: number;
  amount: number;
}

export function buildLoanSchedule(args: { principal: number; count: number; firstYear: number; firstMonth: number }): ScheduleItem[] {
  const each = r2(new Decimal(args.principal).div(args.count));
  const items: ScheduleItem[] = [];
  let paid = new Decimal(0);
  for (let i = 0; i < args.count; i++) {
    const total = args.firstYear * 12 + (args.firstMonth - 1) + i;
    const isLast = i === args.count - 1;
    const amount = isLast ? r2(new Decimal(args.principal).minus(paid)) : each;
    paid = paid.plus(amount);
    items.push({ sequence: i + 1, periodYear: Math.floor(total / 12), periodMonth: (total % 12) + 1, amount });
  }
  return items;
}

export const periodKey = (year: number, month: number): number => year * 12 + month;

/**
 * null when every instalment fits the cap, else the room left to show in the 422 DEDUCTION_CAP. The cap covers ALL
 * of the employee's active loans: `committed` holds the other loans' instalments per period (periodKey), and a month
 * counts the new instalment on top of them.
 */
export function instalmentCapProblem(
  schedule: ScheduleItem[],
  monthlyWage: number,
  committed: Map<number, number> = new Map()
): { maxInstalment: number } | null {
  const cap = maxInstalment(monthlyWage);
  let worst = 0;
  let exceeded = false;
  for (const i of schedule) {
    const other = committed.get(periodKey(i.periodYear, i.periodMonth)) ?? 0;
    if (i.amount + other > cap + 0.005) exceeded = true;
    worst = Math.max(worst, other);
  }
  return exceeded ? { maxInstalment: r2(Math.max(0, cap - worst)) } : null;
}

export interface DueInstalment {
  id: string;
  sequence: number;
  amount: number;
}

export interface RunDeduction {
  id: string;
  /** What this run deducts for the instalment (can be less than its amount). */
  amount: number;
  /** What did not fit and rolls into a new last instalment. */
  deferred: number;
}

/** Fit the due instalments, in sequence order, into 50 % of gross less the other deductions. */
export function allocateRunDeductions(args: { due: DueInstalment[]; grossPay: number; generalDeductions: number; monthlyWage?: number }): {
  take: RunDeduction[];
  total: number;
  deferredTotal: number;
} {
  let allowance = Decimal.max(0, new Decimal(args.grossPay).times(RUN_DEDUCTION_CAP_PCT).minus(args.generalDeductions));
  // Whatever the loans are, together they never take more than 20 % of the monthly wage in one run.
  if (args.monthlyWage !== undefined) allowance = Decimal.min(allowance, new Decimal(args.monthlyWage).times(LOAN_INSTALMENT_CAP_PCT));
  let total = new Decimal(0);
  let deferredTotal = new Decimal(0);
  const take: RunDeduction[] = [];
  for (const instalment of [...args.due].sort((a, b) => a.sequence - b.sequence)) {
    const amount = new Decimal(instalment.amount);
    const taken = Decimal.min(amount, allowance);
    const deferred = amount.minus(taken);
    allowance = allowance.minus(taken);
    total = total.plus(taken);
    deferredTotal = deferredTotal.plus(deferred);
    take.push({ id: instalment.id, amount: r2(taken), deferred: r2(deferred) });
  }
  return { take, total: r2(total), deferredTotal: r2(deferredTotal) };
}

/** What the employee still owes: instalments not yet deducted or settled. */
export function remainingBalance(instalments: Array<{ amount: number; status: string }>): number {
  return r2(
    instalments
      .filter((i) => i.status === "scheduled" || i.status === "reserved")
      .reduce((sum, i) => sum.plus(i.amount), new Decimal(0))
  );
}

/**
 * Pure fixed-asset depreciation (W4-B: R10-04, R10-12, R10-17). Integer fils, no I/O.
 *
 * Straight line follows a FIXED schedule (R10-12): monthly = depreciable base / life months
 * (rounded half up); the acquisition month is prorated by days held; every later month posts the
 * same monthly amount; the month that ends the useful life (and any month where less than one
 * monthly amount remains) takes the exact remainder, so the total is exact.
 *
 * Declining balance: NBV × (2 / life) / 12, first month prorated, never below salvage.
 * Land and other non-depreciable assets never depreciate (R10-04).
 */
import { prorate } from "../inventory/costing";

export type DepMethod = "straight_line" | "declining_balance";

export interface AssetCalcInput {
  costFils: number;
  salvageFils: number;
  /** Revaluation surplus added to the depreciable base (revaluation model). */
  revaluationFils?: number;
  /** Accumulated impairment (reduces the carrying amount). */
  impairmentFils?: number;
  usefulLifeYears: number | null;
  method: DepMethod | string | null;
  purchaseDate: string; // YYYY-MM-DD
  accumulatedFils: number;
  isDepreciable: boolean;
}

export interface DepreciationCalc {
  amountFils: number;
  prorationFactor: number;
  skipped: boolean;
  skipReason?: "NON_DEPRECIABLE" | "NO_USEFUL_LIFE" | "PREDATES_ACQUISITION" | "FULLY_DEPRECIATED";
  newAccumulatedFils: number;
  newNetBookValueFils: number;
  fullyDepreciated: boolean;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function carryingFils(a: AssetCalcInput): number {
  return a.costFils + (a.revaluationFils ?? 0) - a.accumulatedFils - (a.impairmentFils ?? 0);
}

export function depreciationFor(a: AssetCalcInput, year: number, month: number): DepreciationCalc {
  const nbv = carryingFils(a);
  const base = (skipReason: DepreciationCalc["skipReason"]): DepreciationCalc => ({
    amountFils: 0,
    prorationFactor: 1,
    skipped: true,
    skipReason,
    newAccumulatedFils: a.accumulatedFils,
    newNetBookValueFils: nbv,
    fullyDepreciated: skipReason === "FULLY_DEPRECIATED",
  });
  if (!a.isDepreciable) return base("NON_DEPRECIABLE");
  if (!a.usefulLifeYears || a.usefulLifeYears <= 0) return base("NO_USEFUL_LIFE");
  const p = parts(a.purchaseDate);
  const elapsed = (year - p.y) * 12 + (month - p.m);
  if (elapsed < 0) return base("PREDATES_ACQUISITION");
  const remaining = Math.max(0, nbv - a.salvageFils);
  if (remaining <= 0) return base("FULLY_DEPRECIATED");

  const totalMonths = a.usefulLifeYears * 12;
  const dim = daysInMonth(year, month);
  const firstPartial = p.d > 1;
  const heldDays = dim - p.d + 1;
  const prorationFactor = elapsed === 0 && firstPartial ? heldDays / dim : 1;
  let amount: number;
  if (a.method === "declining_balance") {
    const monthly = prorate(nbv, 2, a.usefulLifeYears * 12);
    amount = elapsed === 0 && firstPartial ? prorate(monthly, heldDays, dim) : monthly;
    if (elapsed >= totalMonths - (firstPartial ? 0 : 1)) amount = remaining;
  } else {
    const depreciable =
      a.costFils + (a.revaluationFils ?? 0) - (a.impairmentFils ?? 0) - a.salvageFils;
    const monthly = prorate(depreciable, 1, totalMonths);
    const lastMonth = firstPartial ? totalMonths : totalMonths - 1;
    if (elapsed >= lastMonth) amount = remaining;
    else if (elapsed === 0 && firstPartial) amount = prorate(monthly, heldDays, dim);
    else amount = monthly;
  }
  amount = Math.max(0, Math.min(amount, remaining));
  const newAcc = a.accumulatedFils + amount;
  return {
    amountFils: amount,
    prorationFactor,
    skipped: amount === 0,
    skipReason: amount === 0 ? "FULLY_DEPRECIATED" : undefined,
    newAccumulatedFils: newAcc,
    newNetBookValueFils: nbv - amount,
    fullyDepreciated: remaining - amount <= 0,
  };
}

/** Months from the acquisition month through (year, month), inclusive, oldest first. */
export function monthsThrough(purchaseDate: string, year: number, month: number) {
  const p = parts(purchaseDate);
  const out: Array<{ year: number; month: number }> = [];
  let y = p.y;
  let m = p.m;
  while (y < year || (y === year && m <= month)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Simulated accumulated depreciation through (year, month) under the given life / method. */
export function scheduleTo(
  a: Omit<AssetCalcInput, "accumulatedFils">,
  year: number,
  month: number
): { accumulatedFils: number; months: Array<{ year: number; month: number; amountFils: number }> } {
  let acc = 0;
  const months: Array<{ year: number; month: number; amountFils: number }> = [];
  for (const pm of monthsThrough(a.purchaseDate, year, month)) {
    const c = depreciationFor({ ...a, accumulatedFils: acc }, pm.year, pm.month);
    if (c.amountFils > 0) {
      acc += c.amountFils;
      months.push({ ...pm, amountFils: c.amountFils });
    }
  }
  return { accumulatedFils: acc, months };
}

/** Disposal split (fils): VAT on proceeds and gain (+) / loss (−) against net book value. */
export function disposalSplit(args: {
  proceedsFils: number;
  vatRate: 0 | 5;
  costFils: number;
  revaluationFils: number;
  accumulatedFils: number;
  impairmentFils: number;
}) {
  const vatFils = args.vatRate === 5 ? prorate(args.proceedsFils, 5, 100) : 0;
  const nbv = args.costFils + args.revaluationFils - args.accumulatedFils - args.impairmentFils;
  return { vatFils, nbvFils: nbv, gainLossFils: args.proceedsFils - nbv };
}

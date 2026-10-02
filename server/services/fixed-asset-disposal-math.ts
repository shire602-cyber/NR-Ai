// What a disposal does to depreciation, pure. Policy (the one the help article states): depreciation runs up to and
// including the disposal date. Whole months before the disposal month are charged in full; the disposal month is charged
// pro rata by days (the days from the 1st to the disposal date, inclusive, over the days of the month; in the acquisition
// month, from the acquisition day). Anything posted for the disposal month beyond that, or for later months, is reversed.

import { UAE_VAT_RATE } from "../constants";
import { calculateDepreciation, daysInMonth, isNonDepreciableCategory } from "./fixed-asset-depreciation-math";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ScheduleRowLite {
  year: number;
  month: number;
  amount: number;
}

const ord = (y: number, m: number): number => y * 12 + (m - 1);

/** The charge of the disposal month up to the disposal day, given what had accumulated before the month. */
export function disposalMonthCharge(asset: any, accumulatedBefore: number, year: number, month: number, day: number): { charge: number; fraction: number } {
  if (isNonDepreciableCategory(asset.category) || asset.useful_life_years === null || asset.useful_life_years === undefined) return { charge: 0, fraction: 0 };
  const full = calculateDepreciation({ ...asset, accumulated_depreciation: accumulatedBefore }, year, month, 0);
  if (full.skipped || full.monthlyDepreciation <= 0) return { charge: 0, fraction: 0 };
  const purchase = asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
  const inAcquisitionMonth = purchase.getUTCFullYear() === year && purchase.getUTCMonth() + 1 === month;
  const dim = daysInMonth(year, month);
  const from = inAcquisitionMonth ? purchase.getUTCDate() : 1;
  const active = Math.max(0, day - from + 1);
  const total = Math.max(1, dim - from + 1);
  const fraction = Math.min(1, active / total);
  return { charge: round2(full.monthlyDepreciation * fraction), fraction };
}

export interface DisposalDepreciationPlan {
  /** Months before the disposal month that are not posted yet (charged in full). */
  missingMonths: Array<{ year: number; month: number; amount: number }>;
  disposalMonth: { year: number; month: number; fraction: number; target: number; posted: number | null };
  /** Posted for the disposal month beyond the target, plus every later month: reversed on disposal. */
  excess: number;
  laterMonths: ScheduleRowLite[];
  /** Accumulated depreciation at the disposal date once the plan is applied. */
  accumulatedAtDisposal: number;
  /** Accumulated depreciation in the books now. */
  accumulatedPosted: number;
}

export function planDisposalDepreciation(asset: any, rows: ScheduleRowLite[], disposal: { year: number; month: number; day: number }): DisposalDepreciationPlan {
  const purchase = asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
  const dispOrd = ord(disposal.year, disposal.month);
  const byOrd = new Map(rows.map((r) => [ord(r.year, r.month), r]));
  const accumulatedPosted = round2(rows.reduce((s, r) => s + r.amount, 0));
  const before = rows.filter((r) => ord(r.year, r.month) < dispOrd);
  let running = round2(before.reduce((s, r) => s + r.amount, 0));

  const missingMonths: DisposalDepreciationPlan["missingMonths"] = [];
  if (!isNonDepreciableCategory(asset.category) && asset.useful_life_years !== null && asset.useful_life_years !== undefined) {
    for (let o = ord(purchase.getUTCFullYear(), purchase.getUTCMonth() + 1); o < dispOrd; o++) {
      if (byOrd.has(o)) continue;
      const y = Math.floor(o / 12);
      const m = (o % 12) + 1;
      const calc = calculateDepreciation({ ...asset, accumulated_depreciation: running }, y, m, 0);
      if (calc.skipped || calc.monthlyDepreciation <= 0) continue;
      missingMonths.push({ year: y, month: m, amount: calc.monthlyDepreciation });
      running = calc.newAccumulatedDepreciation;
    }
  }
  const { charge, fraction } = disposalMonthCharge(asset, running, disposal.year, disposal.month, disposal.day);
  const posted = byOrd.get(dispOrd)?.amount ?? null;
  const target = posted === null ? charge : Math.min(posted, charge);
  const laterMonths = rows.filter((r) => ord(r.year, r.month) > dispOrd);
  const excess = round2((posted === null ? 0 : posted - target) + laterMonths.reduce((s, r) => s + r.amount, 0));
  return {
    missingMonths,
    disposalMonth: { year: disposal.year, month: disposal.month, fraction, target, posted },
    excess,
    laterMonths,
    accumulatedAtDisposal: round2(running + target),
    accumulatedPosted,
  };
}

export type DisposalVatTreatment = "none" | "standard" | "zero_rated" | "exempt";

/** VAT on a disposal: 5% of the (tax-exclusive) price for a standard-rated sale, nothing otherwise. */
export function disposalVat(proceeds: number, treatment: DisposalVatTreatment): { vatAmount: number; total: number } {
  const vatAmount = treatment === "standard" ? round2(proceeds * UAE_VAT_RATE) : 0;
  return { vatAmount, total: round2(proceeds + vatAmount) };
}

/**
 * The disposal journal when the sale was invoiced (the invoice booked Dr A/R, Cr 4080 for the price and Cr 2020 for the VAT):
 * the asset leaves at cost, accumulated depreciation is released, and 4080 is debited by the book value so that what stays
 * in it is the gain; a loss goes to its own account.
 */
export function invoicedDisposalLines(cost: number, accumulated: number, proceeds: number) {
  const nbv = round2(cost - accumulated);
  const against4080 = round2(Math.max(0, Math.min(nbv, proceeds)));
  const loss = round2(Math.max(0, nbv - proceeds));
  return { nbv, against4080, loss, gainLoss: round2(proceeds - nbv) };
}

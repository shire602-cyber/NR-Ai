// Fixed-asset depreciation, pure. The one definition of a month's charge (moved out of the fixed-assets route so the
// asset schedule report can project future months with exactly the arithmetic the posting uses).
//
//   straight line: remaining depreciable / remaining months; declining balance: 2/n x NBV / 12
//   the acquisition month is prorated by the days left in it; accumulated depreciation never passes cost - salvage

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function daysInMonth(year: number, month: number): number {
  // month is 1-12. Date(year, month, 0) gives last day of (month).
  return new Date(year, month, 0).getDate();
}

// Land is held indefinitely and never depreciates under IAS 16. The check is
// case-insensitive so 'Land' from the UI dropdown and 'land' from raw API
// callers both match.
export function isNonDepreciableCategory(category: string | null | undefined): boolean {
  return (category ?? "").trim().toLowerCase() === "land";
}

export interface DepreciationCalc {
  monthlyDepreciation: number;
  newAccumulatedDepreciation: number;
  newNetBookValue: number;
  prorationFactor: number; // 1.0 = full month, <1.0 = prorated first month
  fullyDepreciated: boolean;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Compute depreciation for a single (asset, period) using:
 *   - straight-line: remaining-depreciable / remaining-months,
 *     so a change to useful_life or salvage automatically reshapes
 *     the schedule for *future* periods only.
 *   - declining-balance: 2/n * NBV / 12.
 *
 * Both methods are capped so accumulated_depreciation never exceeds
 * (cost - salvage), and the first month posts a prorated amount
 * based on acquisition day (e.g. acquired on the 16th of a 30-day
 * month = 15/30 = 0.5 month).
 *
 * `monthsAlreadyDepreciated` is COUNT(*) of depreciation_schedules
 * rows strictly *before* this (year, month). Pass 0 for the first
 * period.
 */
export function calculateDepreciation(
  asset: any,
  periodYear: number,
  periodMonth: number,
  monthsAlreadyDepreciated: number
): DepreciationCalc {
  const cost = parseFloat(asset.purchase_cost);
  const salvage = parseFloat(asset.salvage_value || 0);
  const usefulLifeYears = asset.useful_life_years;
  const currentAccDep = parseFloat(asset.accumulated_depreciation || 0);
  const method = asset.depreciation_method || "straight_line";

  // Land never depreciates under IAS 16, and assets without a useful_life
  // can't be straight-lined. Bail out before any math runs so callers can
  // distinguish "skipped because non-depreciable" from "skipped because
  // already fully depreciated".
  if (
    isNonDepreciableCategory(asset.category) ||
    usefulLifeYears === null ||
    usefulLifeYears === undefined
  ) {
    return {
      monthlyDepreciation: 0,
      newAccumulatedDepreciation: currentAccDep,
      newNetBookValue: round2(cost - currentAccDep),
      prorationFactor: 1,
      fullyDepreciated: false,
      skipped: true,
      skipReason: isNonDepreciableCategory(asset.category)
        ? "Land is non-depreciable"
        : "Asset has no useful_life_years",
    };
  }

  const totalMonths = usefulLifeYears * 12;
  const maxDepreciation = cost - salvage;
  const remainingDepreciable = Math.max(0, maxDepreciation - currentAccDep);

  const purchaseDate =
    asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getUTCFullYear();
  const purchaseMonth = purchaseDate.getUTCMonth() + 1; // 1-12
  const purchaseDay = purchaseDate.getUTCDate();

  // Months from the acquisition month to the target period: 0 for the acquisition month itself.
  const monthsElapsed = (periodYear - purchaseYear) * 12 + (periodMonth - purchaseMonth);
  if (monthsElapsed < 0) {
    return {
      monthlyDepreciation: 0,
      newAccumulatedDepreciation: currentAccDep,
      newNetBookValue: round2(cost - currentAccDep),
      prorationFactor: 1,
      fullyDepreciated: false,
      skipped: true,
      skipReason: "Period predates acquisition",
    };
  }

  // The acquisition month is prorated by the days left in it.
  const dim = daysInMonth(periodYear, periodMonth);
  const firstMonthFactor = monthsElapsed === 0 ? (dim - purchaseDay + 1) / dim : 1;
  const acquisitionDim = daysInMonth(purchaseYear, purchaseMonth);
  const acquisitionStub = (acquisitionDim - purchaseDay + 1) / acquisitionDim < 1;

  let monthlyDepreciation = 0;
  let prorationFactor = 1;

  if (method === "declining_balance") {
    // from the book value, so months must be posted in order (the posting service refuses anything else)
    const currentNBV = cost - currentAccDep;
    const annualRate = 2 / usefulLifeYears;
    monthlyDepreciation = ((currentNBV * annualRate) / 12) * firstMonthFactor;
    prorationFactor = firstMonthFactor;
  } else {
    // Straight line: (cost - salvage) / months, from the schedule and NOT from what happens to be posted, so a month
    // charges the same whichever order the months are run in. The last scheduled month takes whatever is left (rounding;
    // with a part first month, the stub lands one month after the term).
    const perMonth = maxDepreciation / totalMonths;
    const finalIndex = acquisitionStub ? totalMonths : totalMonths - 1;
    if (monthsElapsed > finalIndex) {
      monthlyDepreciation = remainingDepreciable;
    } else if (monthsElapsed === finalIndex) {
      // what the schedule has not charged in the months before it, worked out from the schedule alone
      const scheduledBefore = finalIndex === 0 ? 0 : round2(perMonth * (acquisitionStub ? (acquisitionDim - purchaseDay + 1) / acquisitionDim : 1)) + (finalIndex - 1) * round2(perMonth);
      monthlyDepreciation = Math.max(0, maxDepreciation - scheduledBefore);
    } else {
      monthlyDepreciation = perMonth * firstMonthFactor;
      prorationFactor = firstMonthFactor;
    }
  }
  void monthsAlreadyDepreciated; // kept for callers; no longer part of the straight-line charge

  // Cap so accumulated_depreciation never breaches (cost - salvage)
  // and NBV never drifts below salvage from rounding.
  if (monthlyDepreciation > remainingDepreciable) {
    monthlyDepreciation = remainingDepreciable;
  }
  if (monthlyDepreciation < 0) {
    monthlyDepreciation = 0;
  }

  monthlyDepreciation = round2(monthlyDepreciation);
  const newAccDep = round2(currentAccDep + monthlyDepreciation);
  const newNBV = round2(cost - newAccDep);

  return {
    monthlyDepreciation,
    newAccumulatedDepreciation: newAccDep,
    newNetBookValue: newNBV,
    prorationFactor,
    fullyDepreciated: newAccDep >= maxDepreciation - 0.005,
  };
}


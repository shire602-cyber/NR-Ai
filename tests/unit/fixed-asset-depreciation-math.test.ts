import { describe, expect, it } from "vitest";
import { calculateDepreciation, daysInMonth, isNonDepreciableCategory } from "../../server/services/fixed-asset-depreciation-math";

const asset = (over: Record<string, unknown> = {}) => ({
  purchase_cost: "3600",
  salvage_value: "600",
  useful_life_years: 3,
  depreciation_method: "straight_line",
  category: "Equipment",
  purchase_date: new Date("2026-01-01T00:00:00Z"),
  accumulated_depreciation: "0",
  ...over,
});

/** Run the schedule month by month the way the projection does. */
function run(a: any, months = 100) {
  let acc = 0;
  let n = 0;
  let y = 2026;
  let m = 1;
  const rows: number[] = [];
  for (let i = 0; i < months; i++) {
    const c = calculateDepreciation({ ...a, accumulated_depreciation: acc }, y, m, n);
    if (c.skipped || c.monthlyDepreciation <= 0) break;
    acc = c.newAccumulatedDepreciation;
    rows.push(c.monthlyDepreciation);
    if (c.fullyDepreciated) break;
    n++;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return { rows, acc };
}

describe("depreciation math", () => {
  it("straight line charges (cost - salvage) / months and stops exactly at salvage", () => {
    const { rows, acc } = run(asset());
    expect(rows).toHaveLength(36);
    expect(rows[0]).toBe(83.33);
    expect(acc).toBe(3000);
  });

  it("prorates the acquisition month by the days left", () => {
    const c = calculateDepreciation(asset({ purchase_date: new Date("2026-01-16T00:00:00Z") }), 2026, 1, 0);
    expect(c.prorationFactor).toBeCloseTo(16 / 31, 5);
  });

  it("declining balance never goes below salvage", () => {
    const { acc } = run(asset({ depreciation_method: "declining_balance" }), 400);
    expect(acc).toBeLessThanOrEqual(3000.005);
    expect(acc).toBeGreaterThan(2900);
  });

  it("land and assets without a life are skipped", () => {
    expect(isNonDepreciableCategory(" Land ")).toBe(true);
    expect(calculateDepreciation(asset({ category: "land" }), 2026, 1, 0).skipped).toBe(true);
    expect(calculateDepreciation(asset({ useful_life_years: null }), 2026, 1, 0).skipped).toBe(true);
  });

  it("daysInMonth knows February", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("VP defect 1: a straight-line month charges the same whichever order the months are run in", () => {
    const a = asset({ purchase_cost: "4200", salvage_value: "0", purchase_date: new Date("2026-08-01T00:00:00Z") });
    const sep = calculateDepreciation({ ...a, accumulated_depreciation: 0 }, 2026, 9, 0);
    const augAfterSep = calculateDepreciation({ ...a, accumulated_depreciation: sep.monthlyDepreciation }, 2026, 8, 1);
    const augFirst = calculateDepreciation({ ...a, accumulated_depreciation: 0 }, 2026, 8, 0);
    expect(sep.monthlyDepreciation).toBe(116.67);
    expect(augAfterSep.monthlyDepreciation).toBe(116.67);
    expect(augFirst.monthlyDepreciation).toBe(116.67);
  });

  it("the last scheduled month is worked out from the schedule, so the total is exactly the base", () => {
    const a = asset({ purchase_cost: "4200", salvage_value: "0", purchase_date: new Date("2026-08-01T00:00:00Z") });
    const { rows, acc } = run({ ...a, purchase_date: new Date("2026-01-01T00:00:00Z") });
    expect(rows).toHaveLength(36);
    expect(acc).toBe(4200);
    expect(rows[35]).toBe(116.55);
    // the final month asked for out of order still charges its own amount
    const last = calculateDepreciation({ ...a, purchase_date: new Date("2026-01-01T00:00:00Z"), accumulated_depreciation: 116.67 }, 2028, 12, 1);
    expect(last.monthlyDepreciation).toBe(116.55);
  });

  it("a part first month leaves a stub that is charged the month after the term", () => {
    const a = asset({ purchase_cost: "3600", salvage_value: "0", purchase_date: new Date("2026-01-16T00:00:00Z") });
    const { rows, acc } = run(a);
    expect(rows[0]).toBeCloseTo(100 * (16 / 31), 1);
    expect(rows).toHaveLength(37);
    expect(acc).toBe(3600);
  });

  it("a period before the acquisition month is skipped", () => {
    const c = calculateDepreciation(asset({ purchase_date: new Date("2026-03-10T00:00:00Z") }), 2026, 2, 0);
    expect(c.skipped).toBe(true);
  });
});

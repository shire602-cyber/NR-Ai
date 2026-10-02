import { describe, it, expect } from "vitest";
import { computeLateFee, isLateFeeDue, lateFeeConfigSchema } from "../../server/services/late-fee-math";

describe("computeLateFee", () => {
  it("percent of the outstanding, rounded to fils", () => {
    expect(computeLateFee({ outstanding: 1000, type: "percent", value: 2 })).toBe(20);
    expect(computeLateFee({ outstanding: 333.33, type: "percent", value: 2 })).toBe(6.67);
  });
  it("fixed fee is the value", () => {
    expect(computeLateFee({ outstanding: 1000, type: "fixed", value: 35 })).toBe(35);
  });
  it("no fee for nothing outstanding or a non-positive value", () => {
    expect(computeLateFee({ outstanding: 0, type: "percent", value: 2 })).toBe(0);
    expect(computeLateFee({ outstanding: 100, type: "percent", value: 0 })).toBe(0);
  });
});

describe("isLateFeeDue", () => {
  it("due when the due date plus the grace days is before today", () => {
    expect(isLateFeeDue({ dueDate: "2026-09-01", afterDays: 15, today: "2026-09-17" })).toBe(true);
    expect(isLateFeeDue({ dueDate: "2026-09-01", afterDays: 15, today: "2026-09-16" })).toBe(false);
  });
  it("no due date, no fee", () => {
    expect(isLateFeeDue({ dueDate: null, afterDays: 15, today: "2026-09-17" })).toBe(false);
  });
});

describe("lateFeeConfigSchema", () => {
  it("accepts a percent fee and defaults VAT to out of scope", () => {
    const r = lateFeeConfigSchema.parse({ enabled: true, type: "percent", value: 2, afterDays: 15 });
    expect(r.vatTreatment).toBe("out_of_scope");
  });
  it("rejects a percent above 100 and an enabled fee without a value", () => {
    expect(() => lateFeeConfigSchema.parse({ enabled: true, type: "percent", value: 101, afterDays: 15 })).toThrow();
    expect(() => lateFeeConfigSchema.parse({ enabled: true, type: "fixed", value: 0, afterDays: 15 })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { isLastMonthOfVatPeriod, normaliseVatFrequency, vatChecklistVerdict } from "../../server/services/month-end-checklist-rules";

describe("which month ends a VAT period", () => {
  it("a quarterly filer on calendar quarters closes Mar, Jun, Sep, Dec", () => {
    const ends = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isLastMonthOfVatPeriod("quarterly", 1, m));
    expect(ends).toEqual([3, 6, 9, 12]);
  });

  it("a quarterly filer whose periods start in February closes Apr, Jul, Oct, Jan", () => {
    const ends = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isLastMonthOfVatPeriod("quarterly", 2, m));
    expect(ends).toEqual([1, 4, 7, 10]);
  });

  it("a monthly filer ends every month; an annual filer only at the end of the year", () => {
    expect([1, 2, 3].every((m) => isLastMonthOfVatPeriod("monthly", 1, m))).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isLastMonthOfVatPeriod("annually", 1, m))).toEqual([12]);
  });

  it("reads the stored frequency leniently and defaults to quarterly", () => {
    expect(normaliseVatFrequency("Monthly")).toBe("monthly");
    expect(normaliseVatFrequency("Annually")).toBe("annually");
    expect(normaliseVatFrequency("Quarterly")).toBe("quarterly");
    expect(normaliseVatFrequency(null)).toBe("quarterly");
  });
});

describe("the VAT checklist item", () => {
  const base = { frequency: "quarterly" as const, periodStartMonth: 1 };

  it("passes when a return covers the month, including the quarterly return it belongs to", () => {
    expect(vatChecklistVerdict({ ...base, coveringReturns: 1, month: 9 })).toEqual({ complete: true, reason: "covered" });
  });

  it("does not hold up July or August for a quarterly filer", () => {
    expect(vatChecklistVerdict({ ...base, coveringReturns: 0, month: 7 })).toEqual({ complete: true, reason: "period_not_ended" });
    expect(vatChecklistVerdict({ ...base, coveringReturns: 0, month: 8 }).complete).toBe(true);
  });

  it("fails for the quarter-end month with no return, and for every month of a monthly filer", () => {
    expect(vatChecklistVerdict({ ...base, coveringReturns: 0, month: 9 })).toEqual({ complete: false, reason: "missing" });
    expect(vatChecklistVerdict({ frequency: "monthly", periodStartMonth: 1, coveringReturns: 0, month: 7 }).complete).toBe(false);
  });
});

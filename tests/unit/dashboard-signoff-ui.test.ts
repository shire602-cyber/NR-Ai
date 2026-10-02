import { describe, expect, it } from "vitest";
import { marginPercent } from "../../client/src/lib/dashboardStats";
import { helpQueryFromSearch } from "../../client/src/lib/help/search";

describe("net profit margin", () => {
  it("is a percent of revenue when there is revenue", () => {
    expect(marginPercent(25, 100)).toBe(25);
    expect(marginPercent(-50, 100)).toBe(-50);
  });

  it("is null (a dash) with zero, negative or missing revenue, never 0.0%", () => {
    expect(marginPercent(-200, -200)).toBeNull();
    expect(marginPercent(0, 0)).toBeNull();
    expect(marginPercent(10, undefined)).toBeNull();
    expect(marginPercent(10, NaN)).toBeNull();
  });
});

describe("help search deep link", () => {
  it("reads q from the query string, trimmed and capped", () => {
    expect(helpQueryFromSearch("?q=VAT")).toBe("VAT");
    expect(helpQueryFromSearch("q=%20ضريبة%20")).toBe("ضريبة");
    expect(helpQueryFromSearch(`?q=${"a".repeat(300)}`)).toHaveLength(100);
  });

  it("is empty without q", () => {
    expect(helpQueryFromSearch("")).toBe("");
    expect(helpQueryFromSearch("?x=1")).toBe("");
  });
});

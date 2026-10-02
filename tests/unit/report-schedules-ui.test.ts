import { describe, expect, it } from "vitest";
import {
  canManageSchedules,
  dubaiDateTime,
  hourLabel,
} from "../../client/src/lib/reportSchedulesApi";
import {
  selectedCompanyIds,
  hasMixedCurrencies,
} from "../../client/src/components/reports/ConsolidationCompanyPicker.logic";

describe("who sees the schedule controls", () => {
  it("owners, accountants and CFOs may change schedules; other members may not", () => {
    for (const role of ["owner", "accountant", "cfo"])
      expect(canManageSchedules({ isAdmin: false, firmRole: null }, role)).toBe(true);
    for (const role of ["employee", "viewer", "bookkeeper", null])
      expect(canManageSchedules({ isAdmin: false, firmRole: null }, role as any)).toBe(false);
  });

  it("firm staff and platform admins may, even without a company role", () => {
    expect(canManageSchedules({ isAdmin: true }, null)).toBe(true);
    expect(canManageSchedules({ firmRole: "firm_owner" }, null)).toBe(true);
    expect(canManageSchedules({ firmRole: "firm_admin" }, null)).toBe(true);
    expect(canManageSchedules(null, "owner")).toBe(false);
  });
});

describe("times shown to the person", () => {
  it("a server UTC timestamp is shown as a Dubai wall clock", () => {
    expect(dubaiDateTime("2026-10-05T03:00:00.000Z")).toBe("2026-10-05 07:00");
    expect(dubaiDateTime("2026-10-05T20:30:00.000Z")).toBe("2026-10-06 00:30");
    expect(dubaiDateTime(null)).toBe("");
    expect(dubaiDateTime("garbage")).toBe("");
  });

  it("an hour is shown as HH:00", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("the consolidation picker's choices", () => {
  const state = (companyIds?: string) =>
    ({ filters: companyIds === undefined ? {} : { companyIds } }) as any;

  it("defaults to the current company and reads a comma list", () => {
    expect(selectedCompanyIds(state(), "a")).toEqual(["a"]);
    expect(selectedCompanyIds(state("a,b"), "a")).toEqual(["a", "b"]);
    expect(selectedCompanyIds(state(""), "a")).toEqual(["a"]);
    expect(selectedCompanyIds(state(), undefined)).toEqual([]);
  });

  it("flags companies with different base currencies, which the server refuses", () => {
    const companies = [
      { id: "a", name: "A", baseCurrency: "AED" },
      { id: "b", name: "B", baseCurrency: "USD" },
      { id: "c", name: "C", baseCurrency: null },
    ];
    expect(hasMixedCurrencies(companies, ["a", "c"])).toBe(false);
    expect(hasMixedCurrencies(companies, ["a", "b"])).toBe(true);
    expect(hasMixedCurrencies(companies, ["b"])).toBe(false);
  });
});

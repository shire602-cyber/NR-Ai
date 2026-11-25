import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  costCenterDisplayName,
  costCenterPeriodLabel,
  filterCostCenters,
} from "../../client/src/lib/cost-center-view";

const rows = [
  { code: "CC-1", name: "Marketing", nameAr: "التسويق", description: null },
  { code: "CC-2", name: "Dubai Branch", nameAr: null, description: "Retail" },
];

describe("cost center search", () => {
  it("keeps all rows for a blank or whitespace query", () => {
    expect(filterCostCenters(rows, "   ")).toHaveLength(2);
  });
  it("matches code, name, description and the Arabic name", () => {
    expect(filterCostCenters(rows, "cc-2")[0].code).toBe("CC-2");
    expect(filterCostCenters(rows, "retail")[0].code).toBe("CC-2");
    expect(filterCostCenters(rows, "التسويق")[0].code).toBe("CC-1");
    expect(filterCostCenters(rows, "zzz")).toEqual([]);
  });
});

describe("cost center display name", () => {
  it("uses the Arabic name in Arabic mode and falls back to English", () => {
    expect(costCenterDisplayName(rows[0], "ar")).toBe("التسويق");
    expect(costCenterDisplayName(rows[1], "ar")).toBe("Dubai Branch");
    expect(costCenterDisplayName(rows[0], "en")).toBe("Marketing");
  });
});

describe("cost center period label", () => {
  const copy = { beginning: "B", today: "T", range: "{start} → {end}", allPeriods: "All" };
  it("localises open ends and the all-periods case", () => {
    expect(costCenterPeriodLabel(null, null, copy)).toBe("All");
    expect(costCenterPeriodLabel(null, "2026-03-31", copy)).toBe("B → 2026-03-31");
    expect(costCenterPeriodLabel("2026-01-01", null, copy)).toBe("2026-01-01 → T");
  });
});

describe("CostCenters page", () => {
  // Source-inspection: the page needs a company and API to render.
  const src = readFileSync("client/src/pages/CostCenters.tsx", "utf8");
  it("has no hardcoded English eyebrow or period words", () => {
    expect(src).not.toContain('eyebrow="Accounting"');
    expect(src).not.toContain('?? "Beginning"');
    expect(src).not.toContain('?? "today"');
  });
  it("shows an error state instead of the empty state when loading fails", () => {
    expect(src).toContain("isCostCentersError");
    expect(src).toContain("isProfitabilityError");
  });
});

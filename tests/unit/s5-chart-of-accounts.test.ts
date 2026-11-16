/**
 * S5 chart of accounts (R02-16a/b/c residuals): parent-account selection rules shared by the
 * Chart of Accounts page, CSV import/export entry points on that page, and the seeded chart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  descendantIds,
  orderByHierarchy,
  parentCandidates,
  type HierarchyAccount,
} from "../../client/src/lib/account-hierarchy";
import { defaultChartOfAccounts } from "../../server/defaultChartOfAccounts";
import { isSubTypeForType } from "../../shared/validators/accounts";

const acc = (
  id: string,
  code: string,
  type: string,
  parentId: string | null = null,
  extra: Partial<HierarchyAccount> = {}
): HierarchyAccount => ({ id, code, nameEn: `Account ${code}`, type, parentId, ...extra });

const chart: HierarchyAccount[] = [
  acc("cash", "1000", "asset"),
  acc("bank", "1020", "asset", "cash"),
  acc("bank-usd", "1021", "asset", "bank"),
  acc("ar", "1040", "asset"),
  acc("old", "1099", "asset", null, { isArchived: true }),
  acc("ap", "2010", "liability"),
];

describe("S5 parent account selection (R02-16c)", () => {
  it("offers same-type, non-archived accounts that are not the account or below it", () => {
    expect(parentCandidates(chart, "bank").map((a) => a.id)).toEqual(["cash", "ar"]);
    expect(parentCandidates(chart, "cash").map((a) => a.id)).toEqual(["ar"]);
    expect(parentCandidates(chart, "ap")).toEqual([]);
    expect(parentCandidates(chart, "missing")).toEqual([]);
  });

  it("descendants are found to any depth and a parent cycle does not loop", () => {
    expect([...descendantIds(chart, "cash")].sort()).toEqual(["bank", "bank-usd", "cash"]);
    const cyclic = [acc("a", "1", "asset", "b"), acc("b", "2", "asset", "a")];
    expect([...descendantIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
  });

  it("orders children under parents with depth and never drops rows", () => {
    const ordered = orderByHierarchy(chart, (a) => a);
    expect(ordered.map((a) => [a.id, a.depth])).toEqual([
      ["cash", 0],
      ["bank", 1],
      ["bank-usd", 2],
      ["ar", 0],
      ["old", 0],
      ["ap", 0],
    ]);
    const cyclic = orderByHierarchy(
      [acc("a", "1", "asset", "b"), acc("b", "2", "asset", "a")],
      (a) => a
    );
    expect(cyclic).toHaveLength(2);
  });

  it("the Chart of Accounts page wires parent selection, CSV export and CSV import", () => {
    const page = readFileSync(join(process.cwd(), "client/src/pages/ChartOfAccounts.tsx"), "utf8");
    expect(page).toContain("parentCandidates(");
    expect(page).toContain('apiRequest("PUT", `/api/accounts/${parentFor!.id}`');
    expect(page).toContain("/imports/chart-of-accounts/export");
    expect(page).toContain('navigate("/import?kind=chart_of_accounts")');
    const wizard = readFileSync(join(process.cwd(), "client/src/pages/ImportWizard.tsx"), "utf8");
    expect(wizard).toContain("kindFromSearch(");
  });
});

describe("S5 seeded chart (R02-16a)", () => {
  it("seeds cost of sales and other current asset accounts, with valid sub-types everywhere", () => {
    const bySub = (sub: string) => defaultChartOfAccounts.filter((a) => a.subType === sub);
    expect(bySub("cost_of_sales").map((a) => a.code)).toContain("5005");
    expect(bySub("other_current_asset").map((a) => a.code)).toContain("1080");
    for (const a of defaultChartOfAccounts) {
      if (a.subType) expect(isSubTypeForType(a.type, a.subType), a.code).toBe(true);
    }
    for (const type of ["equity", "income", "expense"]) {
      const subs = new Set(
        defaultChartOfAccounts.filter((a) => a.type === type).map((a) => a.subType)
      );
      expect(subs.size, type).toBeGreaterThan(1);
    }
    const codes = defaultChartOfAccounts.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

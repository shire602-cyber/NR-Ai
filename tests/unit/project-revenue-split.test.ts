import { describe, it, expect } from "vitest";
import { splitRevenueLegsByProject } from "../../server/services/project-revenue-split";

const ctx = { defaultAccountId: "rev", zeroRatedAccountId: "zero" };
const leg = (accountId: string, credit: number) => ({ accountId, debit: 0, credit, description: "Sales revenue" });
const line = (net: number, projectId: string | null, extra: any = {}) => ({ quantity: 1, unitPrice: net, vatRate: 0.05, projectId, ...extra });

describe("splitRevenueLegsByProject", () => {
  it("returns the legs untouched when no line has a project", () => {
    const legs = [leg("rev", 1000)];
    expect(splitRevenueLegsByProject(legs, [line(1000, null)], ctx)).toBe(legs);
  });

  it("splits a revenue leg per project in proportion to the line nets", () => {
    const out = splitRevenueLegsByProject([leg("rev", 1500)], [line(1000, "p1"), line(500, "p2")], ctx);
    expect(out.map((l) => [l.projectId, l.credit])).toEqual([["p1", 1000], ["p2", 500]]);
  });

  it("keeps lines without a project as an unprojected leg", () => {
    const out = splitRevenueLegsByProject([leg("rev", 1200)], [line(1000, "p1"), line(200, null)], ctx);
    expect(out.find((l) => l.projectId === "p1")?.credit).toBe(1000);
    expect(out.find((l) => !l.projectId)?.credit).toBe(200);
  });

  it("the pieces add up to the original leg exactly (the last one takes the remainder)", () => {
    const out = splitRevenueLegsByProject([leg("rev", 100)], [line(1, "a"), line(1, "b"), line(1, "c")], ctx);
    expect(out.reduce((s, l) => s + l.credit, 0)).toBeCloseTo(100, 10);
    expect(out).toHaveLength(3);
  });

  it("only touches the account the project lines feed", () => {
    const legs = [leg("rev", 100), leg("zero", 50)];
    const out = splitRevenueLegsByProject(legs, [line(100, "p1"), line(50, null, { vatRate: 0 })], ctx);
    expect(out.filter((l) => l.accountId === "zero")).toEqual([leg("zero", 50)]);
    expect(out.find((l) => l.accountId === "rev")?.projectId).toBe("p1");
  });

  it("splits a debit leg the same way", () => {
    const out = splitRevenueLegsByProject([{ accountId: "rev", debit: 90, credit: 0, description: "d" }], [line(60, "p1"), line(30, "p2")], ctx);
    expect(out.map((l) => [l.projectId, l.debit])).toEqual([["p1", 60], ["p2", 30]]);
  });
});

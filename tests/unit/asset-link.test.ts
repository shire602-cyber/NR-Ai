import { describe, expect, it } from "vitest";
import { billLineCost, journalCostCandidates, matchesCost, sortByCostMatch } from "../../client/src/components/assets/asset-link";

describe("billLineCost", () => {
  it("uses the line amount, else quantity times unit price", () => {
    expect(billLineCost({ id: "a", description: "Van", amount: "84000.00" })).toBe(84000);
    expect(billLineCost({ id: "b", description: "Van", quantity: "2", unit_price: "1500.50" })).toBe(3001);
    expect(billLineCost({ id: "c", description: "x", amount: null, quantity: null, unit_price: null })).toBe(0);
  });
});

describe("journalCostCandidates", () => {
  const entry = (id: string, lines: Array<[string, number, number]>, extra = {}) => ({ id, entryNumber: `JE-${id}`, date: `2026-0${id}-01`, memo: null, lines: lines.map(([code, debit, credit]) => ({ debit, credit, account: { code } })), ...extra });
  it("lists posted entries that debit 1290 with the amount debited", () => {
    const out = journalCostCandidates([entry("1", [["1290", 60000, 0], ["1020", 0, 60000]]), entry("2", [["5000", 10, 0], ["1010", 0, 10]]), entry("3", [["1290", 500, 0], ["1020", 0, 500]], { status: "draft" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "1", cost: 60000 });
  });
  it("nets a credit to 1290 and drops entries that do not add to the cost account", () => {
    expect(journalCostCandidates([entry("1", [["1290", 100, 100], ["1020", 0, 0]])])).toEqual([]);
  });
});

describe("cost matching", () => {
  it("matches to the fils and sorts matches first", () => {
    expect(matchesCost(84000, 84000)).toBe(true);
    expect(matchesCost(84000.5, 84000)).toBe(false);
    const sorted = sortByCostMatch([{ date: "2026-09-01", a: 10 }, { date: "2026-08-01", a: 84000 }, { date: "2026-09-15", a: 20 }], (i) => i.a, 84000);
    expect(sorted.map((i) => i.a)).toEqual([84000, 20, 10]);
  });
});

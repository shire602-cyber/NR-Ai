import { describe, expect, it } from "vitest";
import {
  aggregateDemand,
  buildCogsJournalLines,
  buildCogsPlan,
  planRestock,
  restockRequestFromCreditLines,
  restockAmounts,
  restockReversalAmount,
  weightedAverageCost,
  addStock,
  removeStock,
  valueOut,
  valueOfUnits,
  movementJournalLegs,
  type CostedProduct,
} from "../../server/services/inventory-costing-math";

const product = (over: Partial<CostedProduct> = {}): CostedProduct => ({
  id: "p1",
  name: "Widget",
  trackInventory: true,
  currentStock: 20,
  averageCost: 50,
  ...over,
});

describe("weightedAverageCost", () => {
  it("averages two purchases: 10 @ 40 then 10 @ 60 is 50", () => {
    const first = weightedAverageCost({ stock: 0, averageCost: 0, qty: 10, unitCost: 40 });
    expect(first).toBe(40);
    expect(weightedAverageCost({ stock: 10, averageCost: first, qty: 10, unitCost: 60 })).toBe(50);
  });

  it("weights by quantity and rounds to 6 decimals", () => {
    // (3 * 10 + 4 * 11) / 7 = 10.571428571... -> 10.571429
    expect(weightedAverageCost({ stock: 3, averageCost: 10, qty: 4, unitCost: 11 })).toBe(10.571429);
  });

  it("takes the incoming cost when nothing (or a negative balance) is on hand", () => {
    expect(weightedAverageCost({ stock: 0, averageCost: 99, qty: 5, unitCost: 7 })).toBe(7);
    expect(weightedAverageCost({ stock: -3, averageCost: 99, qty: 5, unitCost: 7 })).toBe(7);
  });

  it("leaves the average alone for a zero quantity", () => {
    expect(weightedAverageCost({ stock: 10, averageCost: 12.5, qty: 0, unitCost: 100 })).toBe(12.5);
  });
});

describe("aggregateDemand", () => {
  it("sums per product and ignores lines without a product or quantity", () => {
    const demand = aggregateDemand([
      { productId: "a", quantity: 2 },
      { productId: "a", quantity: "3" },
      { productId: null, quantity: 9 },
      { productId: "b", quantity: 0 },
      { productId: "c", quantity: -1 },
    ]);
    expect([...demand]).toEqual([["a", 5]]);
  });
});

describe("buildCogsPlan", () => {
  it("costs a sale at the average: 5 units at 50 = 250", () => {
    const plan = buildCogsPlan(new Map([["p1", 5]]), new Map([["p1", product()]]));
    expect(plan).toEqual({
      ok: true,
      total: 250,
      items: [{ productId: "p1", name: "Widget", quantity: 5, unitCost: 50, amount: 250 }],
    });
  });

  it("totals the per-product amounts (what actually leaves the products' value)", () => {
    const plan = buildCogsPlan(
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
      new Map([
        ["a", product({ id: "a", averageCost: 0.333333 })],
        ["b", product({ id: "b", averageCost: 0.333333 })],
      ])
    );
    expect(plan.ok && plan.total).toBe(0.66);
  });

  it("skips untracked and unknown products", () => {
    const plan = buildCogsPlan(
      new Map([
        ["p1", 5],
        ["ghost", 2],
      ]),
      new Map([["p1", product({ trackInventory: false })]])
    );
    expect(plan).toEqual({ ok: true, total: 0, items: [] });
  });

  it("refuses when stock is short, naming the product", () => {
    const plan = buildCogsPlan(new Map([["p1", 21]]), new Map([["p1", product()]]));
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.code).toBe("INSUFFICIENT_STOCK");
      expect(plan.details).toEqual([{ productId: "p1", name: "Widget", onHand: 20, requested: 21 }]);
    }
  });

  it("refuses fractional quantities of a tracked product", () => {
    const plan = buildCogsPlan(new Map([["p1", 1.5]]), new Map([["p1", product()]]));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("NON_INTEGER_QUANTITY");
  });
});

describe("buildCogsJournalLines", () => {
  it("posts Dr COGS / Cr Inventory and balances", () => {
    const lines = buildCogsJournalLines({ amount: 250, cogsAccountId: "cogs", inventoryAccountId: "inv", label: "Invoice 1" });
    expect(lines.find((l) => l.accountId === "cogs")).toMatchObject({ debit: 250, credit: 0 });
    expect(lines.find((l) => l.accountId === "inv")).toMatchObject({ debit: 0, credit: 250 });
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
  });

  it("flips the legs for a reversal", () => {
    const lines = buildCogsJournalLines({ amount: 250, cogsAccountId: "cogs", inventoryAccountId: "inv", label: "x", reverse: true });
    expect(lines.find((l) => l.accountId === "cogs")).toMatchObject({ debit: 0, credit: 250 });
    expect(lines.find((l) => l.accountId === "inv")).toMatchObject({ debit: 250, credit: 0 });
  });
});

describe("planRestock / restockReversalAmount", () => {
  const outstanding = [
    { productId: "a", quantity: 5, unitCost: 50 },
    { productId: "b", quantity: 2, unitCost: 10 },
  ];

  it("returns everything outstanding when no quantities are requested", () => {
    expect(planRestock(outstanding, null)).toEqual(outstanding);
  });

  it("caps a requested quantity at what is still out and drops other products", () => {
    const items = planRestock(outstanding, new Map([["a", 9]]));
    expect(items).toEqual([{ productId: "a", quantity: 5, unitCost: 50 }]);
  });

  it("restocks only the whole part of a fractional credited quantity", () => {
    expect(planRestock(outstanding, new Map([["a", 2.9]]))).toEqual([{ productId: "a", quantity: 2, unitCost: 50 }]);
  });

  it("reverses qty * cost for a partial return, never more than stands", () => {
    expect(
      restockReversalAmount({ items: [{ quantity: 2, unitCost: 50 }], returnsEverythingLeft: false, standingBalance: 250 })
    ).toBe(100);
    expect(
      restockReversalAmount({ items: [{ quantity: 9, unitCost: 50 }], returnsEverythingLeft: false, standingBalance: 250 })
    ).toBe(250);
  });

  it("reverses exactly the standing balance when everything left comes back", () => {
    expect(
      restockReversalAmount({ items: [{ quantity: 3, unitCost: 0.333333 }], returnsEverythingLeft: true, standingBalance: 1 })
    ).toBe(1);
  });
});

describe("restockRequestFromCreditLines", () => {
  const originals = [
    { id: "l1", productId: "a" },
    { id: "l2", productId: null },
  ];

  it("returns null (everything) when there are no explicit credit lines", () => {
    expect(restockRequestFromCreditLines(null, originals)).toBeNull();
  });

  it("maps credit lines to product quantities via originalLineId and ignores the rest", () => {
    const req = restockRequestFromCreditLines(
      [
        { originalLineId: "l1", quantity: 2 },
        { originalLineId: "l1", quantity: 1 },
        { originalLineId: "l2", quantity: 4 },
        { quantity: 7 },
      ],
      originals
    );
    expect([...(req as Map<string, number>)]).toEqual([["a", 3]]);
  });
});

describe("stock value tie-out", () => {
  it("3 units bought at 3.333333 sold one at a time cost exactly 10.00", () => {
    let state = addStock({ stock: 0, value: 0, averageCost: 0 }, 3, valueOfUnits(3, 3.333333));
    expect(state.value).toBe(10);
    let total = 0;
    for (let k = 0; k < 3; k++) {
      const out = valueOut(state, 1);
      total += out;
      state = removeStock(state, 1, out);
    }
    expect(Math.round(total * 100) / 100).toBe(10);
    expect(state).toMatchObject({ stock: 0, value: 0 });
  });

  it("keeps stock x average equal to the value to the cent", () => {
    let state = addStock({ stock: 0, value: 0, averageCost: 0 }, 10, valueOfUnits(10, 100));
    state = addStock(state, 2, valueOfUnits(2, 90));
    expect(state.value).toBe(1180);
    for (const qty of [4, 1]) state = removeStock(state, qty, valueOut(state, qty));
    expect(Math.round(state.stock * state.averageCost * 100) / 100).toBe(state.value);
  });

  it("the last unit takes the whole remaining value, even when stock goes below zero", () => {
    expect(valueOut({ stock: 2, value: 7.01, averageCost: 3.5 }, 2)).toBe(7.01);
    expect(valueOut({ stock: 1, value: 5, averageCost: 5 }, 3)).toBe(5);
  });

  it("refuses a sale of a product with stock but no known cost", () => {
    const plan = buildCogsPlan(new Map([["p1", 1]]), new Map([["p1", product({ averageCost: 0 })]]));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("PRODUCT_COST_UNKNOWN");
  });

  it("the last unit of an invoice line takes the whole stored value", () => {
    const plan = buildCogsPlan(new Map([["p1", 3]]), new Map([["p1", product({ currentStock: 3, averageCost: 3.333333, inventoryValue: 10 })]]));
    expect(plan.ok && plan.total).toBe(10);
  });

  it("maps each movement type to its journal legs", () => {
    expect(movementJournalLegs("purchase", true)).toEqual({ debitCode: "1070", creditCode: "2015" });
    expect(movementJournalLegs("adjustment", true)).toEqual({ debitCode: "1070", creditCode: "5210" });
    expect(movementJournalLegs("adjustment", false)).toEqual({ debitCode: "5210", creditCode: "1070" });
    expect(movementJournalLegs("sale", false)).toEqual({ debitCode: "5200", creditCode: "1070" });
    expect(movementJournalLegs("return", true)).toEqual({ debitCode: "1070", creditCode: "5200" });
  });

  it("restocks everything outstanding at exactly the value that left, a partial return pro rata", () => {
    const outstanding = [{ productId: "a", quantity: 3, unitCost: 3.333333, value: 10 }];
    expect(restockAmounts([{ productId: "a", quantity: 3, unitCost: 3.333333 }], outstanding).get("a")).toBe(10);
    expect(restockAmounts([{ productId: "a", quantity: 1, unitCost: 3.333333 }], outstanding).get("a")).toBe(3.33);
  });
});

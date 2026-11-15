/**
 * W4-B pure inventory costing (R10-14): weighted average vs FIFO, negative-stock true-up,
 * receipt reversal, write-down and ageing. Integer fils throughout.
 */
import { describe, expect, it } from "vitest";
import {
  adjustValue,
  ageLayers,
  issue,
  prorate,
  receive,
  removeReceipt,
  unitCostFils,
  type CostingOptions,
  type StockState,
} from "../../server/services/inventory/costing";

const empty = (): StockState => ({ qty: 0, valueFils: 0, layers: [] });
const WA: CostingOptions = { method: "weighted_average" };
const FIFO: CostingOptions = { method: "fifo" };

function buy(state: StockState, qty: number, unitFils: number, date: string, opts: CostingOptions) {
  return receive(state, { qty, valueFils: qty * unitFils, date }, opts).state;
}

describe("inventory costing", () => {
  it("[R10-14] weighted average: 10 @50 then 10 @70 averages 60; selling 5 costs 300 and leaves 900", () => {
    let s = buy(empty(), 10, 5000, "2026-01-01", WA);
    s = buy(s, 10, 7000, "2026-01-05", WA);
    expect(s.qty).toBe(20);
    expect(unitCostFils(s)).toBe(6000);
    const r = issue(s, 5, WA);
    expect(r.costFils).toBe(30_000);
    expect(r.state.valueFils).toBe(90_000);
    expect(r.state.qty).toBe(15);
    // Layers stay in step with the pool (ageing) and sum to the value.
    expect(r.state.layers.reduce((a, l) => a + l.valueFils, 0)).toBe(90_000);
  });

  it("[R10-14] FIFO: the same purchases cost the oldest units first: COGS 250, inventory 950", () => {
    let s = buy(empty(), 10, 5000, "2026-01-01", FIFO);
    s = buy(s, 10, 7000, "2026-01-05", FIFO);
    const r = issue(s, 5, FIFO);
    expect(r.costFils).toBe(25_000);
    expect(r.state.valueFils).toBe(95_000);
    const r2 = issue(r.state, 10, FIFO);
    // 5 left @50 + 5 @70
    expect(r2.costFils).toBe(25_000 + 35_000);
    expect(r2.state.valueFils).toBe(35_000);
  });

  it("[R10-09] issuing more than on hand is INSUFFICIENT_STOCK unless negative stock is allowed", () => {
    const s = buy(empty(), 5, 1000, "2026-01-01", WA);
    expect(() => issue(s, 6, WA)).toThrow(/Insufficient stock/);
    const neg = issue(s, 6, { ...WA, allowNegative: true });
    expect(neg.state.qty).toBe(-1);
    expect(neg.costFils).toBe(6000);
    expect(neg.state.valueFils).toBe(-1000);
    // The next receipt fills the hole and trues up the estimate (cost 1200 vs 1000 estimated).
    const r = receive(neg.state, { qty: 3, valueFils: 3600, date: "2026-01-09" }, WA);
    expect(r.trueUpFils).toBe(200);
    expect(r.state.qty).toBe(2);
    expect(r.state.valueFils).toBe(2400);
  });

  it("[R10-14] last unit out takes the exact remaining value (no rounding residue)", () => {
    let s = receive(empty(), { qty: 3, valueFils: 1000, date: "2026-01-01" }, WA).state;
    const a = issue(s, 1, WA);
    const b = issue(a.state, 1, WA);
    const c = issue(b.state, 1, WA);
    expect(a.costFils + b.costFils + c.costFils).toBe(1000);
    expect(c.state.valueFils).toBe(0);
    s = c.state;
    expect(s.layers).toHaveLength(0);
  });

  it("[R10-15] reversing a FIFO receipt whose layer was partly sold removes the remaining layer value", () => {
    let s = buy(empty(), 10, 5000, "2026-01-01", FIFO);
    s.layers[0].id = "L1";
    s = buy(s, 10, 7000, "2026-01-05", FIFO);
    s.layers[1].id = "L2";
    const sold = issue(s, 12, FIFO).state; // consumes L1 fully + 2 of L2
    const r = removeReceipt(sold, { qty: 8, valueFils: 70_000, layerId: "L2" }, FIFO);
    expect(r.removedFils).toBe(56_000);
    expect(r.state.qty).toBe(0);
    expect(r.state.valueFils).toBe(0);
  });

  it("[R10-15] write-down reduces value without moving quantity and cannot exceed the value", () => {
    const s = buy(empty(), 4, 2500, "2026-01-01", FIFO);
    const w = adjustValue(s, -4000, FIFO);
    expect(w.qty).toBe(4);
    expect(w.valueFils).toBe(6000);
    expect(w.layers[0].valueFils).toBe(6000);
    expect(() => adjustValue(s, -20_000, FIFO)).toThrow(/write-down/);
  });

  it("[R10-15] ageing buckets layers by days on hand", () => {
    const buckets = ageLayers(
      [
        { date: "2026-03-01", qty: 2, valueFils: 200 },
        { date: "2025-10-01", qty: 1, valueFils: 50 },
      ],
      "2026-03-20"
    );
    expect(buckets[0]).toMatchObject({ label: "0-30", qty: 2, valueFils: 200 });
    expect(buckets.find((b) => b.label === "91-180")).toMatchObject({ qty: 1, valueFils: 50 });
  });

  it("prorate rounds half up on big integers", () => {
    expect(prorate(1000, 1, 3)).toBe(333);
    expect(prorate(1001, 1, 2)).toBe(501);
    expect(prorate(-1001, 1, 2)).toBe(-501);
    expect(prorate(99_999_999_999_999, 7, 9)).toBe(77_777_777_777_777);
  });
});

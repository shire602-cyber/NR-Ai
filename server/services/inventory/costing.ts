/**
 * Pure inventory costing (W4-B: R10-14). Integer fils, integer quantities, no I/O.
 *
 * A product's stock is a `StockState`: quantity on hand, value on hand (fils, the figure that
 * must equal the inventory GL account) and FIFO quantity layers (oldest first). Both methods keep
 * the layers (stock ageing needs them); they differ only in how an issue is costed:
 *
 *   weighted_average  cost = value × issued / on hand (exact remainder when the stock empties);
 *                     layer values are re-spread over layer quantities after every operation.
 *   fifo              cost = sum of the oldest layers consumed (each layer keeps its own value).
 *
 * Negative stock (only when the company allows it): the shortfall is costed at the current unit
 * cost (or the product's fallback cost) and value goes negative; the next receipt "fills" the hole
 * and the difference between the estimate and the actual cost is returned as `trueUpFils` (a
 * debit to COGS when positive) so the ledger and the valuation stay equal.
 */
import { DomainError } from "../../errors";

export type CostingMethod = "weighted_average" | "fifo";
export const COSTING_METHODS: readonly CostingMethod[] = ["weighted_average", "fifo"];

export interface CostLayer {
  id?: string;
  date: string;
  qty: number;
  valueFils: number;
  lot?: string | null;
  /** Set on layers created by the operation (the caller inserts them). */
  isNew?: boolean;
}

export interface StockState {
  qty: number;
  valueFils: number;
  layers: CostLayer[];
}

export interface CostingOptions {
  method: CostingMethod;
  allowNegative?: boolean;
  /** Unit cost (fils) used for a shortfall when nothing is on hand. */
  fallbackUnitCostFils?: number;
}

/** round-half-up(total × part / whole) on BigInt, so large values never lose precision. */
export function prorate(totalFils: number, part: number, whole: number): number {
  if (whole === 0) return 0;
  if (part === whole) return totalFils;
  const neg = (totalFils < 0 !== part < 0) !== whole < 0;
  const n = BigInt(Math.abs(totalFils)) * BigInt(Math.abs(part));
  const d = BigInt(Math.abs(whole));
  const q = (n * 2n + d) / (2n * d);
  const v = Number(q);
  return neg ? -v : v;
}

function cloneLayers(layers: CostLayer[]): CostLayer[] {
  return layers.map((l) => ({ ...l }));
}

/** Weighted average: spread the pool value over the layers by quantity (exact, largest remainder). */
function respread(state: StockState): StockState {
  const layers = state.layers.filter((l) => l.qty > 0);
  const totalQty = layers.reduce((s, l) => s + l.qty, 0);
  if (layers.length === 0 || totalQty === 0) return { ...state, layers };
  let assigned = 0;
  layers.forEach((l, i) => {
    if (i === layers.length - 1) {
      l.valueFils = state.valueFils - assigned;
    } else {
      l.valueFils = prorate(state.valueFils, l.qty, totalQty);
      assigned += l.valueFils;
    }
  });
  return { ...state, layers };
}

function currentUnitCost(state: StockState, opts: CostingOptions): number {
  if (state.qty > 0) return prorate(state.valueFils, 1, state.qty);
  const last = [...state.layers].reverse().find((l) => l.qty > 0);
  if (last) return prorate(last.valueFils, 1, last.qty);
  return Math.max(0, opts.fallbackUnitCostFils ?? 0);
}

export interface ReceiveResult {
  state: StockState;
  /** Positive: debit COGS / credit inventory (negative-stock fill true-up). */
  trueUpFils: number;
  layer: CostLayer | null;
}

/** Stock in: `qty` units costing `valueFils` in total. */
export function receive(
  state: StockState,
  input: { qty: number; valueFils: number; date: string; lot?: string | null },
  _opts: CostingOptions
): ReceiveResult {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new DomainError("INVALID_QUANTITY", 422, { qty: input.qty });
  }
  if (!Number.isSafeInteger(input.valueFils) || input.valueFils < 0) {
    throw new DomainError("INVALID_AMOUNT", 422, { valueFils: input.valueFils });
  }
  let trueUpFils = 0;
  let qtyIn = input.qty;
  let valueIn = input.valueFils;
  let baseQty = state.qty;
  let baseValue = state.valueFils;
  if (state.qty < 0) {
    const fill = Math.min(input.qty, -state.qty);
    const inFill = prorate(input.valueFils, fill, input.qty);
    const negPortion =
      fill === -state.qty ? state.valueFils : prorate(state.valueFils, fill, -state.qty);
    // Goods already expensed at an estimate (-negPortion) actually cost inFill.
    trueUpFils = inFill + negPortion;
    baseQty = state.qty + fill;
    baseValue = state.valueFils - negPortion;
    qtyIn -= fill;
    valueIn -= inFill;
  }
  const layers = cloneLayers(state.layers);
  let layer: CostLayer | null = null;
  if (qtyIn > 0) {
    layer = {
      date: input.date,
      qty: qtyIn,
      valueFils: valueIn,
      lot: input.lot ?? null,
      isNew: true,
    };
    layers.push(layer);
  }
  const next: StockState = { qty: baseQty + qtyIn, valueFils: baseValue + valueIn, layers };
  return { state: next, trueUpFils, layer };
}

export interface IssueResult {
  state: StockState;
  costFils: number;
  shortfallQty: number;
}

function insufficient(state: StockState, qty: number): never {
  throw new DomainError(
    "INSUFFICIENT_STOCK",
    422,
    { onHand: state.qty, requested: qty },
    `Insufficient stock: ${state.qty} on hand, ${qty} requested. Record a stock adjustment if the on-hand figure is wrong.`
  );
}

/** Consume `qty` from the layers oldest-first; returns the consumed value (layer values). */
function consumeLayers(layers: CostLayer[], qty: number): number {
  let left = qty;
  let value = 0;
  for (const l of layers) {
    if (left <= 0) break;
    if (l.qty <= 0) continue;
    const take = Math.min(l.qty, left);
    const v = take === l.qty ? l.valueFils : prorate(l.valueFils, take, l.qty);
    l.qty -= take;
    l.valueFils -= v;
    value += v;
    left -= take;
  }
  return value;
}

/** Stock out: cost `qty` units by the method; refuses to go negative unless allowed. */
export function issue(state: StockState, qty: number, opts: CostingOptions): IssueResult {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError("INVALID_QUANTITY", 422, { qty });
  }
  const available = Math.max(0, state.qty);
  if (qty > available && !opts.allowNegative) insufficient(state, qty);
  const fromStock = Math.min(qty, available);
  const shortfallQty = qty - fromStock;
  const layers = cloneLayers(state.layers);
  let costFils = 0;
  if (fromStock > 0) {
    if (opts.method === "fifo") {
      costFils = consumeLayers(layers, fromStock);
    } else {
      costFils =
        fromStock === state.qty ? state.valueFils : prorate(state.valueFils, fromStock, state.qty);
      consumeLayers(layers, fromStock);
    }
  }
  if (shortfallQty > 0) {
    costFils += currentUnitCost(state, opts) * shortfallQty;
  }
  let next: StockState = {
    qty: state.qty - qty,
    valueFils: state.valueFils - costFils,
    layers: layers.filter((l) => l.qty > 0 || l.id),
  };
  if (opts.method === "weighted_average") next = respread(next);
  return { state: next, costFils, shortfallQty };
}

/**
 * Reverse a receipt: take back `qty` units that came in at `valueFils` (preferring the layer it
 * created). Returns the value actually removed from stock; the caller posts
 * `valueFils - removedFils` as a true-up (the mirrored journal removes `valueFils`).
 */
export function removeReceipt(
  state: StockState,
  input: { qty: number; valueFils: number; layerId?: string | null },
  opts: CostingOptions
): { state: StockState; removedFils: number } {
  const available = Math.max(0, state.qty);
  if (input.qty > available && !opts.allowNegative) insufficient(state, input.qty);
  const layers = cloneLayers(state.layers);
  let removedFils: number;
  if (opts.method === "fifo") {
    const own = input.layerId ? layers.find((l) => l.id === input.layerId) : undefined;
    let left = Math.min(input.qty, available);
    removedFils = 0;
    if (own && own.qty > 0) {
      const take = Math.min(own.qty, left);
      const v = take === own.qty ? own.valueFils : prorate(own.valueFils, take, own.qty);
      own.qty -= take;
      own.valueFils -= v;
      removedFils += v;
      left -= take;
    }
    if (left > 0) removedFils += consumeLayers(layers, left);
    const short = input.qty - Math.min(input.qty, available);
    if (short > 0) removedFils += currentUnitCost(state, opts) * short;
  } else {
    consumeLayers(layers, Math.min(input.qty, available));
    removedFils = input.valueFils;
  }
  let next: StockState = {
    qty: state.qty - input.qty,
    valueFils: state.valueFils - removedFils,
    layers: layers.filter((l) => l.qty > 0 || l.id),
  };
  if (next.qty === 0 && next.valueFils !== 0) {
    // Nothing left on hand: no value may remain either.
    removedFils += next.valueFils;
    next = { ...next, valueFils: 0 };
  }
  if (opts.method === "weighted_average") next = respread(next);
  return { state: next, removedFils };
}

/** Change the value without moving quantity (write-down / write-up). */
export function adjustValue(
  state: StockState,
  deltaFils: number,
  opts: CostingOptions
): StockState {
  if (deltaFils < 0 && state.valueFils + deltaFils < 0) {
    throw new DomainError(
      "WRITE_DOWN_EXCEEDS_VALUE",
      422,
      { valueFils: state.valueFils, deltaFils },
      "A write-down cannot exceed the value on hand"
    );
  }
  const layers = cloneLayers(state.layers);
  const next: StockState = { qty: state.qty, valueFils: state.valueFils + deltaFils, layers };
  if (opts.method === "weighted_average" || layers.length === 0) return respread(next);
  // FIFO: spread the change over the layers by their value (quantity when values are zero).
  const live = layers.filter((l) => l.qty > 0);
  const totalValue = live.reduce((s, l) => s + l.valueFils, 0);
  const weights = totalValue > 0 ? live.map((l) => l.valueFils) : live.map((l) => l.qty);
  const whole = weights.reduce((s, w) => s + w, 0);
  let assigned = 0;
  live.forEach((l, i) => {
    const part =
      i === live.length - 1 ? deltaFils - assigned : prorate(deltaFils, weights[i], whole);
    l.valueFils += part;
    assigned += part;
  });
  return next;
}

/** Weighted-average unit cost (fils), 0 when nothing is on hand. */
export function unitCostFils(state: StockState): number {
  return state.qty > 0 ? prorate(state.valueFils, 1, state.qty) : 0;
}

/** Stock ageing buckets (days since the layer date) for the layers on hand. */
export function ageLayers(
  layers: CostLayer[],
  asOf: string,
  buckets: readonly number[] = [30, 60, 90, 180]
): Array<{ label: string; qty: number; valueFils: number }> {
  const out = [...buckets, Infinity].map((max, i) => ({
    label:
      max === Infinity
        ? `${buckets[buckets.length - 1] + 1}+`
        : `${i === 0 ? 0 : buckets[i - 1] + 1}-${max}`,
    max,
    qty: 0,
    valueFils: 0,
  }));
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  for (const l of layers) {
    if (l.qty <= 0) continue;
    const days = Math.max(0, Math.floor((asOfMs - Date.parse(`${l.date}T00:00:00Z`)) / 86_400_000));
    const b = out.find((x) => days <= x.max)!;
    b.qty += l.qty;
    b.valueFils += l.valueFils;
  }
  return out.map(({ label, qty, valueFils }) => ({ label, qty, valueFils }));
}

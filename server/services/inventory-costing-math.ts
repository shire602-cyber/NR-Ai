// Pure weighted-average costing and COGS math (no I/O). See inventory-costing.service.ts for the
// ledger and stock side.

import Decimal from "decimal.js";

const COST_DECIMALS = 6;
const toMoney = (d: Decimal): number => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

// ---------------------------------------------------------------------------
// Stock VALUE (what the ledger's Inventory account must hold)
//
// Every product carries `stock`, `value` (money, 2 dp) and `averageCost` (6 dp). Value goes in at the
// cost of what arrives, comes out at the average, and the LAST unit out takes the whole remaining
// value, so rounding never leaves a residue on the ledger. The average is always value / stock, so
// stock x average equals the value to the cent. Every journal this service posts uses these exact
// amounts, which is what keeps account 1070 equal to the sum of the stock values.
// ---------------------------------------------------------------------------

export interface StockState {
  stock: number;
  value: number;
  averageCost: number;
}

/** Value of `qty` units at `unitCost`, rounded to 2 dp (what a purchase posts to the ledger). */
export function valueOfUnits(qty: number, unitCost: number): number {
  return toMoney(new Decimal(qty).times(unitCost));
}

const averageOf = (stock: number, value: Decimal, fallback: number): number =>
  stock > 0 ? value.div(stock).toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP).toNumber() : fallback;

/** Stock arrives carrying `amount` of value. */
export function addStock(state: StockState, qty: number, amount: number): StockState {
  const stock = state.stock + qty;
  const value = new Decimal(state.value).plus(amount);
  return { stock, value: value.toNumber(), averageCost: averageOf(stock, value, state.averageCost) };
}

/**
 * Value taken out for `qty` units: qty x average, except that the last unit (stock reaching zero
 * or below) takes everything that is left. Never more than the value on hand.
 */
export function valueOut(state: StockState, qty: number): number {
  const onHand = Math.max(state.value, 0);
  if (state.stock - qty <= 0) return onHand;
  return Math.min(valueOfUnits(qty, state.averageCost), onHand);
}

/** Stock leaves carrying `amount` of value (from `valueOut`, or the exact amount it came in at). */
export function removeStock(state: StockState, qty: number, amount: number): StockState {
  const stock = state.stock - qty;
  const value = new Decimal(state.value).minus(amount);
  return { stock, value: value.toNumber(), averageCost: averageOf(stock, value, state.averageCost) };
}

/** Stock value as `stock x averageCost`, rounded to 2 dp (backfill and opening journal). */
export function stockValueAtAverage(stock: number, averageCost: number): number {
  return stock > 0 ? valueOfUnits(stock, averageCost) : 0;
}

export interface MovementJournalPlan {
  debitCode: "1070" | "2015" | "5210" | "5200";
  creditCode: "1070" | "2015" | "5210" | "5200";
}

/**
 * The legs of the journal a manual stock movement posts (amounts are the value in/out):
 * purchase Dr 1070 / Cr 2015 (goods received not invoiced), adjustment in Dr 1070 / Cr 5210,
 * adjustment out Dr 5210 / Cr 1070, sale Dr 5200 / Cr 1070, return Dr 1070 / Cr 5200.
 */
export function movementJournalLegs(type: "purchase" | "sale" | "adjustment" | "return", inbound: boolean): MovementJournalPlan {
  if (type === "purchase") return { debitCode: "1070", creditCode: "2015" };
  if (type === "return") return { debitCode: "1070", creditCode: "5200" };
  if (type === "sale") return { debitCode: "5200", creditCode: "1070" };
  return inbound ? { debitCode: "1070", creditCode: "5210" } : { debitCode: "5210", creditCode: "1070" };
}

/**
 * Weighted-average cost after `qty` units arrive at `unitCost`. When there is no stock on hand
 * (zero or negative after a stock-take correction) the incoming cost simply becomes the average.
 */
export function weightedAverageCost(input: {
  stock: number;
  averageCost: number;
  qty: number;
  unitCost: number;
}): number {
  const { stock, averageCost, qty, unitCost } = input;
  if (qty <= 0) return new Decimal(averageCost).toDecimalPlaces(COST_DECIMALS).toNumber();
  if (stock <= 0) return new Decimal(unitCost).toDecimalPlaces(COST_DECIMALS).toNumber();
  const value = new Decimal(stock).times(averageCost).plus(new Decimal(qty).times(unitCost));
  return value.div(stock + qty).toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

export interface CostedProduct {
  id: string;
  name: string;
  trackInventory: boolean;
  currentStock: number;
  averageCost: number;
  /** Value on the ledger for this stock; defaults to stock x average when not supplied. */
  inventoryValue?: number;
}

export interface CogsItem {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  amount: number;
}

export type CogsPlan =
  | { ok: true; items: CogsItem[]; total: number }
  | {
      ok: false;
      code: "INSUFFICIENT_STOCK" | "NON_INTEGER_QUANTITY" | "PRODUCT_COST_UNKNOWN";
      message: string;
      details: Array<Record<string, unknown>>;
    };

/** Sum quantities per product; lines without a product or with a non-positive quantity are ignored. */
export function aggregateDemand(
  lines: Array<{ productId?: string | null; quantity: number | string }>
): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!line.productId || !(qty > 0)) continue;
    demand.set(line.productId, new Decimal(demand.get(line.productId) ?? 0).plus(qty).toNumber());
  }
  return demand;
}

/**
 * What an invoice consumes: per tracked product, the quantity at its current average cost (the last
 * unit takes the whole remaining value), and the COGS total = the sum of the item amounts, which are
 * exactly what leaves the products' value and the Inventory account. Untracked / unknown products
 * are skipped. Refuses (no partial result) when any product is short of stock, sold in a fractional
 * quantity, or has stock on hand but no known cost (PRODUCT_COST_UNKNOWN).
 */
export function buildCogsPlan(demand: Map<string, number>, productsById: Map<string, CostedProduct>): CogsPlan {
  const items: CogsItem[] = [];
  const short: Array<Record<string, unknown>> = [];
  const fractional: Array<Record<string, unknown>> = [];
  const costUnknown: Array<Record<string, unknown>> = [];
  let total = new Decimal(0);

  for (const [productId, quantity] of demand) {
    const product = productsById.get(productId);
    if (!product || !product.trackInventory) continue;
    if (!Number.isInteger(quantity)) {
      fractional.push({ productId, name: product.name, requested: quantity });
      continue;
    }
    if (quantity > product.currentStock) {
      short.push({ productId, name: product.name, onHand: product.currentStock, requested: quantity });
      continue;
    }
    if (!(product.averageCost > 0) && product.currentStock > 0) {
      costUnknown.push({ productId, name: product.name, onHand: product.currentStock, requested: quantity });
      continue;
    }
    const state: StockState = {
      stock: product.currentStock,
      value: product.inventoryValue ?? stockValueAtAverage(product.currentStock, product.averageCost),
      averageCost: product.averageCost,
    };
    const amount = valueOut(state, quantity);
    total = total.plus(amount);
    items.push({ productId, name: product.name, quantity, unitCost: product.averageCost, amount });
  }

  if (fractional.length > 0) {
    return {
      ok: false,
      code: "NON_INTEGER_QUANTITY",
      message: `Stock is counted in whole units. Use a whole quantity for: ${fractional.map((f) => f.name).join(", ")}.`,
      details: fractional,
    };
  }
  if (costUnknown.length > 0) {
    return {
      ok: false,
      code: "PRODUCT_COST_UNKNOWN",
      message: `The cost of ${costUnknown.map((c) => c.name).join(", ")} is not known (average cost 0 with stock on hand). Record a purchase with its unit cost, or an adjustment with a cost, before invoicing it.`,
      details: costUnknown,
    };
  }
  if (short.length > 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: `Insufficient stock: ${short
        .map((s) => `${s.name} (${s.onHand} on hand, ${s.requested} requested)`)
        .join("; ")}. Record a stock purchase or adjustment first.`,
      details: short,
    };
  }
  return { ok: true, items, total: toMoney(total) };
}

/** The two legs of a COGS journal (or of its reversal when `reverse`). */
export function buildCogsJournalLines(args: {
  amount: number;
  cogsAccountId: string;
  inventoryAccountId: string;
  label: string;
  reverse?: boolean;
}) {
  const { amount, cogsAccountId, inventoryAccountId, label, reverse } = args;
  const cogsLeg = { accountId: cogsAccountId, debit: reverse ? 0 : amount, credit: reverse ? amount : 0, description: `Cost of goods sold - ${label}` };
  const stockLeg = { accountId: inventoryAccountId, debit: reverse ? amount : 0, credit: reverse ? 0 : amount, description: `Inventory - ${label}` };
  return reverse ? [stockLeg, cogsLeg] : [cogsLeg, stockLeg];
}

export interface OutstandingStock {
  productId: string;
  name?: string;
  /** Sold on the invoice and not yet returned. */
  quantity: number;
  /** Unit cost the stock left at. */
  unitCost: number;
  /** Value that left with it (sold minus already returned); defaults to quantity x unitCost. */
  value?: number;
}

/**
 * Value each restock item puts back: everything still outstanding for the product when all of it
 * returns (exactly what left, whatever the rounding), a pro-rata share of it for a partial return.
 */
export function restockAmounts(
  items: Array<{ productId: string; quantity: number; unitCost: number }>,
  outstanding: OutstandingStock[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const o = outstanding.find((x) => x.productId === item.productId);
    const outValue = new Decimal(o?.value ?? new Decimal(o?.quantity ?? item.quantity).times(item.unitCost).toNumber());
    const outQty = o?.quantity ?? item.quantity;
    const amount = item.quantity >= outQty || outQty <= 0 ? toMoney(outValue) : toMoney(outValue.times(item.quantity).div(outQty));
    out.set(item.productId, Math.max(0, amount));
  }
  return out;
}

/**
 * Which quantities to bring back. `requested = null` returns everything still outstanding; a map
 * returns up to the requested quantity per product, never more than was sold and not yet returned.
 */
export function planRestock(
  outstanding: OutstandingStock[],
  requested: Map<string, number> | null
): Array<{ productId: string; quantity: number; unitCost: number }> {
  const out: Array<{ productId: string; quantity: number; unitCost: number }> = [];
  for (const o of outstanding) {
    if (o.quantity <= 0) continue;
    // Stock is counted in whole units: a fractional credited quantity restocks its whole part.
    const want = requested === null ? o.quantity : Math.floor(Math.min(requested.get(o.productId) ?? 0, o.quantity));
    if (want > 0) out.push({ productId: o.productId, quantity: want, unitCost: o.unitCost });
  }
  return out;
}

/**
 * Amount to reverse. Returning everything that is left reverses exactly what is still standing on
 * the ledger (so 5200 / 1070 land on 0.00 whatever the rounding); a partial return reverses
 * qty * cost, never more than stands.
 */
export function restockReversalAmount(args: {
  items: Array<{ quantity: number; unitCost: number }>;
  returnsEverythingLeft: boolean;
  standingBalance: number;
}): number {
  const { items, returnsEverythingLeft, standingBalance } = args;
  if (returnsEverythingLeft) return Math.max(0, standingBalance);
  const exact = items.reduce((s, i) => s.plus(new Decimal(i.quantity).times(i.unitCost)), new Decimal(0));
  return Math.min(toMoney(exact), Math.max(0, standingBalance));
}


/**
 * Quantities a restocking credit note brings back, from the credit lines that name the original
 * line they credit (`originalLineId`). Lines that name no original line carry no stock effect.
 * Returns null (everything outstanding) when the credit note has no explicit lines (full credit).
 */
export function restockRequestFromCreditLines(
  creditLines: Array<{ originalLineId?: string | null; quantity: number }> | null,
  originalLines: Array<{ id: string; productId?: string | null }>
): Map<string, number> | null {
  if (!creditLines) return null;
  const byId = new Map(originalLines.map((l) => [l.id, l]));
  const requested = new Map<string, number>();
  for (const cl of creditLines) {
    const original = cl.originalLineId ? byId.get(cl.originalLineId) : undefined;
    if (!original?.productId || !(cl.quantity > 0)) continue;
    requested.set(
      original.productId,
      new Decimal(requested.get(original.productId) ?? 0).plus(cl.quantity).toNumber()
    );
  }
  return requested;
}

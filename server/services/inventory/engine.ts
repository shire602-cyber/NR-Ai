/**
 * Inventory engine (W4-B: R10-01, R10-09, R10-14, R10-15, R10-16). Every operation runs on the
 * caller's ledger transaction: it locks the product, applies the pure costing function, writes the
 * movement + layers + stock level, and returns the change in stock value so the caller's journal
 * can book exactly that amount to the inventory account. Valuation therefore always equals GL.
 */
import { sql } from "drizzle-orm";
import { DomainError } from "../../errors";
import { emitDomainEvent } from "../../platform/domain-events";
import { postJournal, type LedgerTx, type PostJournalLineInput } from "../../ledger";
import {
  adjustValue,
  issue,
  receive,
  removeReceipt,
  unitCostFils,
  type CostingOptions,
  type StockState,
} from "./costing";
import {
  bumpLevel,
  defaultWarehouse,
  filsOfNumeric,
  insertMovement,
  isStocked,
  levelOf,
  loadPolicy,
  loadState,
  lockProduct,
  productAccounts,
  saveState,
  type InventoryPolicy,
  type MovementRow,
  type ProductRow,
} from "./store";

export interface MoveContext {
  companyId: string;
  actorId?: string | null;
  date: string;
  sourceType: string;
  sourceId?: string | null;
  sourceLineId?: string | null;
  reference?: string | null;
  notes?: string | null;
  warehouseId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  idempotencyKey?: string | null;
  meta?: Record<string, unknown> | null;
  /** Hooks for after-commit side effects (reorder alerts). */
  afterCommit?: (cb: () => void | Promise<void>) => void;
}

export interface MoveResult {
  movementId: string;
  product: ProductRow;
  accounts: { inventory: string; cogs: string };
  /** new stock value − old stock value (fils). Book this to the inventory account. */
  stockDeltaFils: number;
  /** Cost of an issue (fils, positive). */
  costFils: number;
  newQty: number;
  warning?: "NEGATIVE_STOCK";
}

const policyCache = new WeakMap<object, Map<string, InventoryPolicy>>();
async function policyFor(tx: LedgerTx, companyId: string): Promise<InventoryPolicy> {
  let m = policyCache.get(tx as object);
  if (!m) policyCache.set(tx as object, (m = new Map()));
  const hit = m.get(companyId);
  if (hit) return hit;
  const p = await loadPolicy(tx, companyId);
  m.set(companyId, p);
  return p;
}

function optsFor(p: ProductRow, policy: InventoryPolicy): CostingOptions {
  return {
    method: policy.method,
    allowNegative: policy.allowNegative,
    fallbackUnitCostFils: filsOfNumeric(p.cost_price),
  };
}

async function finish(
  tx: LedgerTx,
  p: ProductRow,
  ctx: MoveContext,
  before: StockState,
  after: StockState,
  type: string,
  signedQty: number,
  extra: { costFils?: number; reversesMovementId?: string | null; unitCostFils?: number | null }
): Promise<MoveResult> {
  const warehouseId = ctx.warehouseId ?? (await defaultWarehouse(tx, ctx.companyId));
  const stockDeltaFils = after.valueFils - before.valueFils;
  const movementId = await insertMovement(tx, {
    companyId: ctx.companyId,
    productId: p.id,
    type,
    quantity:
      type === "sale" || type === "purchase" || type === "return" ? Math.abs(signedQty) : signedQty,
    unitCostFils:
      extra.unitCostFils ??
      (signedQty !== 0 ? Math.round(Math.abs(stockDeltaFils) / Math.abs(signedQty)) : null),
    totalCostFils: stockDeltaFils,
    date: ctx.date,
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    sourceLineId: ctx.sourceLineId,
    warehouseId,
    lotNumber: ctx.lotNumber,
    serialNumber: ctx.serialNumber,
    reference: ctx.reference,
    notes: ctx.notes,
    reversesMovementId: extra.reversesMovementId,
    idempotencyKey: ctx.idempotencyKey,
    meta: ctx.meta,
    actorId: ctx.actorId,
  });
  await saveState(tx, p, before, after, movementId);
  if (signedQty !== 0) await bumpLevel(tx, ctx.companyId, p.id, warehouseId, signedQty);
  const accounts = await productAccounts(tx, p);
  if (
    signedQty < 0 &&
    p.reorder_point !== null &&
    p.reorder_point !== undefined &&
    after.qty <= Number(p.reorder_point) &&
    before.qty > Number(p.reorder_point) &&
    ctx.afterCommit
  ) {
    const payload = { companyId: ctx.companyId, entityId: p.id, dueDate: ctx.date };
    ctx.afterCommit(() => emitDomainEvent("task.due", payload));
  }
  return {
    movementId,
    product: p,
    accounts,
    stockDeltaFils,
    costFils: extra.costFils ?? 0,
    newQty: after.qty,
    warning: after.qty < 0 ? "NEGATIVE_STOCK" : undefined,
  };
}

function assertStockedProduct(p: ProductRow): void {
  if (!isStocked(p)) {
    throw new DomainError(
      "PRODUCT_NOT_STOCKED",
      422,
      { productId: p.id, productType: p.product_type },
      "This product does not track inventory"
    );
  }
}

function assertWholeQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError(
      "FRACTIONAL_STOCK_QUANTITY",
      422,
      { quantity: qty },
      "Stock quantities must be whole positive numbers"
    );
  }
}

/** Stock in `qty` at `valueFils` total cost. */
export async function stockIn(
  tx: LedgerTx,
  productId: string,
  qty: number,
  valueFils: number,
  ctx: MoveContext,
  type = "purchase"
): Promise<MoveResult> {
  assertWholeQty(qty);
  const p = await lockProduct(tx, ctx.companyId, productId);
  assertStockedProduct(p);
  const policy = await policyFor(tx, ctx.companyId);
  const before = await loadState(tx, p);
  const r = receive(
    before,
    { qty, valueFils, date: ctx.date, lot: ctx.lotNumber },
    optsFor(p, policy)
  );
  return finish(tx, p, ctx, before, r.state, type, qty, {
    unitCostFils: Math.round(valueFils / qty),
  });
}

/** Stock out `qty` at the method's cost (422 INSUFFICIENT_STOCK unless negative stock is allowed). */
export async function stockOut(
  tx: LedgerTx,
  productId: string,
  qty: number,
  ctx: MoveContext,
  type = "sale"
): Promise<MoveResult> {
  assertWholeQty(qty);
  const p = await lockProduct(tx, ctx.companyId, productId);
  assertStockedProduct(p);
  const policy = await policyFor(tx, ctx.companyId);
  const before = await loadState(tx, p);
  const r = issue(before, qty, optsFor(p, policy));
  return finish(tx, p, ctx, before, r.state, type, -qty, { costFils: r.costFils });
}

/** Current unit cost (fils) of a product, falling back to its cost price. */
export async function currentUnitCost(tx: LedgerTx, companyId: string, productId: string) {
  const p = await lockProduct(tx, companyId, productId);
  const s = await loadState(tx, p);
  return s.qty > 0 ? unitCostFils(s) : filsOfNumeric(p.cost_price);
}

/** Write a product's value down (negative delta) or up, quantity unchanged. */
export async function revalueStock(
  tx: LedgerTx,
  productId: string,
  deltaFils: number,
  ctx: MoveContext
): Promise<MoveResult> {
  const p = await lockProduct(tx, ctx.companyId, productId);
  assertStockedProduct(p);
  const policy = await policyFor(tx, ctx.companyId);
  const before = await loadState(tx, p);
  const after = adjustValue(before, deltaFils, optsFor(p, policy));
  return finish(tx, p, ctx, before, after, "write_down", 0, { unitCostFils: null });
}

/**
 * Reverse one live movement (void / revise / unmatch). Inbound movements are taken back at their
 * own value, outbound ones are put back at the cost they left at. Returns the stock delta; the
 * caller compares it with what the mirrored journal booked and posts the difference.
 */
export async function reverseMovement(
  tx: LedgerTx,
  m: MovementRow,
  ctx: MoveContext
): Promise<MoveResult> {
  const p = await lockProduct(tx, ctx.companyId, m.product_id);
  const policy = await policyFor(tx, ctx.companyId);
  const before = await loadState(tx, p);
  const recorded = filsOfNumeric(m.total_cost);
  const signedQty = stockChangeOf(m);
  const opts = optsFor(p, policy);
  // A reversal restores what was there: it is never blocked by the negative-stock policy.
  opts.allowNegative = true;
  let after: StockState;
  if (signedQty > 0) {
    after = removeReceipt(
      before,
      { qty: signedQty, valueFils: recorded, layerId: m.layer_id },
      opts
    ).state;
  } else if (signedQty < 0) {
    after = receive(
      before,
      { qty: -signedQty, valueFils: Math.max(0, -recorded), date: ctx.date },
      opts
    ).state;
  } else {
    after = adjustValue(before, -recorded, { ...opts });
  }
  return finish(
    tx,
    p,
    { ...ctx, warehouseId: m.warehouse_id ?? ctx.warehouseId },
    before,
    after,
    "reversal",
    -signedQty,
    { reversesMovementId: m.id, unitCostFils: null }
  );
}

/** Signed stock change of a stored movement. */
export function stockChangeOf(m: { type: string; quantity: number }): number {
  const qn = Number(m.quantity);
  switch (m.type) {
    case "purchase":
    case "return":
      return Math.abs(qn);
    case "sale":
      return -Math.abs(qn);
    case "grni_clear":
    case "write_down":
      return 0;
    default:
      return qn; // adjustment, stocktake, transfer_in/out, reversal, opening: signed
  }
}

/** Move stock between warehouses (value and company total unchanged). */
export async function transferStock(
  tx: LedgerTx,
  args: {
    companyId: string;
    productId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
    date: string;
    actorId: string;
    notes?: string | null;
    lotNumber?: string | null;
  }
): Promise<{ outId: string; inId: string; fromLevel: number; toLevel: number }> {
  assertWholeQty(args.quantity);
  if (args.fromWarehouseId === args.toWarehouseId) {
    throw new DomainError(
      "TRANSFER_SAME_WAREHOUSE",
      422,
      undefined,
      "Choose two different warehouses"
    );
  }
  const p = await lockProduct(tx, args.companyId, args.productId);
  assertStockedProduct(p);
  const policy = await policyFor(tx, args.companyId);
  const level = await levelOf(tx, p.id, args.fromWarehouseId);
  if (level < args.quantity && !policy.allowNegative) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      422,
      { onHand: level, requested: args.quantity, warehouseId: args.fromWarehouseId },
      `Insufficient stock in the source warehouse: ${level} on hand`
    );
  }
  const base = {
    companyId: args.companyId,
    productId: p.id,
    totalCostFils: 0,
    date: args.date,
    sourceType: "transfer",
    notes: args.notes ?? null,
    lotNumber: args.lotNumber ?? null,
    actorId: args.actorId,
  };
  const outId = await insertMovement(tx, {
    ...base,
    type: "transfer_out",
    quantity: -args.quantity,
    warehouseId: args.fromWarehouseId,
    meta: { toWarehouseId: args.toWarehouseId },
  });
  const inId = await insertMovement(tx, {
    ...base,
    type: "transfer_in",
    quantity: args.quantity,
    warehouseId: args.toWarehouseId,
    sourceId: outId,
    meta: { fromWarehouseId: args.fromWarehouseId },
  });
  await tx.execute(sql`UPDATE inventory_movements SET source_id = ${outId} WHERE id = ${outId}`);
  const fromLevel = await bumpLevel(tx, args.companyId, p.id, args.fromWarehouseId, -args.quantity);
  const toLevel = await bumpLevel(tx, args.companyId, p.id, args.toWarehouseId, args.quantity);
  return { outId, inId, fromLevel, toLevel };
}

// ─── Journals ───────────────────────────────────────────────────────────────

export interface DraftLine {
  accountId: string;
  /** Positive = debit, negative = credit (fils). */
  fils: number;
  costCenterId?: string | null;
  description: string;
}

/** Merge per (account, cost centre) and emit kernel lines (one side each, zero lines dropped). */
export function toKernelLines(lines: DraftLine[]): PostJournalLineInput[] {
  const map = new Map<string, DraftLine>();
  for (const l of lines) {
    const key = `${l.accountId}|${l.costCenterId ?? ""}`;
    const cur = map.get(key);
    if (cur) cur.fils += l.fils;
    else map.set(key, { ...l });
  }
  const out: PostJournalLineInput[] = [];
  for (const l of map.values()) {
    if (l.fils === 0) continue;
    out.push({
      accountId: l.accountId,
      ...(l.fils > 0 ? { debitFils: l.fils } : { creditFils: -l.fils }),
      costCenterId: l.costCenterId ?? null,
      description: l.description.slice(0, 255),
    });
  }
  return out;
}

/**
 * Lines that make the journal book exactly `stockDeltaFils` to inventory when the document side
 * booked `bookedFils`: the difference goes to COGS (true-up).
 */
export function trueUpLines(
  r: Pick<MoveResult, "accounts" | "stockDeltaFils" | "product">,
  bookedFils: number,
  costCenterId: string | null | undefined,
  label: string
): DraftLine[] {
  const diff = r.stockDeltaFils - bookedFils;
  if (diff === 0) return [];
  return [
    {
      accountId: r.accounts.inventory,
      fils: diff,
      costCenterId: null,
      description: `${label} - stock true-up`,
    },
    {
      accountId: r.accounts.cogs,
      fils: -diff,
      costCenterId,
      description: `${label} - cost true-up`,
    },
  ];
}

export async function postInventoryJournal(
  tx: LedgerTx,
  args: {
    companyId: string;
    date: string;
    memo: string;
    source: string;
    sourceId: string;
    idempotencyKey: string;
    lines: DraftLine[];
    actorId: string;
  }
): Promise<string | null> {
  const lines = toKernelLines(args.lines);
  if (lines.length === 0) return null;
  const { entry } = await postJournal(
    {
      companyId: args.companyId,
      date: args.date,
      memo: args.memo.slice(0, 500),
      status: "posted",
      source: args.source,
      sourceId: args.sourceId,
      idempotencyKey: args.idempotencyKey,
      allowFutureDate: true,
      lines,
    },
    { actorId: args.actorId, tx }
  );
  return entry.id;
}

export { policyFor as inventoryPolicy };

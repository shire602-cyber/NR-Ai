/**
 * Manual stock operations (W4-B: R10-01, R10-09, R10-15, R10-16): purchases / issues /
 * adjustments / returns recorded on the Inventory page, opening stock, write-downs, transfers and
 * stocktakes. Every one posts through server/ledger in the same transaction as the stock change.
 *
 *   purchase   Dr Inventory          / Cr counter account (default 2015 Goods Received Not Invoiced)
 *   sale       Dr COGS               / Cr Inventory          (stock issued without an invoice)
 *   return     Dr Inventory          / Cr COGS
 *   adjustment +: Dr Inventory / Cr 5007 · −: Dr 5007 / Cr Inventory (negative-stock policy applies)
 *   opening    Dr Inventory          / Cr 3040 Opening Balance Equity
 *   write-down Dr 5007               / Cr Inventory          (value only)
 *   stocktake  variance per product against 5007
 */
import { sql } from "drizzle-orm";
import { DomainError } from "../../errors";
import { fromFils, mulRate } from "../../../shared/money";
import type { LedgerTx } from "../../ledger";
import {
  currentUnitCost,
  postInventoryJournal,
  revalueStock,
  stockIn,
  stockOut,
  trueUpLines,
  type DraftLine,
  type MoveContext,
  type MoveResult,
} from "./engine";
import {
  assertAccount,
  assertWarehouse,
  defaultWarehouse,
  ensureAccountByCode,
  INVENTORY_CODES,
  levelOf,
  linkMovementsToEntry,
  lockProduct,
  q,
} from "./store";

export type ManualMovementType = "purchase" | "sale" | "adjustment" | "return";

export interface ManualMovementInput {
  companyId: string;
  productId: string;
  type: ManualMovementType;
  quantity: number;
  unitCostFils?: number | null;
  date: string;
  counterAccountId?: string | null;
  warehouseId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  reference?: string | null;
  notes?: string | null;
  actorId: string;
  afterCommit?: MoveContext["afterCommit"];
}

export interface ManualMovementResult {
  movementId: string;
  newStock: number;
  journalEntryId: string | null;
  valueFils: number;
  warning?: "NEGATIVE_STOCK";
}

export async function recordManualMovement(
  tx: LedgerTx,
  input: ManualMovementInput
): Promise<ManualMovementResult> {
  if (input.warehouseId) await assertWarehouse(tx, input.companyId, input.warehouseId);
  const ctx: MoveContext = {
    companyId: input.companyId,
    actorId: input.actorId,
    date: input.date,
    sourceType: "manual",
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    warehouseId: input.warehouseId ?? null,
    lotNumber: input.lotNumber ?? null,
    serialNumber: input.serialNumber ?? null,
    afterCommit: input.afterCommit,
  };
  const label = input.reference || `Stock ${input.type}`;
  const inbound =
    input.type === "purchase" ||
    input.type === "return" ||
    (input.type === "adjustment" && input.quantity > 0);
  const qty = Math.abs(input.quantity);
  const lines: DraftLine[] = [];
  let r: MoveResult;
  let valueFils: number;
  if (inbound) {
    const unit =
      input.unitCostFils ?? (await currentUnitCost(tx, input.companyId, input.productId));
    valueFils = mulRate(unit, qty);
    const type = input.type === "adjustment" ? "adjustment" : input.type;
    r = await stockIn(tx, input.productId, qty, valueFils, ctx, type);
    let counter: string;
    if (input.type === "purchase") {
      counter = input.counterAccountId
        ? (
            await assertAccount(tx, input.companyId, input.counterAccountId, [
              "asset",
              "liability",
              "equity",
            ])
          ).id
        : await ensureAccountByCode(tx, input.companyId, INVENTORY_CODES.GRNI);
    } else if (input.type === "return") {
      counter = r.accounts.cogs;
    } else {
      counter = await ensureAccountByCode(tx, input.companyId, INVENTORY_CODES.ADJUSTMENTS);
    }
    lines.push({
      accountId: r.accounts.inventory,
      fils: valueFils,
      description: `${label} - stock in`,
    });
    lines.push({ accountId: counter, fils: -valueFils, description: label });
    lines.push(...trueUpLines(r, valueFils, null, label));
  } else {
    const type = input.type === "adjustment" ? "adjustment" : "sale";
    r = await stockOut(tx, input.productId, qty, ctx, type);
    valueFils = r.costFils;
    const expense =
      input.type === "adjustment"
        ? await ensureAccountByCode(tx, input.companyId, INVENTORY_CODES.ADJUSTMENTS)
        : r.accounts.cogs;
    lines.push({ accountId: expense, fils: r.costFils, description: label });
    lines.push({
      accountId: r.accounts.inventory,
      fils: -r.costFils,
      description: `${label} - stock out`,
    });
  }
  if (input.type === "adjustment" && input.quantity < 0) {
    await tx.execute(
      sql`UPDATE inventory_movements SET quantity = ${-qty} WHERE id = ${r.movementId}`
    );
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    memo: `Inventory ${input.type} - ${r.product.sku ?? r.product.name}`,
    source: "inventory",
    sourceId: r.movementId,
    idempotencyKey: `inventory:movement:${r.movementId}`,
    lines,
    actorId: input.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
  return {
    movementId: r.movementId,
    newStock: r.newQty,
    journalEntryId: entryId,
    valueFils,
    warning: r.warning,
  };
}

/** Opening stock on product creation: valued at cost price, offset to Opening Balance Equity. */
export async function recordOpeningStock(
  tx: LedgerTx,
  args: {
    companyId: string;
    productId: string;
    quantity: number;
    unitCostFils: number;
    date: string;
    actorId: string;
  }
): Promise<ManualMovementResult> {
  const valueFils = mulRate(args.unitCostFils, args.quantity);
  const r = await stockIn(
    tx,
    args.productId,
    args.quantity,
    valueFils,
    {
      companyId: args.companyId,
      actorId: args.actorId,
      date: args.date,
      sourceType: "opening",
      reference: "Opening stock",
    },
    "opening"
  );
  const equity = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.OPENING_EQUITY);
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date: args.date,
    memo: `Opening stock - ${r.product.sku ?? r.product.name}`,
    source: "inventory",
    sourceId: r.movementId,
    idempotencyKey: `inventory:opening:${args.productId}`,
    lines: [
      { accountId: r.accounts.inventory, fils: valueFils, description: "Opening stock" },
      { accountId: equity, fils: -valueFils, description: "Opening stock" },
    ],
    actorId: args.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
  return { movementId: r.movementId, newStock: r.newQty, journalEntryId: entryId, valueFils };
}

/** Write a product's stock value down (inventory obsolescence / NRV). */
export async function writeDownStock(
  tx: LedgerTx,
  args: {
    companyId: string;
    productId: string;
    amountFils: number;
    date: string;
    reason: string;
    actorId: string;
  }
): Promise<ManualMovementResult> {
  if (!Number.isSafeInteger(args.amountFils) || args.amountFils <= 0) {
    throw new DomainError("INVALID_AMOUNT", 422, { amount: args.amountFils });
  }
  const r = await revalueStock(tx, args.productId, -args.amountFils, {
    companyId: args.companyId,
    actorId: args.actorId,
    date: args.date,
    sourceType: "write_down",
    reference: "Inventory write-down",
    notes: args.reason,
  });
  const expense = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.ADJUSTMENTS);
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date: args.date,
    memo: `Inventory write-down - ${r.product.sku ?? r.product.name}: ${args.reason}`,
    source: "inventory",
    sourceId: r.movementId,
    idempotencyKey: `inventory:movement:${r.movementId}`,
    lines: [
      { accountId: expense, fils: args.amountFils, description: `Write-down - ${args.reason}` },
      { accountId: r.accounts.inventory, fils: -args.amountFils, description: "Write-down" },
    ],
    actorId: args.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
  return {
    movementId: r.movementId,
    newStock: r.newQty,
    journalEntryId: entryId,
    valueFils: args.amountFils,
  };
}

// ─── Stocktakes ─────────────────────────────────────────────────────────────

export async function createStocktake(
  tx: LedgerTx,
  args: {
    companyId: string;
    warehouseId?: string | null;
    countDate: string;
    notes?: string | null;
    lines: Array<{ productId: string; countedQty: number }>;
    actorId: string;
  }
): Promise<{ id: string }> {
  const warehouseId = args.warehouseId ?? (await defaultWarehouse(tx, args.companyId));
  await assertWarehouse(tx, args.companyId, warehouseId);
  const [st] = await q<{ id: string }>(
    tx,
    sql`INSERT INTO stocktakes (company_id, warehouse_id, count_date, notes, created_by)
        VALUES (${args.companyId}, ${warehouseId}, ${args.countDate}, ${args.notes ?? null}, ${args.actorId})
        RETURNING id`
  );
  const seen = new Set<string>();
  for (const l of args.lines) {
    if (seen.has(l.productId)) {
      throw new DomainError("DUPLICATE_STOCKTAKE_LINE", 422, { productId: l.productId });
    }
    seen.add(l.productId);
    const p = await lockProduct(tx, args.companyId, l.productId);
    const systemQty = await levelOf(tx, p.id, warehouseId);
    await tx.execute(
      sql`INSERT INTO stocktake_lines (stocktake_id, product_id, system_qty, counted_qty, variance_qty)
          VALUES (${st.id}, ${p.id}, ${systemQty}, ${l.countedQty}, ${l.countedQty - systemQty})`
    );
  }
  return st;
}

/** Post a draft stocktake: variance (counted − current level) per product against 5007. */
export async function postStocktake(
  tx: LedgerTx,
  args: { companyId: string; stocktakeId: string; actorId: string }
): Promise<{ journalEntryId: string | null; lines: number }> {
  const [st] = await q<{ id: string; status: string; warehouse_id: string; count_date: string }>(
    tx,
    sql`SELECT id, status, warehouse_id, to_char(count_date, 'YYYY-MM-DD') AS count_date
          FROM stocktakes WHERE id = ${args.stocktakeId} AND company_id = ${args.companyId} FOR UPDATE`
  );
  if (!st) throw new DomainError("STOCKTAKE_NOT_FOUND", 404);
  if (st.status !== "draft")
    throw new DomainError("STOCKTAKE_NOT_DRAFT", 409, { status: st.status });
  const stLines = await q<{ id: string; product_id: string; counted_qty: number }>(
    tx,
    sql`SELECT id, product_id, counted_qty FROM stocktake_lines WHERE stocktake_id = ${st.id} ORDER BY id`
  );
  const adj = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.ADJUSTMENTS);
  const draft: DraftLine[] = [];
  const movementIds: string[] = [];
  for (const l of stLines) {
    const level = await levelOf(tx, l.product_id, st.warehouse_id);
    const variance = Number(l.counted_qty) - level;
    let valueFils = 0;
    if (variance !== 0) {
      const ctx: MoveContext = {
        companyId: args.companyId,
        actorId: args.actorId,
        date: st.count_date,
        sourceType: "stocktake",
        sourceId: st.id,
        sourceLineId: l.id,
        warehouseId: st.warehouse_id,
        reference: "Stocktake variance",
        idempotencyKey: `stocktake:${st.id}:${l.id}`,
      };
      if (variance > 0) {
        const unit = await currentUnitCost(tx, args.companyId, l.product_id);
        valueFils = mulRate(unit, variance);
        const r = await stockIn(tx, l.product_id, variance, valueFils, ctx, "stocktake");
        movementIds.push(r.movementId);
        draft.push({
          accountId: r.accounts.inventory,
          fils: valueFils,
          description: "Stocktake surplus",
        });
        draft.push({ accountId: adj, fils: -valueFils, description: "Stocktake surplus" });
        draft.push(...trueUpLines(r, valueFils, null, "Stocktake"));
      } else {
        const r = await stockOut(tx, l.product_id, -variance, { ...ctx }, "stocktake");
        await tx.execute(
          sql`UPDATE inventory_movements SET quantity = ${variance} WHERE id = ${r.movementId}`
        );
        movementIds.push(r.movementId);
        valueFils = -r.costFils;
        draft.push({ accountId: adj, fils: r.costFils, description: "Stocktake shortage" });
        draft.push({
          accountId: r.accounts.inventory,
          fils: -r.costFils,
          description: "Stocktake shortage",
        });
      }
    }
    await tx.execute(
      sql`UPDATE stocktake_lines SET variance_qty = ${variance}, variance_value = ${fromFils(valueFils)}
           WHERE id = ${l.id}`
    );
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date: st.count_date,
    memo: "Stocktake variance",
    source: "stocktake",
    sourceId: st.id,
    idempotencyKey: `stocktake:${st.id}:post`,
    lines: draft,
    actorId: args.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, movementIds, entryId);
  await tx.execute(
    sql`UPDATE stocktakes SET status = 'posted', journal_entry_id = ${entryId}, posted_by = ${args.actorId},
               posted_at = now() WHERE id = ${st.id}`
  );
  return { journalEntryId: entryId, lines: stLines.length };
}

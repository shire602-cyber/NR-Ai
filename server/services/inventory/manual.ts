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
import { fromFils, mulRate, toFils } from "../../../shared/money";
import type { LedgerTx } from "../../ledger";
import { assertChosenAccountsNotControl } from "../../ledger/control-accounts";
import {
  currentUnitCost,
  postInventoryJournal,
  revalueStock,
  seedStockValue,
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
  // C1 (RH2): a purchase's counter account is the user's choice. It may clear goods received not
  // invoiced (the default) or be a bank, equity or other account, never another control account
  // (Cr 2020 would land in VAT 201 Box 1, Cr 1040 / 2010 would break the aging). Checked before
  // any stock moves.
  let purchaseCounter: { id: string; grni: boolean } | null = null;
  if (input.type === "purchase") {
    if (input.counterAccountId) {
      const chosen = await assertAccount(tx, input.companyId, input.counterAccountId, [
        "asset",
        "liability",
        "equity",
      ]);
      await assertChosenAccountsNotControl(
        input.companyId,
        [{ field: "counterAccountId", accountId: chosen.id }],
        { tx, allow: ["grni"] }
      );
      purchaseCounter = { id: chosen.id, grni: chosen.code === INVENTORY_CODES.GRNI };
    } else {
      purchaseCounter = {
        id: await ensureAccountByCode(tx, input.companyId, INVENTORY_CODES.GRNI),
        grni: true,
      };
    }
  }
  if (inbound) {
    const unit =
      input.unitCostFils ?? (await currentUnitCost(tx, input.companyId, input.productId));
    valueFils = mulRate(unit, qty);
    const type = input.type === "adjustment" ? "adjustment" : input.type;
    r = await stockIn(tx, input.productId, qty, valueFils, ctx, type);
    let counter: string;
    if (purchaseCounter) {
      counter = purchaseCounter.id;
    } else if (input.type === "return") {
      counter = r.accounts.cogs;
    } else {
      counter = await ensureAccountByCode(tx, input.companyId, INVENTORY_CODES.ADJUSTMENTS);
    }
    lines.push({
      accountId: r.accounts.inventory,
      controlLeg: "inventory",
      fils: valueFils,
      description: `${label} - stock in`,
    });
    lines.push({
      accountId: counter,
      fils: -valueFils,
      description: label,
      ...(purchaseCounter?.grni ? { controlLeg: "grni" as const } : {}),
    });
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
      controlLeg: "inventory",
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
      {
        accountId: r.accounts.inventory,
        controlLeg: "inventory",
        fils: valueFils,
        description: "Opening stock",
      },
      { accountId: equity, fils: -valueFils, description: "Opening stock" },
    ],
    actorId: args.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
  return { movementId: r.movementId, newStock: r.newQty, journalEntryId: entryId, valueFils };
}

// ─── Opening-stock valuation backfill (S2, W4-B residual) ───────────────────

export interface OpeningBackfillRow {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  /** Proposed unit cost (fils): the product cost price; null when missing. */
  unitCostFils: number | null;
  proposedValueFils: number;
  needsCost: boolean;
}

/**
 * Products that already hold stock but no value (created before W4-B, or imported with a
 * quantity only): a reviewable proposal valued at each product's cost price. Nothing is posted.
 */
export async function openingBackfillProposal(
  tx: LedgerTx,
  companyId: string
): Promise<OpeningBackfillRow[]> {
  const rows = await q<{
    id: string;
    name: string;
    sku: string | null;
    current_stock: number;
    cost_price: string | null;
  }>(
    tx,
    sql`SELECT id, name, sku, current_stock, cost_price::text AS cost_price
          FROM products
         WHERE company_id = ${companyId} AND product_type = 'inventory'
           AND track_inventory IS NOT FALSE AND is_active IS NOT FALSE
           AND current_stock > 0 AND COALESCE(stock_value, 0) = 0
         ORDER BY name, id`
  );
  return rows.map((r) => {
    const unit =
      r.cost_price === null ? 0 : Math.max(0, toFils(r.cost_price, { rounding: "halfUp" }));
    const qty = Number(r.current_stock);
    return {
      productId: r.id,
      name: r.name,
      sku: r.sku,
      quantity: qty,
      unitCostFils: unit > 0 ? unit : null,
      proposedValueFils: unit > 0 ? mulRate(unit, qty) : 0,
      needsCost: !(unit > 0),
    };
  });
}

/**
 * Post the reviewed backfill: per product Dr Inventory / Cr 3040 Opening Balance Equity at the
 * approved unit cost (the reviewer may override the proposal). Idempotent per product: a product
 * that already has value is refused with 409.
 */
export async function applyOpeningBackfill(
  tx: LedgerTx,
  args: {
    companyId: string;
    date: string;
    actorId: string;
    items: Array<{ productId: string; unitCostFils?: number | null }>;
  }
): Promise<Array<{ productId: string; valueFils: number; journalEntryId: string | null }>> {
  const proposal = new Map(
    (await openingBackfillProposal(tx, args.companyId)).map((r) => [r.productId, r])
  );
  const equity = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.OPENING_EQUITY);
  const out: Array<{ productId: string; valueFils: number; journalEntryId: string | null }> = [];
  for (const item of args.items) {
    const row = proposal.get(item.productId);
    if (!row) {
      throw new DomainError(
        "OPENING_VALUE_NOT_APPLICABLE",
        409,
        { productId: item.productId },
        "The product has no unvalued stock (already valued, no stock, or not a stock item)"
      );
    }
    const unit = item.unitCostFils ?? row.unitCostFils;
    if (!unit || unit <= 0) {
      throw new DomainError(
        "OPENING_COST_REQUIRED",
        422,
        { productId: item.productId },
        "Enter a unit cost for this product (it has no cost price)"
      );
    }
    const valueFils = mulRate(unit, row.quantity);
    const r = await seedStockValue(tx, item.productId, valueFils, {
      companyId: args.companyId,
      actorId: args.actorId,
      date: args.date,
      sourceType: "opening",
      reference: "Opening stock valuation backfill",
      idempotencyKey: `opening_backfill:${item.productId}`,
    });
    const entryId = await postInventoryJournal(tx, {
      companyId: args.companyId,
      date: args.date,
      memo: `Opening stock valuation - ${r.product.sku ?? r.product.name}`,
      source: "inventory",
      sourceId: r.movementId,
      idempotencyKey: `inventory:opening_backfill:${item.productId}`,
      lines: [
        {
          accountId: r.accounts.inventory,
          controlLeg: "inventory",
          fils: r.stockDeltaFils,
          description: "Opening stock valuation backfill",
        },
        { accountId: equity, fils: -r.stockDeltaFils, description: "Opening stock valuation" },
      ],
      actorId: args.actorId,
    });
    if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
    out.push({ productId: item.productId, valueFils: r.stockDeltaFils, journalEntryId: entryId });
  }
  return out;
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
      {
        accountId: r.accounts.inventory,
        controlLeg: "inventory",
        fils: -args.amountFils,
        description: "Write-down",
      },
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

/**
 * L8 (A4, IAS 2.33-34): reverse an earlier NRV write-down when net realisable value recovers.
 * Limited to the write-downs of this product not yet reversed (never above original cost) and
 * to stock still on hand. Dr 1070 Inventory / Cr 5007 (reduces the inventory expense).
 */
export async function reverseWriteDown(
  tx: LedgerTx,
  args: {
    companyId: string;
    productId: string;
    amountFils: number;
    date: string;
    reason: string;
    actorId: string;
  }
): Promise<ManualMovementResult & { reversibleFils: number }> {
  if (!Number.isSafeInteger(args.amountFils) || args.amountFils <= 0) {
    throw new DomainError("INVALID_AMOUNT", 422, { amount: args.amountFils });
  }
  await lockProduct(tx, args.companyId, args.productId);
  const [sums] = await q<{ down: string; up: string; qty: string }>(
    tx,
    sql`SELECT
          COALESCE(-SUM(total_cost) FILTER (WHERE source_type = 'write_down'
                     AND reversed_by_movement_id IS NULL), 0)::text AS down,
          COALESCE(SUM(total_cost) FILTER (WHERE source_type = 'write_down_reversal'
                     AND reversed_by_movement_id IS NULL), 0)::text AS up,
          (SELECT COALESCE(current_stock, 0) FROM products WHERE id = ${args.productId})::text AS qty
        FROM inventory_movements
       WHERE company_id = ${args.companyId} AND product_id = ${args.productId}`
  );
  const reversibleFils =
    Math.round(Number(sums?.down ?? 0) * 100) - Math.round(Number(sums?.up ?? 0) * 100);
  if (!(Number(sums?.qty ?? 0) > 0)) {
    throw new DomainError(
      "NO_STOCK_ON_HAND",
      422,
      undefined,
      "There is no stock on hand to reverse a write-down against"
    );
  }
  if (args.amountFils > reversibleFils) {
    throw new DomainError(
      "WRITE_DOWN_REVERSAL_EXCEEDS",
      422,
      { reversible: reversibleFils / 100 },
      `Only AED ${(reversibleFils / 100).toFixed(2)} of earlier write-downs can be reversed`
    );
  }
  const r = await revalueStock(tx, args.productId, args.amountFils, {
    companyId: args.companyId,
    actorId: args.actorId,
    date: args.date,
    sourceType: "write_down_reversal",
    reference: "Inventory write-down reversal",
    notes: args.reason,
  });
  const expense = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.ADJUSTMENTS);
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date: args.date,
    memo: `Inventory write-down reversal - ${r.product.sku ?? r.product.name}: ${args.reason}`,
    source: "inventory",
    sourceId: r.movementId,
    idempotencyKey: `inventory:movement:${r.movementId}`,
    lines: [
      {
        accountId: r.accounts.inventory,
        controlLeg: "inventory",
        fils: args.amountFils,
        description: "Write-down reversal",
      },
      {
        accountId: expense,
        fils: -args.amountFils,
        description: `Write-down reversal - ${args.reason}`,
      },
    ],
    actorId: args.actorId,
  });
  if (entryId) await linkMovementsToEntry(tx, [r.movementId], entryId);
  return {
    movementId: r.movementId,
    newStock: r.newQty,
    journalEntryId: entryId,
    valueFils: args.amountFils,
    reversibleFils: reversibleFils - args.amountFils,
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
          controlLeg: "inventory",
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
          controlLeg: "inventory",
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

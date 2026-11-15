/**
 * Inventory persistence inside a ledger transaction (W4-B). Raw SQL on the caller's `tx` so stock,
 * cost layers, movements and the journal commit (or roll back) together.
 */
import { sql, type SQL } from "drizzle-orm";
import { DomainError } from "../../errors";
import { fromFils, toFils } from "../../../shared/money";
import { supplementaryAccounts, defaultChartOfAccounts } from "../../defaultChartOfAccounts";
import type { LedgerTx } from "../../ledger";
import type { CostingMethod, CostLayer, StockState } from "./costing";

export async function q<T = Record<string, unknown>>(tx: LedgerTx, query: SQL): Promise<T[]> {
  const res = (await tx.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export const filsOfNumeric = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

// ─── Accounts ───────────────────────────────────────────────────────────────

export const INVENTORY_CODES = {
  INVENTORY: "1070",
  COGS: "5005",
  GRNI: "2015",
  ADJUSTMENTS: "5007",
  OPENING_EQUITY: "3040",
} as const;

/** Active account id for `code`, created from the default/supplementary chart when missing. */
export async function ensureAccountByCode(
  tx: LedgerTx,
  companyId: string,
  code: string
): Promise<string> {
  const found = await q<{ id: string; is_active: boolean; is_archived: boolean }>(
    tx,
    sql`SELECT id, is_active, is_archived FROM accounts WHERE company_id = ${companyId} AND code = ${code} LIMIT 1`
  );
  if (found[0]) {
    if (found[0].is_active === false || found[0].is_archived === true) {
      throw new DomainError("ACCOUNT_INACTIVE", 422, { code }, `Account ${code} is inactive`);
    }
    return found[0].id;
  }
  const tpl =
    defaultChartOfAccounts.find((a) => a.code === code) ??
    supplementaryAccounts.find((a) => a.code === code);
  if (!tpl) throw new DomainError("ACCOUNT_NOT_FOUND", 422, { code }, `Account ${code} is missing`);
  const created = await q<{ id: string }>(
    tx,
    sql`INSERT INTO accounts (company_id, code, name_en, name_ar, description, type, sub_type,
                              is_vat_account, vat_type, is_system_account, is_active, is_archived)
        VALUES (${companyId}, ${tpl.code}, ${tpl.nameEn}, ${tpl.nameAr}, ${tpl.description},
                ${tpl.type}, ${tpl.subType}, ${tpl.isVatAccount}, ${tpl.vatType},
                ${tpl.isSystemAccount}, true, false)
        ON CONFLICT DO NOTHING RETURNING id`
  );
  if (created[0]) return created[0].id;
  const again = await q<{ id: string }>(
    tx,
    sql`SELECT id FROM accounts WHERE company_id = ${companyId} AND code = ${code} LIMIT 1`
  );
  return again[0].id;
}

/** Validate that an account id belongs to the company and is usable. */
export async function assertAccount(
  tx: LedgerTx,
  companyId: string,
  accountId: string,
  types?: readonly string[]
): Promise<{ id: string; code: string; type: string; sub_type: string | null }> {
  const rows = await q<{
    id: string;
    code: string;
    type: string;
    sub_type: string | null;
    is_active: boolean;
    is_archived: boolean;
  }>(
    tx,
    sql`SELECT id, code, type, sub_type, is_active, is_archived FROM accounts
         WHERE id = ${accountId} AND company_id = ${companyId}`
  );
  const a = rows[0];
  if (!a) throw new DomainError("ACCOUNT_NOT_FOUND", 422, { accountId });
  if (a.is_active === false || a.is_archived === true) {
    throw new DomainError("ACCOUNT_INACTIVE", 422, { accountId });
  }
  if (types && !types.includes(a.type)) {
    throw new DomainError("ACCOUNT_TYPE_MISMATCH", 422, {
      accountId,
      expected: types,
      actual: a.type,
    });
  }
  return a;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface InventoryPolicy {
  method: CostingMethod;
  allowNegative: boolean;
}

export async function loadPolicy(tx: LedgerTx, companyId: string): Promise<InventoryPolicy> {
  const rows = await q<{ costing_method: string; allow_negative_stock: boolean }>(
    tx,
    sql`SELECT costing_method, allow_negative_stock FROM inventory_settings WHERE company_id = ${companyId}`
  );
  return {
    method: rows[0]?.costing_method === "fifo" ? "fifo" : "weighted_average",
    allowNegative: rows[0]?.allow_negative_stock === true,
  };
}

// ─── Products ───────────────────────────────────────────────────────────────

export interface ProductRow {
  id: string;
  company_id: string;
  name: string;
  sku: string | null;
  product_type: string;
  track_inventory: boolean;
  inventory_account_id: string | null;
  cogs_account_id: string | null;
  cost_price: string | null;
  current_stock: number;
  stock_value: string;
  reorder_point: number | null;
  is_active: boolean;
}

/** Lock a product row (FOR UPDATE). 404 when it is not the company's. */
export async function lockProduct(
  tx: LedgerTx,
  companyId: string,
  productId: string
): Promise<ProductRow> {
  const rows = await q<ProductRow>(
    tx,
    sql`SELECT id, company_id, name, sku, product_type, track_inventory, inventory_account_id,
               cogs_account_id, cost_price, current_stock, stock_value, reorder_point, is_active
          FROM products WHERE id = ${productId} AND company_id = ${companyId} FOR UPDATE`
  );
  if (!rows[0]) throw new DomainError("PRODUCT_NOT_FOUND", 404, { productId });
  return rows[0];
}

export const isStocked = (p: Pick<ProductRow, "product_type" | "track_inventory">): boolean =>
  p.product_type === "inventory" && p.track_inventory !== false;

export async function productAccounts(
  tx: LedgerTx,
  p: ProductRow
): Promise<{ inventory: string; cogs: string }> {
  return {
    inventory:
      p.inventory_account_id ??
      (await ensureAccountByCode(tx, p.company_id, INVENTORY_CODES.INVENTORY)),
    cogs: p.cogs_account_id ?? (await ensureAccountByCode(tx, p.company_id, INVENTORY_CODES.COGS)),
  };
}

export async function loadState(tx: LedgerTx, p: ProductRow): Promise<StockState> {
  const layers = await q<{
    id: string;
    layer_date: string;
    remaining_qty: number;
    remaining_value: string;
    lot_number: string | null;
  }>(
    tx,
    sql`SELECT id, to_char(layer_date, 'YYYY-MM-DD') AS layer_date, remaining_qty, remaining_value, lot_number
          FROM inventory_cost_layers
         WHERE product_id = ${p.id} AND remaining_qty > 0
         ORDER BY layer_date, created_at, id`
  );
  return {
    qty: Number(p.current_stock),
    valueFils: filsOfNumeric(p.stock_value),
    layers: layers.map((l) => ({
      id: l.id,
      date: l.layer_date,
      qty: Number(l.remaining_qty),
      valueFils: filsOfNumeric(l.remaining_value),
      lot: l.lot_number,
    })),
  };
}

/** Persist the new state: product totals, existing layers, new layers (linked to `movementId`). */
export async function saveState(
  tx: LedgerTx,
  p: ProductRow,
  before: StockState,
  after: StockState,
  movementId: string | null
): Promise<void> {
  await tx.execute(
    sql`UPDATE products SET current_stock = ${after.qty}, stock_value = ${fromFils(after.valueFils)}
         WHERE id = ${p.id} AND company_id = ${p.company_id}`
  );
  p.current_stock = after.qty;
  p.stock_value = fromFils(after.valueFils);
  const kept = new Set<string>();
  for (const l of after.layers) {
    if (l.id) {
      kept.add(l.id);
      await tx.execute(
        sql`UPDATE inventory_cost_layers SET remaining_qty = ${l.qty}, remaining_value = ${fromFils(l.valueFils)}
             WHERE id = ${l.id}`
      );
    } else if (l.qty > 0) {
      const ins = await q<{ id: string }>(
        tx,
        sql`INSERT INTO inventory_cost_layers
              (company_id, product_id, movement_id, layer_date, original_qty, remaining_qty, remaining_value, lot_number)
            VALUES (${p.company_id}, ${p.id}, ${movementId}, ${l.date}, ${l.qty}, ${l.qty},
                    ${fromFils(l.valueFils)}, ${l.lot ?? null})
            RETURNING id`
      );
      l.id = ins[0].id;
    }
  }
  for (const l of before.layers) {
    if (l.id && !kept.has(l.id)) {
      await tx.execute(
        sql`UPDATE inventory_cost_layers SET remaining_qty = 0, remaining_value = 0 WHERE id = ${l.id}`
      );
    }
  }
}

export function layerOf(state: StockState): CostLayer | undefined {
  return state.layers.find((l) => l.isNew);
}

// ─── Warehouses ─────────────────────────────────────────────────────────────

/** The company's default warehouse (created as MAIN on first use). */
export async function defaultWarehouse(tx: LedgerTx, companyId: string): Promise<string> {
  const rows = await q<{ id: string }>(
    tx,
    sql`SELECT id FROM warehouses WHERE company_id = ${companyId} AND is_default LIMIT 1`
  );
  if (rows[0]) return rows[0].id;
  const created = await q<{ id: string }>(
    tx,
    sql`INSERT INTO warehouses (company_id, code, name, name_ar, is_default)
        VALUES (${companyId}, 'MAIN', 'Main warehouse', 'المستودع الرئيسي', true)
        ON CONFLICT DO NOTHING RETURNING id`
  );
  if (created[0]) return created[0].id;
  const again = await q<{ id: string }>(
    tx,
    sql`SELECT id FROM warehouses WHERE company_id = ${companyId} AND (is_default OR code = 'MAIN')
         ORDER BY is_default DESC LIMIT 1`
  );
  return again[0].id;
}

export async function assertWarehouse(
  tx: LedgerTx,
  companyId: string,
  warehouseId: string
): Promise<void> {
  const rows = await q(
    tx,
    sql`SELECT 1 FROM warehouses WHERE id = ${warehouseId} AND company_id = ${companyId} AND is_active`
  );
  if (!rows[0]) throw new DomainError("WAREHOUSE_NOT_FOUND", 404, { warehouseId });
}

/** Change the stock level of one product in one warehouse; returns the new level. */
export async function bumpLevel(
  tx: LedgerTx,
  companyId: string,
  productId: string,
  warehouseId: string,
  delta: number
): Promise<number> {
  const rows = await q<{ quantity: number }>(
    tx,
    sql`INSERT INTO inventory_stock_levels (company_id, product_id, warehouse_id, quantity)
        VALUES (${companyId}, ${productId}, ${warehouseId}, ${delta})
        ON CONFLICT (product_id, warehouse_id)
        DO UPDATE SET quantity = inventory_stock_levels.quantity + ${delta}
        RETURNING quantity`
  );
  return Number(rows[0].quantity);
}

export async function levelOf(
  tx: LedgerTx,
  productId: string,
  warehouseId: string
): Promise<number> {
  const rows = await q<{ quantity: number }>(
    tx,
    sql`SELECT quantity FROM inventory_stock_levels WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`
  );
  return Number(rows[0]?.quantity ?? 0);
}

// ─── Movements ──────────────────────────────────────────────────────────────

export interface MovementInsert {
  companyId: string;
  productId: string;
  type: string;
  quantity: number;
  unitCostFils?: number | null;
  totalCostFils: number;
  date: string;
  sourceType: string;
  sourceId?: string | null;
  sourceLineId?: string | null;
  warehouseId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  reference?: string | null;
  notes?: string | null;
  reversesMovementId?: string | null;
  idempotencyKey?: string | null;
  meta?: Record<string, unknown> | null;
  actorId?: string | null;
}

export async function insertMovement(tx: LedgerTx, m: MovementInsert): Promise<string> {
  const rows = await q<{ id: string }>(
    tx,
    sql`INSERT INTO inventory_movements
          (product_id, company_id, type, quantity, unit_cost, total_cost, movement_date, source_type,
           source_id, source_line_id, warehouse_id, lot_number, serial_number, reference, notes,
           reverses_movement_id, idempotency_key, meta, created_by, created_at)
        VALUES (${m.productId}, ${m.companyId}, ${m.type}, ${m.quantity},
                ${m.unitCostFils === null || m.unitCostFils === undefined ? null : fromFils(m.unitCostFils)},
                ${fromFils(m.totalCostFils)}, ${m.date}, ${m.sourceType}, ${m.sourceId ?? null},
                ${m.sourceLineId ?? null}, ${m.warehouseId ?? null}, ${m.lotNumber ?? null},
                ${m.serialNumber ?? null}, ${m.reference ?? null}, ${m.notes ?? null},
                ${m.reversesMovementId ?? null}, ${m.idempotencyKey ?? null},
                ${m.meta ? JSON.stringify(m.meta) : null}::jsonb, ${m.actorId ?? null}, clock_timestamp())
        RETURNING id`
  );
  if (m.reversesMovementId) {
    await tx.execute(
      sql`UPDATE inventory_movements SET reversed_by_movement_id = ${rows[0].id} WHERE id = ${m.reversesMovementId}`
    );
  }
  return rows[0].id;
}

export async function movementExists(
  tx: LedgerTx,
  companyId: string,
  idempotencyKey: string
): Promise<boolean> {
  const rows = await q(
    tx,
    sql`SELECT 1 FROM inventory_movements WHERE company_id = ${companyId} AND idempotency_key = ${idempotencyKey} LIMIT 1`
  );
  return rows.length > 0;
}

export async function linkMovementsToEntry(
  tx: LedgerTx,
  movementIds: string[],
  entryId: string
): Promise<void> {
  for (const id of movementIds) {
    await tx.execute(
      sql`UPDATE inventory_movements SET journal_entry_id = ${entryId} WHERE id = ${id}`
    );
  }
}

export interface MovementRow {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  total_cost: string | null;
  warehouse_id: string | null;
  source_line_id: string | null;
  meta: Record<string, unknown> | null;
  layer_id: string | null;
}

/** Live (unreversed, non-reversal) movements of one document. */
export async function documentMovements(
  tx: LedgerTx,
  companyId: string,
  sourceType: string,
  sourceId: string
): Promise<MovementRow[]> {
  return q<MovementRow>(
    tx,
    sql`SELECT m.id, m.product_id, m.type, m.quantity, m.total_cost, m.warehouse_id, m.source_line_id, m.meta,
               (SELECT l.id FROM inventory_cost_layers l WHERE l.movement_id = m.id LIMIT 1) AS layer_id
          FROM inventory_movements m
         WHERE m.company_id = ${companyId} AND m.source_type = ${sourceType} AND m.source_id = ${sourceId}
           AND m.reversed_by_movement_id IS NULL AND m.reverses_movement_id IS NULL
         ORDER BY m.created_at, m.id`
  );
}

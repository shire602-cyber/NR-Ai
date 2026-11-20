/**
 * Inventory reports (W4-B: R10-15): valuation reconciled to the GL, stock ageing from cost layers,
 * movement summary and reorder list. Ledger figures come from server/reporting.
 */
import { pool } from "../../db";
import { accountTotals, naturalBalance, loadAccounts } from "../../reporting";
import { fromFils, toFils } from "../../../shared/money";
import { ageLayers, prorate } from "./costing";

async function rowsOf<T>(text: string, params: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

const f = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

export interface ValuationRow {
  productId: string;
  name: string;
  nameAr: string | null;
  sku: string | null;
  quantity: number;
  unitCost: string;
  value: string;
  layerValue: string;
  inventoryAccountId: string | null;
}

export async function inventoryValuation(companyId: string) {
  const rows = await rowsOf<{
    id: string;
    name: string;
    name_ar: string | null;
    sku: string | null;
    current_stock: number;
    stock_value: string;
    inventory_account_id: string | null;
    layer_value: string;
  }>(
    `SELECT p.id, p.name, p.name_ar, p.sku, p.current_stock, p.stock_value, p.inventory_account_id,
            COALESCE((SELECT SUM(l.remaining_value) FROM inventory_cost_layers l
                       WHERE l.product_id = p.id AND l.remaining_qty > 0), 0)::text AS layer_value
       FROM products p
      WHERE p.company_id = $1 AND p.product_type = 'inventory' AND p.track_inventory
      ORDER BY p.name`,
    [companyId]
  );
  let totalFils = 0;
  const out: ValuationRow[] = rows.map((r) => {
    const value = f(r.stock_value);
    const qty = Number(r.current_stock);
    totalFils += value;
    return {
      productId: r.id,
      name: r.name,
      nameAr: r.name_ar ?? null,
      sku: r.sku ?? null,
      quantity: qty,
      unitCost: fromFils(qty > 0 ? prorate(value, 1, qty) : 0),
      value: fromFils(value),
      layerValue: fromFils(f(r.layer_value)),
      inventoryAccountId: r.inventory_account_id ?? null,
    };
  });
  // GL: every account a stocked product posts to (plus the default 1070).
  const accounts = await loadAccounts(companyId);
  const invIds = new Set<string>(
    out.map((r) => r.inventoryAccountId).filter((x): x is string => !!x)
  );
  for (const a of accounts) if (a.code === "1070") invIds.add(a.id);
  const totals = await accountTotals(companyId, {});
  let glFils = 0;
  const glAccounts: Array<{ accountId: string; code: string; name: string; balance: string }> = [];
  for (const a of accounts) {
    if (!invIds.has(a.id)) continue;
    const bal = naturalBalance(a.type, totals.get(a.id));
    glFils += bal;
    glAccounts.push({ accountId: a.id, code: a.code, name: a.nameEn, balance: fromFils(bal) });
  }
  return {
    asOf: new Date().toISOString().slice(0, 10),
    rows: out,
    totalValue: fromFils(totalFils),
    glBalance: fromFils(glFils),
    glAccounts,
    difference: fromFils(glFils - totalFils),
    reconciled: glFils === totalFils,
  };
}

export async function inventoryAgeing(companyId: string, asOf?: string) {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await rowsOf<{
    id: string;
    name: string;
    sku: string | null;
    d: string;
    remaining_qty: number;
    remaining_value: string;
  }>(
    `SELECT p.id, p.name, p.sku, to_char(l.layer_date, 'YYYY-MM-DD') AS d, l.remaining_qty, l.remaining_value
       FROM inventory_cost_layers l JOIN products p ON p.id = l.product_id
      WHERE l.company_id = $1 AND l.remaining_qty > 0
      ORDER BY p.name, l.layer_date`,
    [companyId]
  );
  const byProduct = new Map<
    string,
    {
      productId: string;
      name: string;
      sku: string | null;
      layers: Array<{ date: string; qty: number; valueFils: number }>;
    }
  >();
  for (const r of rows) {
    const e = byProduct.get(r.id) ?? {
      productId: r.id,
      name: r.name,
      sku: r.sku ?? null,
      layers: [] as Array<{ date: string; qty: number; valueFils: number }>,
    };
    e.layers.push({ date: r.d, qty: Number(r.remaining_qty), valueFils: f(r.remaining_value) });
    byProduct.set(r.id, e);
  }
  const products = [...byProduct.values()].map((p) => ({
    productId: p.productId,
    name: p.name,
    sku: p.sku,
    buckets: ageLayers(p.layers, date).map((b) => ({ ...b, value: fromFils(b.valueFils) })),
  }));
  const totals = ageLayers(
    [...byProduct.values()].flatMap((p) => p.layers),
    date
  ).map((b) => ({ ...b, value: fromFils(b.valueFils) }));
  return { asOf: date, products, totals };
}

export async function inventoryMovementReport(companyId: string, from: string, to: string) {
  const rows = await rowsOf<{
    id: string;
    name: string;
    sku: string | null;
    open_value: string;
    in_value: string;
    out_value: string;
    in_qty: number;
    out_qty: number;
  }>(
    `SELECT p.id, p.name, p.sku,
            COALESCE(SUM(CASE WHEN COALESCE(m.movement_date, m.created_at::date) < $2::date
                               THEN m.total_cost END), 0)::text AS open_value,
            COALESCE(SUM(CASE WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.total_cost > 0 THEN m.total_cost END), 0)::text AS in_value,
            COALESCE(SUM(CASE WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.total_cost < 0 THEN -m.total_cost END), 0)::text AS out_value,
            COALESCE(SUM(CASE WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.type IN ('purchase','return','opening') THEN m.quantity
                              WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.type NOT IN ('sale','transfer_in','transfer_out') AND m.quantity > 0 THEN m.quantity
                              ELSE 0 END), 0)::int AS in_qty,
            COALESCE(SUM(CASE WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.type = 'sale' THEN m.quantity
                              WHEN COALESCE(m.movement_date, m.created_at::date) BETWEEN $2::date AND $3::date
                                AND m.type NOT IN ('purchase','return','opening','transfer_in','transfer_out') AND m.quantity < 0 THEN -m.quantity
                              ELSE 0 END), 0)::int AS out_qty
       FROM products p
       LEFT JOIN inventory_movements m ON m.product_id = p.id AND COALESCE(m.movement_date, m.created_at::date) <= $3::date
      WHERE p.company_id = $1 AND p.product_type = 'inventory'
      GROUP BY p.id, p.name, p.sku
      ORDER BY p.name`,
    [companyId, from, to]
  );
  return {
    from,
    to,
    rows: rows.map((r) => {
      const open = f(r.open_value);
      const inV = f(r.in_value);
      const outV = f(r.out_value);
      return {
        productId: r.id,
        name: r.name,
        sku: r.sku ?? null,
        openingValue: fromFils(open),
        inQty: Number(r.in_qty),
        inValue: fromFils(inV),
        outQty: Number(r.out_qty),
        outValue: fromFils(outV),
        closingValue: fromFils(open + inV - outV),
      };
    }),
  };
}

export async function reorderList(companyId: string) {
  const rows = await rowsOf<{
    id: string;
    name: string;
    name_ar: string | null;
    sku: string | null;
    current_stock: number;
    reorder_point: number;
    reorder_quantity: number | null;
  }>(
    `SELECT id, name, name_ar, sku, current_stock, reorder_point, reorder_quantity
       FROM products
      WHERE company_id = $1 AND is_active AND product_type = 'inventory' AND track_inventory
        AND reorder_point IS NOT NULL AND current_stock <= reorder_point
      ORDER BY (current_stock - reorder_point), name`,
    [companyId]
  );
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    nameAr: r.name_ar ?? null,
    sku: r.sku ?? null,
    currentStock: Number(r.current_stock),
    reorderPoint: Number(r.reorder_point),
    suggestedOrderQty: Math.max(
      Number(r.reorder_quantity ?? 0),
      Number(r.reorder_point) - Number(r.current_stock) + 1
    ),
  }));
}

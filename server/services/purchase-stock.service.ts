// The purchase-to-stock chain: goods received on a purchase order, bought on a bill, returned on a vendor credit.
//
// Inventory (1070) stays equal to the sum of stock x average cost (inventory-costing.service), so every
// way stock comes or goes is one movement here, and the ledger leg is the movement's exact value:
//   PO receipt        Dr 1070 / Cr 2015 GRNI           (the movement journals itself; costing on, tracked product)
//   Bill, direct      Dr 1070 (instead of expense)     (the bill entry carries the leg; the movement skips its own journal)
//   Bill, after a PO  Dr 2015 GRNI (clears the receipt), price difference to 5210
//   Vendor credit     Cr 1070 at what the stock leaves for; a difference to the credit amount goes to 5210
// Without costing (or for an untracked product) only the stock count moves and the bill posts as before.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { inventoryMovements, products, purchaseOrderLines } from "../../shared/schema";
import { AppError } from "../errors";
import { ACCOUNT_CODES } from "../constants";
import { applyMovementInTx, ensureSystemAccount, isCostingEnabled } from "./inventory-costing.service";
import { parseCalendarDay, uaeCalendarDate } from "../utils/date";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StockLeg {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

/** Every product named on a document must belong to the company (a foreign id would move another tenant's stock). */
export async function assertProductsOfCompany(companyId: string, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (wanted.length === 0) return;
  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, wanted)));
  if (found.length !== wanted.length) {
    throw new AppError({ message: "A line names a product that does not belong to this company.", statusCode: 422, code: "INVALID_PRODUCT" });
  }
}

const wholeUnits = (qty: unknown): number => Math.round(Number(qty) || 0);

// ---------------------------------------------------------------------------
// Purchase order receipt
// ---------------------------------------------------------------------------

/** Bring the goods of a purchase order into stock (Dr 1070 / Cr 2015 with costing on). Returns the movements made. */
export async function receivePurchaseOrderStockInTx(
  tx: Tx,
  po: { id: string; companyId: string; currency?: string | null; number?: string | null },
  userId: string,
  receiptDate?: unknown
): Promise<number> {
  const lines = await tx
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const stockLines = lines.filter((l: any) => l.productId && wholeUnits(l.quantity) >= 1);
  if (stockLines.length === 0) return 0;
  if ((po.currency || "AED").toUpperCase() !== "AED") {
    throw new AppError({
      message: "Goods on a foreign-currency purchase order are brought into stock when the bill is entered.",
      statusCode: 422,
      code: "FOREIGN_PO_RECEIPT",
    });
  }
  const date = receiptDate ? parseCalendarDay(receiptDate) : uaeCalendarDate();
  if (!date) throw new AppError({ message: "Receipt date must be a valid date.", statusCode: 400, code: "INVALID_DATE" });
  let made = 0;
  for (const line of stockLines as any[]) {
    const out = await applyMovementInTx(tx, {
      productId: line.productId,
      companyId: po.companyId,
      type: "purchase",
      quantity: wholeUnits(line.quantity),
      unitCost: Number(line.unitPrice),
      reference: `PO ${po.number ?? po.id.slice(0, 8)}`,
      notes: "Goods received",
      userId,
      date,
      purchaseOrderId: po.id,
    });
    if (out.productFound) made += 1;
  }
  return made;
}

// ---------------------------------------------------------------------------
// Bill approval
// ---------------------------------------------------------------------------

export interface BillStockRow {
  id: string;
  description: string;
  amount: string | number;
  quantity?: string | number | null;
  product_id?: string | null;
}

/**
 * The stock side of approving a bill: one purchase movement per product line (at the line's exact AED amount) and
 * the ledger legs that replace the line's expense debit. Returns the legs by line id; lines without a product (or
 * without costing) are not in the map and post as before.
 */
export async function applyBillStockInTx(
  tx: Tx,
  bill: { id: string; company_id: string; bill_date: string | Date; bill_number?: string | null; purchase_order_id?: string | null; exchange_rate?: string | number | null },
  rows: BillStockRow[],
  userId: string
): Promise<Map<string, StockLeg[]>> {
  const legs = new Map<string, StockLeg[]>();
  const stockRows = rows.filter((r) => r.product_id && wholeUnits(r.quantity) >= 1);
  if (stockRows.length === 0) return legs;
  const companyId = bill.company_id;
  const costing = await isCostingEnabled(tx, companyId);
  const fx = Number(bill.exchange_rate) > 0 ? Number(bill.exchange_rate) : 1;
  const date = parseCalendarDay(bill.bill_date) ?? uaeCalendarDate();
  const ref = `Bill ${bill.bill_number || bill.id.slice(0, 8)}`;

  const inventory = costing ? await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.INVENTORY, "asset") : null;
  const grni = costing ? await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.GRNI, "liability") : null;
  const variance = costing ? await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.INVENTORY_ADJUSTMENTS, "expense") : null;

  for (const row of stockRows) {
    const productId = row.product_id as string;
    const qty = wholeUnits(row.quantity);
    const amountAed = round2(Number(row.amount) * fx);
    const label = `${ref} - ${row.description}`.slice(0, 255);

    // Goods already received on the bill's purchase order, not yet billed: the bill clears GRNI for them.
    let receivedQty = 0;
    let receivedValue = 0;
    if (bill.purchase_order_id) {
      const rec = rowsOf(
        await tx.execute(sql`
          SELECT COALESCE(SUM(quantity), 0)::int AS qty, COALESCE(SUM(total_cost), 0)::float8 AS value
            FROM inventory_movements
           WHERE company_id = ${companyId} AND purchase_order_id = ${bill.purchase_order_id}
             AND product_id = ${productId} AND type = 'purchase' AND source_bill_id IS NULL`)
      )[0];
      receivedQty = Number(rec?.qty) || 0;
      receivedValue = Number(rec?.value) || 0;
    }

    const rowLegs: StockLeg[] = [];
    let directQty = qty;
    let directAmount = amountAed;
    if (costing && receivedQty > 0) {
      const clearedQty = Math.min(qty, receivedQty);
      const clearedGrni = round2(receivedValue * (clearedQty / receivedQty));
      const clearedBilled = round2(amountAed * (clearedQty / qty));
      rowLegs.push({ accountId: grni!.id, debit: clearedGrni, credit: 0, description: `${label} (clears goods received)` });
      const diff = round2(clearedBilled - clearedGrni);
      if (diff > 0) rowLegs.push({ accountId: variance!.id, debit: diff, credit: 0, description: `${label} (price difference)` });
      if (diff < 0) rowLegs.push({ accountId: variance!.id, debit: 0, credit: -diff, description: `${label} (price difference)` });
      await tx.execute(sql`
        UPDATE inventory_movements SET source_bill_id = ${bill.id}
         WHERE company_id = ${companyId} AND purchase_order_id = ${bill.purchase_order_id}
           AND product_id = ${productId} AND type = 'purchase' AND source_bill_id IS NULL`);
      directQty = qty - clearedQty;
      directAmount = round2(amountAed - clearedBilled);
    }
    if (directQty >= 1) {
      const out = await applyMovementInTx(tx, {
        productId,
        companyId,
        type: "purchase",
        quantity: directQty,
        valueOverride: directAmount,
        reference: ref,
        notes: "Bought on a bill",
        userId,
        date,
        sourceBillId: bill.id,
        skipJournal: true,
      });
      if (out.productFound && out.ok && out.tracked && costing && directAmount > 0) {
        rowLegs.push({ accountId: inventory!.id, debit: directAmount, credit: 0, description: label });
      } else if (rowLegs.length === 0) {
        continue; // untracked product or costing off: the line posts to its own account
      }
    }
    if (rowLegs.length > 0) legs.set(row.id, rowLegs);
  }
  return legs;
}

// ---------------------------------------------------------------------------
// Vendor credit (a return of goods to the supplier)
// ---------------------------------------------------------------------------

export interface CreditStockRow {
  id: string;
  description: string;
  line_total: string | number;
  quantity?: string | number | null;
  product_id?: string | null;
}

/**
 * Returned goods leave stock for the credit's value (never more than is on hand). Returns, per line id, the amount
 * that left 1070 and the line's AED credit, so the journal credits 1070 for what left and puts the rest in 5210.
 */
export async function applyVendorCreditStockInTx(
  tx: Tx,
  credit: { id: string; company_id: string; number?: string | null; date: string | Date; exchange_rate?: string | number | null },
  rows: CreditStockRow[],
  userId: string
): Promise<Map<string, { left: number; lineAed: number }>> {
  const out = new Map<string, { left: number; lineAed: number }>();
  const stockRows = rows.filter((r) => r.product_id && wholeUnits(r.quantity) >= 1);
  if (stockRows.length === 0) return out;
  const companyId = credit.company_id;
  const costing = await isCostingEnabled(tx, companyId);
  const fx = Number(credit.exchange_rate) > 0 ? Number(credit.exchange_rate) : 1;
  const date = parseCalendarDay(credit.date) ?? uaeCalendarDate();
  for (const row of stockRows) {
    const lineAed = round2(Number(row.line_total) * fx);
    const moved = await applyMovementInTx(tx, {
      productId: row.product_id as string,
      companyId,
      type: "adjustment",
      quantity: -wholeUnits(row.quantity),
      valueOverride: lineAed,
      reference: `Vendor credit ${credit.number ?? credit.id.slice(0, 8)}`,
      notes: "Returned to supplier",
      userId,
      date,
      sourceVendorCreditId: credit.id,
      skipJournal: true,
    });
    if (moved.productFound && moved.ok && moved.tracked && costing) out.set(row.id, { left: moved.amount, lineAed });
  }
  return out;
}

/** A void vendor credit puts the returned goods back at the value they left for. */
export async function restoreVendorCreditStockInTx(
  tx: Tx,
  credit: { id: string; company_id: string; number?: string | null; date: string | Date },
  userId: string
): Promise<void> {
  const moved = await tx
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.companyId, credit.company_id), eq(inventoryMovements.sourceVendorCreditId, credit.id)));
  const date = parseCalendarDay(credit.date) ?? uaeCalendarDate();
  for (const m of moved as any[]) {
    if (m.quantity >= 0) continue; // a restore from an earlier void
    await applyMovementInTx(tx, {
      productId: m.productId,
      companyId: credit.company_id,
      type: "adjustment",
      quantity: Math.abs(m.quantity),
      valueOverride: Number(m.totalCost) || 0,
      reference: `Void vendor credit ${credit.number ?? credit.id.slice(0, 8)}`,
      notes: "Return to supplier voided",
      userId,
      date,
      sourceVendorCreditId: credit.id,
      skipJournal: true,
    });
  }
}

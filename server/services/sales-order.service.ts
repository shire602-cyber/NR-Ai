// Sales orders (Phase 8 D1): quote -> sales order -> delivery notes and (partial) invoices.
//
// A sales order posts NOTHING. Invoiced and delivered quantities are DERIVED (invoices that are not void or cancelled,
// delivery lines), so a void releases quantity by itself. Stock is not reserved: the order shows AVAILABLE-TO-PROMISE
// (on-hand stock minus what other open orders still have to ship) and a shortfall, and stock moves when the invoice is
// issued, exactly as before. Money rules (period lock, VAT, journals) all belong to the invoice that bills the order.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoices,
  products,
  quotes,
  quoteLines,
  salesOrderDeliveries,
  salesOrderDeliveryLines,
  salesOrderLines,
  salesOrders,
  customerContacts,
  type Invoice,
  type SalesOrder,
  type SalesOrderLine,
} from "../../shared/schema";
import { AppError } from "../errors";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { resolveDocumentExchangeRate } from "./document-fx-rate";
import { amountDiscountToPercent, deriveSalesLines, type DiscountType } from "../../shared/sales-line-math";
import {
  deriveError,
  editableLinesOf,
  replaceInvoiceLines,
  replaceSalesOrderLines,
  type SalesLineSource,
} from "./sales-lines.service";
import { checkProductsForCompany } from "./inventory-costing.service";
import { checkRevenueAccountsForCompany } from "./revenue-account-guard.service";
import { checkPriceListsForCompany } from "./price-list.service";
import { canQuoteTransition } from "./quote-state-machine";
import { copyValues } from "./custom-fields.service";
import { deriveVatSupplyType } from "./vat-supply-type";
import { normalizeQuantity } from "./document-line-limits";
import { uuidArray } from "./sql-uuid-array";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const refuse = (statusCode: number, code: string, message: string, details?: unknown) =>
  new AppError({ message, statusCode, code, details });
const qty = (n: unknown) => normalizeQuantity(Number(n) || 0);
const EPS = 0.00005;

// ─── derived quantities ─────────────────────────────────────────────────────

export interface LineQuantities {
  ordered: number;
  invoiced: number;
  delivered: number;
}

/** Ordered, invoiced (not void/cancelled) and delivered quantity per sales order line. */
export async function lineQuantities(tx: Tx, salesOrderId: string, excludeInvoiceId?: string): Promise<Map<string, LineQuantities>> {
  const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, salesOrderId));
  const out = new Map<string, LineQuantities>();
  for (const l of lines) out.set(l.id, { ordered: Number(l.quantity), invoiced: 0, delivered: 0 });
  if (lines.length === 0) return out;
  const ids = lines.map((l: SalesOrderLine) => l.id);
  const invoicedRows = rowsOf(
    await tx.execute(sql`
      SELECT il.sales_order_line_id::text AS id, COALESCE(SUM(il.quantity), 0)::float8 AS qty
        FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE il.sales_order_line_id = ANY(${uuidArray(ids)}) AND i.status NOT IN ('void', 'cancelled')
         ${excludeInvoiceId ? sql`AND i.id <> ${excludeInvoiceId}::uuid` : sql``}
       GROUP BY il.sales_order_line_id`)
  );
  for (const r of invoicedRows) {
    const q = out.get(r.id);
    if (q) q.invoiced = Number(r.qty);
  }
  const deliveredRows = rowsOf(
    await tx.execute(sql`
      SELECT dl.sales_order_line_id::text AS id, COALESCE(SUM(dl.quantity), 0)::float8 AS qty
        FROM sales_order_delivery_lines dl WHERE dl.sales_order_line_id = ANY(${uuidArray(ids)})
       GROUP BY dl.sales_order_line_id`)
  );
  for (const r of deliveredRows) {
    const q = out.get(r.id);
    if (q) q.delivered = Number(r.qty);
  }
  return out;
}

export type InvoicingStatus = "not_invoiced" | "partially_invoiced" | "invoiced";
export type DeliveryStatus = "not_delivered" | "partially_delivered" | "delivered";

/** Status of an order from its billable lines (items and shipping). */
export function orderStatuses(lines: Array<{ lineKind: string; quantities: LineQuantities }>): { invoicingStatus: InvoicingStatus; deliveryStatus: DeliveryStatus } {
  const billable = lines.filter((l) => l.lineKind === "item" || l.lineKind === "shipping");
  const items = lines.filter((l) => l.lineKind === "item");
  const anyInvoiced = billable.some((l) => l.quantities.invoiced > EPS);
  const allInvoiced = billable.length > 0 && billable.every((l) => l.quantities.invoiced + EPS >= l.quantities.ordered);
  const anyDelivered = items.some((l) => l.quantities.delivered > EPS);
  const allDelivered = items.length > 0 && items.every((l) => l.quantities.delivered + EPS >= l.quantities.ordered);
  return {
    invoicingStatus: allInvoiced ? "invoiced" : anyInvoiced ? "partially_invoiced" : "not_invoiced",
    deliveryStatus: allDelivered ? "delivered" : anyDelivered ? "partially_delivered" : "not_delivered",
  };
}

// ─── available to promise ───────────────────────────────────────────────────

/**
 * Quantity other OPEN orders still have to ship, per product. Stock leaves when an invoice is ISSUED, so a draft invoice
 * has not taken any yet: only issued invoices count as shipped here.
 */
async function committedByProduct(tx: Tx, companyId: string, productIds: string[], excludeSalesOrderId?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const rows = rowsOf(
    await tx.execute(sql`
      SELECT sol.product_id::text AS pid,
             COALESCE(SUM(GREATEST(sol.quantity - COALESCE(inv.q, 0), 0)), 0)::float8 AS committed
        FROM sales_order_lines sol
        JOIN sales_orders so ON so.id = sol.sales_order_id
        LEFT JOIN LATERAL (
          SELECT SUM(il.quantity) AS q FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
           WHERE il.sales_order_line_id = sol.id AND i.status NOT IN ('draft', 'void', 'cancelled')
        ) inv ON true
       WHERE so.company_id = ${companyId}::uuid AND so.status = 'open' AND sol.line_kind = 'item'
         AND sol.product_id = ANY(${uuidArray(productIds)})
         ${excludeSalesOrderId ? sql`AND so.id <> ${excludeSalesOrderId}::uuid` : sql``}
       GROUP BY sol.product_id`)
  );
  for (const r of rows) out.set(r.pid, Number(r.committed));
  return out;
}

export interface ProductAvailability {
  productId: string;
  onHand: number;
  committed: number;
  available: number;
}

/** On-hand stock minus what open sales orders still owe, for tracked products of this company. */
export async function productAvailability(companyId: string, productIds: string[]): Promise<ProductAvailability[]> {
  if (productIds.length === 0) return [];
  const rows = await db
    .select({ id: products.id, currentStock: products.currentStock, trackInventory: products.trackInventory })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
  const committed = await committedByProduct(db, companyId, rows.map((r: any) => r.id));
  return rows.map((r: any) => {
    const onHand = Number(r.currentStock) || 0;
    const c = committed.get(r.id) ?? 0;
    return { productId: r.id, onHand, committed: c, available: onHand - c };
  });
}

// ─── reads ──────────────────────────────────────────────────────────────────

export async function getSalesOrder(companyId: string, id: string) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), eq(salesOrders.companyId, companyId)));
  if (!order) return null;
  const lines = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, id))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.id));
  const quantities = await lineQuantities(db, id);
  const productIds: string[] = [
    ...new Set<string>(lines.map((l: SalesOrderLine) => l.productId).filter((p: string | null): p is string => !!p)),
  ];
  const tracked = productIds.length
    ? await db
        .select({ id: products.id, trackInventory: products.trackInventory, currentStock: products.currentStock })
        .from(products)
        .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)))
    : [];
  const trackedById = new Map(tracked.map((t: any) => [t.id, t]));
  const committed = await committedByProduct(db, companyId, productIds, id);

  const outLines = lines.map((l: SalesOrderLine) => {
    const q = quantities.get(l.id) ?? { ordered: Number(l.quantity), invoiced: 0, delivered: 0 };
    const remaining = Math.max(0, q.ordered - q.invoiced);
    const product: any = l.productId ? trackedById.get(l.productId) : null;
    let availableToPromise: number | null = null;
    let shortfall: number | null = null;
    if (l.lineKind === "item" && product?.trackInventory) {
      availableToPromise = (Number(product.currentStock) || 0) - (committed.get(l.productId as string) ?? 0);
      shortfall = Math.max(0, remaining - Math.max(0, availableToPromise));
    }
    return {
      ...l,
      invoicedQty: q.invoiced,
      deliveredQty: q.delivered,
      remainingQty: remaining,
      availableToPromise,
      shortfall,
      quantities: q,
    };
  });
  const statuses = orderStatuses(outLines.map((l: any) => ({ lineKind: l.lineKind, quantities: l.quantities })));
  const orderInvoices = await db
    .select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, date: invoices.date })
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.salesOrderId, id)))
    .orderBy(asc(invoices.createdAt));
  const deliveries = await db
    .select()
    .from(salesOrderDeliveries)
    .where(and(eq(salesOrderDeliveries.companyId, companyId), eq(salesOrderDeliveries.salesOrderId, id)))
    .orderBy(asc(salesOrderDeliveries.createdAt));
  return {
    ...order,
    ...statuses,
    lines: outLines.map(({ quantities: _q, ...rest }: any) => rest),
    invoices: orderInvoices,
    deliveries,
  };
}

export async function listSalesOrders(companyId: string, filter: { status?: string; contactId?: string } = {}) {
  const conds = [eq(salesOrders.companyId, companyId)];
  if (filter.status) conds.push(eq(salesOrders.status, filter.status));
  if (filter.contactId) conds.push(eq(salesOrders.contactId, filter.contactId));
  const orders = await db.select().from(salesOrders).where(and(...conds)).orderBy(desc(salesOrders.createdAt));
  const out = [];
  for (const o of orders) {
    const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    const quantities = await lineQuantities(db, o.id);
    out.push({
      ...o,
      ...orderStatuses(lines.map((l: SalesOrderLine) => ({ lineKind: l.lineKind, quantities: quantities.get(l.id)! }))),
    });
  }
  return out;
}

// ─── create / update ────────────────────────────────────────────────────────

export interface SalesOrderInput {
  contactId: string;
  date: Date;
  expectedDate?: Date | null;
  currency?: string;
  exchangeRate?: number | null;
  notes?: string | null;
  lines: SalesLineSource[];
  discountType?: DiscountType | null;
  discountValue?: number | null;
}

/** Sales orders take percent discounts only, so a partial invoice can carry the same percent. */
function assertPercentOnly(input: Pick<SalesOrderInput, "lines" | "discountType">) {
  if (input.discountType === "amount" || input.lines.some((l) => l.discountType === "amount")) {
    throw refuse(422, "SO_DISCOUNT_PERCENT_ONLY", "Sales orders take percent discounts only: a partial invoice must carry the same percent.");
  }
}

async function validateInputs(companyId: string, input: SalesOrderInput) {
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.companyId, companyId)));
  if (!contact) throw refuse(422, "CONTACT_NOT_FOUND", "contactId is not a contact of this company.");
  assertPercentOnly(input);
  const rev = await checkRevenueAccountsForCompany(companyId, input.lines.map((l) => l.revenueAccountId));
  if (!rev.ok) throw refuse(rev.status, rev.code, rev.message);
  const prod = await checkProductsForCompany(companyId, input.lines.map((l) => l.productId));
  if (!prod.ok) throw refuse(prod.status, prod.code, prod.message);
  const pl = await checkPriceListsForCompany(companyId, input.lines.map((l) => l.priceListId));
  if (!pl.ok) throw refuse(422, pl.code, pl.message);
  const pre = deriveSalesLines({ lines: input.lines, discountType: input.discountType, discountValue: input.discountValue });
  if (!pre.ok) throw deriveError(pre);
  return contact;
}

export async function createSalesOrder(args: { companyId: string; userId: string; input: SalesOrderInput; quoteId?: string | null }): Promise<SalesOrder> {
  const { companyId, userId, input } = args;
  const contact = await validateInputs(companyId, input);
  const currency = (input.currency || "AED").toUpperCase();
  const fx = await resolveDocumentExchangeRate({ currency, date: input.date, companyId, suppliedRate: input.exchangeRate });
  if (!fx.ok) throw refuse(422, fx.code, fx.message);
  return await db.transaction(async (tx: Tx) => {
    const number = await allocateInvoiceNumber(companyId, "sales_order", input.date, tx);
    const [order] = await tx
      .insert(salesOrders)
      .values({
        companyId,
        number,
        contactId: contact.id,
        customerName: contact.name,
        customerTrn: contact.trnNumber ?? undefined,
        quoteId: args.quoteId ?? null,
        date: input.date,
        expectedDate: input.expectedDate ?? null,
        currency,
        exchangeRate: fx.rate,
        notes: input.notes ?? null,
        status: "open",
        createdBy: userId,
      } as any)
      .returning();
    await replaceSalesOrderLines(tx, { companyId, salesOrderId: order.id, lines: input.lines, discountType: input.discountType, discountValue: input.discountValue });
    const [stored] = await tx.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    return stored;
  });
}

async function lockOrder(tx: Tx, companyId: string, id: string): Promise<SalesOrder> {
  const found = rowsOf(await tx.execute(sql`SELECT id FROM sales_orders WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`));
  if (found.length === 0) throw refuse(404, "SALES_ORDER_NOT_FOUND", "Sales order not found");
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
  return order;
}

function activityOf(quantities: Map<string, LineQuantities>) {
  let invoiced = 0;
  let delivered = 0;
  for (const q of quantities.values()) {
    invoiced += q.invoiced;
    delivered += q.delivered;
  }
  return { invoiced, delivered };
}

export async function updateSalesOrder(args: { companyId: string; id: string; input: SalesOrderInput }): Promise<SalesOrder> {
  const { companyId, id, input } = args;
  const contact = await validateInputs(companyId, input);
  const currency = (input.currency || "AED").toUpperCase();
  const fx = await resolveDocumentExchangeRate({ currency, date: input.date, companyId, suppliedRate: input.exchangeRate });
  if (!fx.ok) throw refuse(422, fx.code, fx.message);
  return await db.transaction(async (tx: Tx) => {
    const order = await lockOrder(tx, companyId, id);
    const q = await lineQuantities(tx, id);
    const activity = activityOf(q);
    if (order.status !== "open" || activity.invoiced > 0 || activity.delivered > 0) {
      throw refuse(409, "SO_LOCKED", "This sales order has been invoiced or delivered (or is closed), so it can no longer be edited.");
    }
    await tx
      .update(salesOrders)
      .set({
        contactId: contact.id,
        customerName: contact.name,
        customerTrn: contact.trnNumber ?? null,
        date: input.date,
        expectedDate: input.expectedDate ?? null,
        currency,
        exchangeRate: fx.rate,
        notes: input.notes ?? null,
      } as any)
      .where(eq(salesOrders.id, id));
    await replaceSalesOrderLines(tx, { companyId, salesOrderId: id, lines: input.lines, discountType: input.discountType, discountValue: input.discountValue });
    const [stored] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id));
    return stored;
  });
}

export async function closeSalesOrder(companyId: string, id: string): Promise<SalesOrder> {
  return await db.transaction(async (tx: Tx) => {
    const order = await lockOrder(tx, companyId, id);
    if (order.status !== "open") throw refuse(409, "SO_NOT_OPEN", `This sales order is ${order.status}.`);
    const [row] = await tx.update(salesOrders).set({ status: "closed", updatedAt: new Date() } as any).where(eq(salesOrders.id, id)).returning();
    return row;
  });
}

export async function cancelSalesOrder(companyId: string, id: string): Promise<SalesOrder> {
  return await db.transaction(async (tx: Tx) => {
    const order = await lockOrder(tx, companyId, id);
    if (order.status !== "open") throw refuse(409, "SO_NOT_OPEN", `This sales order is ${order.status}.`);
    const activity = activityOf(await lineQuantities(tx, id));
    if (activity.invoiced > 0 || activity.delivered > 0) {
      throw refuse(409, "SO_HAS_ACTIVITY", "Something has been invoiced or delivered against this order: close it instead of cancelling.");
    }
    const [row] = await tx.update(salesOrders).set({ status: "cancelled", updatedAt: new Date() } as any).where(eq(salesOrders.id, id)).returning();
    return row;
  });
}

export async function deleteSalesOrder(companyId: string, id: string): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    const order = await lockOrder(tx, companyId, id);
    const activity = activityOf(await lineQuantities(tx, id));
    const dn = rowsOf(await tx.execute(sql`SELECT 1 FROM sales_order_deliveries WHERE sales_order_id = ${id}::uuid LIMIT 1`));
    const inv = rowsOf(await tx.execute(sql`SELECT 1 FROM invoices WHERE sales_order_id = ${id}::uuid LIMIT 1`));
    if (activity.invoiced > 0 || activity.delivered > 0 || dn.length > 0 || inv.length > 0 || order.status === "closed") {
      throw refuse(409, "SO_LOCKED", "This sales order has documents against it and cannot be deleted. Close or cancel it instead.");
    }
    await tx.delete(salesOrders).where(eq(salesOrders.id, id));
  });
}

// ─── invoicing ──────────────────────────────────────────────────────────────

export interface InvoiceRequestLine {
  salesOrderLineId: string;
  quantity: number;
}

/**
 * Check requested quantities against what is still open on the order. `excludeInvoiceId` is the invoice being edited
 * (its own quantities are not counted against itself). Caller holds the order row lock.
 */
export function checkRequestedQuantities(
  quantities: Map<string, LineQuantities>,
  requested: InvoiceRequestLine[]
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const perLine = new Map<string, number>();
  for (const r of requested) perLine.set(r.salesOrderLineId, (perLine.get(r.salesOrderLineId) ?? 0) + r.quantity);
  for (const [lineId, wanted] of perLine) {
    const q = quantities.get(lineId);
    if (!q) return { ok: false, status: 422, code: "SALES_ORDER_LINE_MISMATCH", message: "A line does not belong to this sales order." };
    if (wanted > q.ordered - q.invoiced + EPS) {
      return {
        ok: false,
        status: 422,
        code: "SO_QTY_EXCEEDED",
        message: `Only ${qty(Math.max(0, q.ordered - q.invoiced))} is left to invoice on this line (asked for ${qty(wanted)}).`,
      };
    }
  }
  return { ok: true };
}

/** Re-check a draft invoice that is linked to a sales order when it is edited (called under INVOICE_POSTING). */
export async function assertSalesOrderQuantitiesForEdit(
  tx: Tx,
  args: { companyId: string; invoiceId: string; salesOrderId: string; lines: Array<{ salesOrderLineId?: string | null; quantity: number }> }
): Promise<void> {
  const order = await lockOrder(tx, args.companyId, args.salesOrderId);
  if (order.status === "cancelled") throw refuse(409, "SO_NOT_OPEN", "The sales order is cancelled.");
  const quantities = await lineQuantities(tx, args.salesOrderId, args.invoiceId);
  const requested = args.lines
    .filter((l) => !!l.salesOrderLineId)
    .map((l) => ({ salesOrderLineId: l.salesOrderLineId as string, quantity: Number(l.quantity) }));
  const check = checkRequestedQuantities(quantities, requested);
  if (!check.ok) throw refuse(check.status, check.code, check.message);
}

export async function invoiceSalesOrder(args: {
  companyId: string;
  salesOrderId: string;
  userId: string;
  date?: Date;
  lines: InvoiceRequestLine[];
}): Promise<Invoice> {
  const { companyId, salesOrderId, userId } = args;
  if (args.lines.length === 0) throw refuse(422, "NOTHING_TO_INVOICE", "Choose at least one line and quantity to invoice.");
  const invoiceDate = args.date ?? new Date();
  const [preview] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.companyId, companyId)));
  if (!preview) throw refuse(404, "SALES_ORDER_NOT_FOUND", "Sales order not found");
  const fx = await resolveDocumentExchangeRate({ currency: preview.currency, date: invoiceDate, companyId, hint: "Add one under Exchange Rates, then invoice again." });
  if (!fx.ok) throw refuse(422, fx.code, fx.message);

  return await db.transaction(async (tx: Tx) => {
    // The order row lock serialises parallel invoicing of one order (I-3): the remainder is recomputed under it.
    const order = await lockOrder(tx, companyId, salesOrderId);
    if (order.status !== "open") throw refuse(409, "SO_NOT_OPEN", `This sales order is ${order.status}.`);
    const quantities = await lineQuantities(tx, salesOrderId);
    const billable = (await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, salesOrderId))).filter(
      (l: SalesOrderLine) => l.lineKind === "item" || l.lineKind === "shipping"
    );
    if (billable.every((l: SalesOrderLine) => (quantities.get(l.id)?.invoiced ?? 0) + EPS >= Number(l.quantity))) {
      throw refuse(409, "SO_FULLY_INVOICED", "This sales order has already been invoiced in full.");
    }
    const check = checkRequestedQuantities(quantities, args.lines);
    if (!check.ok) throw refuse(check.status, check.code, check.message);

    const byId = new Map<string, SalesOrderLine>(billable.map((l: SalesOrderLine) => [l.id, l]));
    const merged = new Map<string, number>();
    for (const r of args.lines) merged.set(r.salesOrderLineId, (merged.get(r.salesOrderLineId) ?? 0) + r.quantity);
    const sources: SalesLineSource[] = [];
    for (const [lineId, quantity] of merged) {
      const l = byId.get(lineId);
      if (!l) throw refuse(422, "SALES_ORDER_LINE_MISMATCH", "A line does not belong to this sales order, or cannot be invoiced.");
      sources.push({
        kind: l.lineKind === "shipping" ? "shipping" : "item",
        description: l.description,
        quantity: qty(quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        vatSupplyType: deriveVatSupplyType(Number(l.vatRate), l.vatSupplyType),
        discountType: l.lineKind === "shipping" ? null : ((l.discountType as DiscountType | null) ?? null),
        discountValue: l.lineKind === "shipping" || l.discountValue === null ? null : Number(l.discountValue),
        revenueAccountId: l.revenueAccountId ?? null,
        productId: l.productId ?? null,
        priceListId: l.priceListId ?? null,
        salesOrderLineId: l.id,
      });
    }
    const number = await allocateInvoiceNumber(companyId, "invoice", invoiceDate, tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        companyId,
        number,
        customerName: order.customerName,
        customerTrn: order.customerTrn ?? undefined,
        contactId: order.contactId,
        date: invoiceDate,
        dueDate: invoiceDate,
        currency: order.currency,
        exchangeRate: fx.rate,
        invoiceType: "invoice",
        status: "draft",
        salesOrderId,
        subtotal: 0,
        vatAmount: 0,
        total: 0,
      } as any)
      .returning();
    await replaceInvoiceLines(tx, {
      companyId,
      invoiceId: invoice.id,
      lines: sources,
      // The order's percent discount rides along; a partial invoice gets the same percent of its own items.
      discountType: (order.discountType as DiscountType | null) ?? null,
      discountValue: order.discountValue === null ? null : Number(order.discountValue),
      exchangeRate: fx.rate,
      itemExtras: (source) => ({ priceListId: source.priceListId ?? null, salesOrderLineId: source.salesOrderLineId ?? null }),
    });
    await copyValues(companyId, { entity: "sales_order", recordId: salesOrderId }, { entity: "invoice", recordId: invoice.id }, tx);
    const [stored] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    return stored;
  });
}

// ─── deliveries ─────────────────────────────────────────────────────────────

export async function createDelivery(args: {
  companyId: string;
  salesOrderId: string;
  userId: string;
  date: Date;
  notes?: string | null;
  lines: InvoiceRequestLine[];
}) {
  const { companyId, salesOrderId, userId } = args;
  if (args.lines.length === 0) throw refuse(422, "NOTHING_TO_DELIVER", "Choose at least one line and quantity to deliver.");
  return await db.transaction(async (tx: Tx) => {
    const order = await lockOrder(tx, companyId, salesOrderId);
    if (order.status !== "open") throw refuse(409, "SO_NOT_OPEN", `This sales order is ${order.status}.`);
    const quantities = await lineQuantities(tx, salesOrderId);
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, salesOrderId));
    const itemIds = new Set(lines.filter((l: SalesOrderLine) => l.lineKind === "item").map((l: SalesOrderLine) => l.id));
    const merged = new Map<string, number>();
    for (const r of args.lines) {
      if (!itemIds.has(r.salesOrderLineId)) throw refuse(422, "SALES_ORDER_LINE_MISMATCH", "A line does not belong to this sales order, or cannot be delivered.");
      merged.set(r.salesOrderLineId, (merged.get(r.salesOrderLineId) ?? 0) + r.quantity);
    }
    for (const [lineId, wanted] of merged) {
      const q = quantities.get(lineId)!;
      if (wanted > q.ordered - q.delivered + EPS) {
        throw refuse(
          422,
          "DELIVERY_EXCEEDS_ORDERED",
          `Only ${qty(Math.max(0, q.ordered - q.delivered))} is left to deliver on this line (asked for ${qty(wanted)}).`
        );
      }
    }
    const number = await allocateInvoiceNumber(companyId, "delivery_note", args.date, tx);
    const [delivery] = await tx
      .insert(salesOrderDeliveries)
      .values({ companyId, salesOrderId, number, date: args.date, notes: args.notes ?? null, createdBy: userId } as any)
      .returning();
    for (const [lineId, quantity] of merged) {
      await tx.insert(salesOrderDeliveryLines).values({ deliveryId: delivery.id, salesOrderLineId: lineId, quantity: qty(quantity) } as any);
    }
    return delivery;
  });
}

export async function getDelivery(companyId: string, salesOrderId: string, deliveryId: string) {
  const [delivery] = await db
    .select()
    .from(salesOrderDeliveries)
    .where(and(eq(salesOrderDeliveries.id, deliveryId), eq(salesOrderDeliveries.salesOrderId, salesOrderId), eq(salesOrderDeliveries.companyId, companyId)));
  if (!delivery) return null;
  const lines = await db.select().from(salesOrderDeliveryLines).where(eq(salesOrderDeliveryLines.deliveryId, deliveryId));
  return { delivery, lines };
}

// ─── quote -> sales order ───────────────────────────────────────────────────

/**
 * Convert a quote to a sales order in ONE transaction: the order is inserted and the quote's status flipped by a
 * compare-and-swap, so two parallel conversions can never make two orders (the loser gets 409 QUOTE_ALREADY_CONVERTED).
 */
export async function convertQuoteToSalesOrder(args: { companyId: string; quoteId: string; userId: string }): Promise<SalesOrder> {
  const { companyId, quoteId, userId } = args;
  // Everything that needs the pool is read BEFORE the transaction opens (a second pool connection inside a document
  // lock could starve the pool under load): the quote's currency and its rate for today.
  const [peek] = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)));
  if (!peek) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found");
  const now = new Date();
  const fx = await resolveDocumentExchangeRate({
    currency: (peek.currency || "AED").toUpperCase(),
    date: now,
    companyId,
    hint: "Add one under Exchange Rates, then convert the quote again.",
  });
  if (!fx.ok) throw refuse(422, fx.code, fx.message);
  return await withDocumentLock(quoteId, LOCK_NS.QUOTE, async (tx: Tx) => {
    const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)));
    if (!quote) throw refuse(404, "QUOTE_NOT_FOUND", "Quote not found");
    if (quote.status === "converted") throw refuse(409, "QUOTE_ALREADY_CONVERTED", "This quote has already been converted.");
    if (!canQuoteTransition(quote.status, "convert")) {
      throw refuse(409, "QUOTE_NOT_CONVERTIBLE", `A ${quote.status} quote cannot be converted.`);
    }
    if (!quote.contactId) {
      throw refuse(422, "QUOTE_CONTACT_REQUIRED", "Choose the customer contact on the quote before converting it to a sales order.");
    }
    const [contact] = await tx
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.id, quote.contactId), eq(customerContacts.companyId, companyId)));
    if (!contact) throw refuse(422, "CONTACT_NOT_FOUND", "The quote's customer contact no longer exists.");
    const stored = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).orderBy(asc(quoteLines.sortOrder), asc(quoteLines.id));

    // Amount discounts become 6-dp percents (a sales order takes percents only); the totals must come out the same.
    const items = editableLinesOf(stored as any[]);
    let docType = (quote.discountType as DiscountType | null) ?? null;
    let docValue = quote.discountValue === null ? null : Number(quote.discountValue);
    const sources: SalesLineSource[] = items.map((l) => {
      if (l.kind === "item" && l.discountType === "amount" && l.discountValue) {
        const gross = l.quantity * l.unitPrice;
        return { ...l, discountType: "percent" as const, discountValue: amountDiscountToPercent(l.discountValue, gross) };
      }
      return l;
    });
    if (docType === "amount" && docValue) {
      const pre = deriveSalesLines({ lines: sources, discountType: null, discountValue: null });
      if (!pre.ok) throw deriveError(pre);
      docType = "percent";
      docValue = amountDiscountToPercent(docValue, pre.itemsSubtotal);
    }
    const check = deriveSalesLines({ lines: sources, discountType: docType, discountValue: docValue });
    if (!check.ok) throw deriveError(check);
    if (Math.abs(check.total - Number(quote.total)) > 0.011 || Math.abs(check.vatAmount - Number(quote.vatAmount)) > 0.011) {
      throw refuse(
        422,
        "DISCOUNT_CONVERSION_ROUNDING",
        "The quote's amount discounts cannot be turned into percents without changing its total. Edit the quote to use percent discounts."
      );
    }

    const currency = (quote.currency || "AED").toUpperCase();
    const number = await allocateInvoiceNumber(companyId, "sales_order", now, tx);
    const [order] = await tx
      .insert(salesOrders)
      .values({
        companyId,
        number,
        contactId: contact.id,
        customerName: quote.customerName,
        customerTrn: quote.customerTrn ?? undefined,
        quoteId: quote.id,
        date: now,
        currency,
        exchangeRate: fx.rate,
        notes: quote.notes ?? null,
        status: "open",
        createdBy: userId,
      } as any)
      .returning();
    await replaceSalesOrderLines(tx, { companyId, salesOrderId: order.id, lines: sources, discountType: docType, discountValue: docValue });
    await copyValues(companyId, { entity: "quote", recordId: quote.id }, { entity: "sales_order", recordId: order.id }, tx);
    // Compare-and-swap: only a quote still in a convertible state flips.
    const swapped = await tx
      .update(quotes)
      .set({ status: "converted", convertedSalesOrderId: order.id, updatedAt: new Date() } as any)
      .where(and(eq(quotes.id, quoteId), inArrayStatus(["draft", "sent", "accepted"])))
      .returning({ id: quotes.id });
    if (swapped.length === 0) throw refuse(409, "QUOTE_ALREADY_CONVERTED", "This quote has already been converted.");
    const [saved] = await tx.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    return saved;
  });
}

const inArrayStatus = (statuses: string[]) => inArray(quotes.status, statuses);

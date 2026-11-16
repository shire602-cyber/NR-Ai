/**
 * Document hooks (W4-B: R10-01, R10-02, R10-15). Each runs on the document's own ledger
 * transaction, so stock and the inventory / COGS journal commit atomically with the document.
 *
 *   bill approval        product lines: Dr Inventory instead of expense, stock in at cost.
 *                        PO-linked lines first clear Goods Received Not Invoiced (2015);
 *                        the price difference goes to COGS (purchase price variance).
 *   bill void / revise   stock taken back at its own value (true-up to COGS when it changed).
 *   invoice issue        product lines: stock out at cost, Dr COGS / Cr Inventory ('invoice_cogs').
 *   invoice void         COGS entry mirrored, stock put back at the cost it left at.
 *   credit note issue    product lines restocked at the original sale's unit cost
 *                        ('credit_note_cogs': Dr Inventory / Cr COGS); void mirrors it.
 *   PO goods received    stock in at the PO price, Dr Inventory / Cr GRNI (own transaction:
 *                        the purchase-order module calls it after its commit).
 */
import { sql } from "drizzle-orm";
import { DomainError } from "../../errors";
import { createLogger } from "../../config/logger";
import { fromFils, mulRate, toFils } from "../../../shared/money";
import {
  reverseBySource,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../../ledger";
import { has, resolve } from "../../platform/service-registry";
import { prorate } from "./costing";
import {
  postInventoryJournal,
  reverseMovement,
  stockIn,
  stockOut,
  toKernelLines,
  trueUpLines,
  type DraftLine,
  type MoveContext,
} from "./engine";
import {
  documentMovements,
  ensureAccountByCode,
  filsOfNumeric,
  INVENTORY_CODES,
  insertMovement,
  isStocked,
  linkMovementsToEntry,
  lockProduct,
  movementExists,
  q,
  type ProductRow,
} from "./store";

const log = createLogger("inventory-documents");

const isoDate = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);

function wholeQty(raw: unknown, context: Record<string, unknown>): number {
  const n = Math.abs(Number(raw ?? 1));
  if (!Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "FRACTIONAL_STOCK_QUANTITY",
      422,
      { quantity: raw, ...context },
      "Stock items must be bought and sold in whole units"
    );
  }
  return n;
}

async function productOrNull(
  tx: LedgerTx,
  companyId: string,
  productId: string | null | undefined
): Promise<ProductRow | null> {
  if (!productId) return null;
  return lockProduct(tx, companyId, productId);
}

// ─── Reversal (shared) ──────────────────────────────────────────────────────

/**
 * Reverse every live movement of a document. The caller has already mirrored the document's
 * journal; any difference between that mirror and the real change in stock value (a FIFO layer
 * that was partly sold, a weighted-average pool that moved) is posted as an adjustment.
 */
export async function reverseDocumentStock(
  tx: LedgerTx,
  args: { companyId: string; sourceType: string; sourceId: string; actorId: string; label: string }
): Promise<{ reversed: number; adjustmentEntryId: string | null }> {
  const movements = await documentMovements(tx, args.companyId, args.sourceType, args.sourceId);
  if (!movements.length) return { reversed: 0, adjustmentEntryId: null };
  const date = todayIso();
  const lines: DraftLine[] = [];
  let firstReversal: string | null = null;
  for (const m of [...movements].reverse()) {
    const meta = (m.meta ?? {}) as Record<string, unknown>;
    if (m.type === "grni_clear") {
      await tx.execute(
        sql`UPDATE inventory_grni SET cleared_qty = cleared_qty - ${Number(m.quantity)},
                   cleared_value = cleared_value - ${fromFils(Number(meta.clearedFils ?? 0))}
             WHERE purchase_order_line_id = ${String(meta.poLineId)}`
      );
      const id = await insertMovement(tx, {
        companyId: args.companyId,
        productId: m.product_id,
        type: "reversal",
        quantity: 0,
        totalCostFils: 0,
        date,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceLineId: m.source_line_id,
        reversesMovementId: m.id,
        actorId: args.actorId,
        meta: { grni: true },
      });
      firstReversal ??= id;
      continue;
    }
    if (meta.billedAheadQty && meta.poLineId) {
      await tx.execute(
        sql`UPDATE inventory_grni SET billed_ahead_qty = GREATEST(0, billed_ahead_qty - ${Number(meta.billedAheadQty)})
             WHERE purchase_order_line_id = ${String(meta.poLineId)}`
      );
    }
    const ctx: MoveContext = {
      companyId: args.companyId,
      actorId: args.actorId,
      date,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      sourceLineId: m.source_line_id,
      reference: `Reversal - ${args.label}`,
    };
    const r = await reverseMovement(tx, m, ctx);
    firstReversal ??= r.movementId;
    const mirrored = -filsOfNumeric(m.total_cost);
    lines.push(...trueUpLines(r, mirrored, null, `Reversal ${args.label}`));
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date,
    memo: `Inventory reversal adjustment - ${args.label}`,
    source: "inventory_adjustment",
    sourceId: args.sourceId,
    idempotencyKey: `inventory:reverse:${firstReversal}`,
    lines,
    actorId: args.actorId,
  });
  return { reversed: movements.length, adjustmentEntryId: entryId };
}

// ─── Bills ──────────────────────────────────────────────────────────────────

export interface BillStockPlanInput {
  bill: { id: string; company_id: string; bill_number: string | null; revision?: number | null };
  date: string;
  /** Journal lines planned by bill-posting (expense debits per bill line, VAT, A/P …). */
  lines: PostJournalLineInput[];
  /** For each planned line, the index of the bill line it came from (null for VAT/A/P lines). */
  lineSources: Array<number | null>;
  /** The bill lines in the order bill-posting planned them. */
  lineItems: Array<{ description: string; amount: string | number }>;
  actorId: string;
}

interface BillLineDbRow {
  id: string;
  description: string;
  amount: string;
  quantity: string | null;
  product_id: string | null;
  purchase_order_line_id: string | null;
  cost_center_id: string | null;
}

/** Map planned bill lines to stored rows (same order, verified by description + amount). */
function matchRows(
  items: BillStockPlanInput["lineItems"],
  rows: BillLineDbRow[]
): Array<BillLineDbRow | null> {
  const used = new Set<number>();
  const same = (a: { description: string; amount: unknown }, b: BillLineDbRow) =>
    a.description === b.description && filsOfNumeric(a.amount) === filsOfNumeric(b.amount);
  return items.map((it, k) => {
    if (rows[k] && !used.has(k) && same(it, rows[k])) {
      used.add(k);
      return rows[k];
    }
    const j = rows.findIndex((r, i) => !used.has(i) && same(it, r));
    if (j < 0) return null;
    used.add(j);
    return rows[j];
  });
}

/**
 * Turn the bill's planned expense lines for stock items into inventory (and GRNI) lines and move
 * the stock. Returns the journal lines to post and the movement ids to link. Idempotent per bill
 * revision: a replay returns the plan untouched.
 */
export async function planBillStock(
  tx: LedgerTx,
  input: BillStockPlanInput
): Promise<{ lines: PostJournalLineInput[]; movementIds: string[] }> {
  const { bill } = input;
  const companyId = bill.company_id;
  const revKey = `bill:${bill.id}:r${bill.revision ?? 0}`;
  const rows = await q<BillLineDbRow>(
    tx,
    sql`SELECT id, description, amount::text AS amount, quantity::text AS quantity, product_id,
               purchase_order_line_id, cost_center_id
          FROM bill_line_items WHERE bill_id = ${bill.id} ORDER BY created_at, id`
  );
  const matched = matchRows(input.lineItems, rows);
  const replay =
    rows.some((r) => r.product_id) &&
    (await movementExists(tx, companyId, `${revKey}:${rows.find((r) => r.product_id)!.id}`));
  const label = `Bill ${bill.bill_number || bill.id.slice(0, 8)}`;
  const out: PostJournalLineInput[] = [];
  const movementIds: string[] = [];
  for (let i = 0; i < input.lines.length; i++) {
    const line = { ...input.lines[i] };
    const src = input.lineSources[i];
    const row = src === null || src === undefined ? null : matched[src];
    if (row?.cost_center_id && !line.costCenterId) line.costCenterId = row.cost_center_id;
    const product =
      row?.product_id && !replay ? await productOrNull(tx, companyId, row.product_id) : null;
    if (!row || !product || !isStocked(product) || !line.debitFils) {
      out.push(line);
      continue;
    }
    const qty = wholeQty(row.quantity, { billLineId: row.id });
    const debit = line.debitFils;
    const cc = line.costCenterId ?? null;
    const draft: DraftLine[] = [];
    let stockQty = qty;
    let stockValue = debit;
    let aheadQty = 0;
    if (row.purchase_order_line_id) {
      const g = (
        await q<{
          received_qty: number;
          received_value: string;
          cleared_qty: number;
          cleared_value: string;
        }>(
          tx,
          sql`SELECT received_qty, received_value, cleared_qty, cleared_value FROM inventory_grni
               WHERE purchase_order_line_id = ${row.purchase_order_line_id} AND company_id = ${companyId}
               FOR UPDATE`
        )
      )[0];
      const openQty = g ? Number(g.received_qty) - Number(g.cleared_qty) : 0;
      if (openQty > 0) {
        const k = Math.min(qty, openQty);
        const openValue = filsOfNumeric(g!.received_value) - filsOfNumeric(g!.cleared_value);
        const clearFils = prorate(openValue, k, openQty);
        const lineK = prorate(debit, k, qty);
        const grni = await ensureAccountByCode(tx, companyId, INVENTORY_CODES.GRNI);
        const cogs =
          product.cogs_account_id ??
          (await ensureAccountByCode(tx, companyId, INVENTORY_CODES.COGS));
        draft.push({
          accountId: grni,
          fils: clearFils,
          description: `${label} - clear goods received not invoiced`,
        });
        draft.push({
          accountId: cogs,
          fils: lineK - clearFils,
          costCenterId: cc,
          description: `${label} - purchase price variance`,
        });
        await tx.execute(
          sql`UPDATE inventory_grni SET cleared_qty = cleared_qty + ${k}, cleared_value = cleared_value + ${fromFils(clearFils)}
               WHERE purchase_order_line_id = ${row.purchase_order_line_id}`
        );
        movementIds.push(
          await insertMovement(tx, {
            companyId,
            productId: product.id,
            type: "grni_clear",
            quantity: k,
            totalCostFils: 0,
            date: input.date,
            sourceType: "bill",
            sourceId: bill.id,
            sourceLineId: row.id,
            reference: label,
            idempotencyKey: `${revKey}:${row.id}:grni`,
            meta: { poLineId: row.purchase_order_line_id, clearedFils: clearFils },
            actorId: input.actorId,
          })
        );
        stockQty = qty - k;
        stockValue = debit - lineK;
        aheadQty = stockQty;
      } else {
        aheadQty = qty;
      }
      if (aheadQty > 0) {
        await tx.execute(
          sql`INSERT INTO inventory_grni (purchase_order_line_id, company_id, product_id, billed_ahead_qty)
              VALUES (${row.purchase_order_line_id}, ${companyId}, ${product.id}, ${aheadQty})
              ON CONFLICT (purchase_order_line_id)
              DO UPDATE SET billed_ahead_qty = inventory_grni.billed_ahead_qty + ${aheadQty}`
        );
      }
    }
    if (stockQty > 0) {
      const r = await stockIn(tx, product.id, stockQty, stockValue, {
        companyId,
        actorId: input.actorId,
        date: input.date,
        sourceType: "bill",
        sourceId: bill.id,
        sourceLineId: row.id,
        reference: label,
        idempotencyKey: `${revKey}:${row.id}`,
        meta:
          aheadQty > 0 ? { poLineId: row.purchase_order_line_id, billedAheadQty: aheadQty } : null,
      });
      movementIds.push(r.movementId);
      draft.push({
        accountId: r.accounts.inventory,
        fils: stockValue,
        description: `${label} - stock ${product.sku ?? product.name}`,
      });
      draft.push(...trueUpLines(r, stockValue, cc, label));
    }
    out.push(...toKernelLines(draft));
  }
  return { lines: out, movementIds };
}

export async function afterBillPosted(
  tx: LedgerTx,
  movementIds: string[],
  entryId: string
): Promise<void> {
  if (movementIds.length) await linkMovementsToEntry(tx, movementIds, entryId);
}

export async function reverseBillStock(
  tx: LedgerTx,
  bill: { id: string; company_id: string; bill_number?: string | null },
  actorId: string
) {
  return reverseDocumentStock(tx, {
    companyId: bill.company_id,
    sourceType: "bill",
    sourceId: bill.id,
    actorId,
    label: `Bill ${bill.bill_number || bill.id.slice(0, 8)}`,
  });
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export interface SalesDocLike {
  id: string;
  companyId: string;
  number: string;
  date: Date | string;
  invoiceType?: string | null;
  originalInvoiceId?: string | null;
}
export interface SalesLineLike {
  id: string;
  productId?: string | null;
  quantity: number;
  costCenterId?: string | null;
  description?: string;
}

/** Components of a bundle (empty for a plain product). */
async function bundleComponents(
  tx: LedgerTx,
  companyId: string,
  bundleId: string
): Promise<Array<{ productId: string; quantity: number }>> {
  const rows = await q<{ component_product_id: string; quantity: number }>(
    tx,
    sql`SELECT component_product_id, quantity FROM product_components
         WHERE company_id = ${companyId} AND bundle_product_id = ${bundleId} ORDER BY id`
  );
  return rows.map((r) => ({ productId: r.component_product_id, quantity: Number(r.quantity) }));
}

/** invoice issue: stock out and post COGS in the invoice's transaction. */
export async function onInvoiceIssued(
  tx: LedgerTx,
  args: {
    invoice: SalesDocLike;
    lines: SalesLineLike[];
    userId: string;
    afterCommit?: MoveContext["afterCommit"];
  }
): Promise<{ entryId: string | null; costFils: number }> {
  const { invoice } = args;
  if (invoice.invoiceType === "credit_note" || invoice.invoiceType === "debit_note") {
    return { entryId: null, costFils: 0 };
  }
  const existing = await documentMovements(tx, invoice.companyId, "invoice", invoice.id);
  if (existing.length) return { entryId: null, costFils: 0 };
  const date = isoDate(invoice.date);
  const draft: DraftLine[] = [];
  const movementIds: string[] = [];
  let costFils = 0;
  for (const line of args.lines) {
    const p = await productOrNull(tx, invoice.companyId, line.productId);
    if (!p) continue;
    const parts =
      p.product_type === "bundle"
        ? await bundleComponents(tx, invoice.companyId, p.id)
        : isStocked(p)
          ? [{ productId: p.id, quantity: 1 }]
          : [];
    if (!parts.length) continue;
    const qty = wholeQty(line.quantity, { invoiceLineId: line.id });
    for (const part of parts) {
      const r = await stockOut(tx, part.productId, qty * part.quantity, {
        companyId: invoice.companyId,
        actorId: args.userId,
        date,
        sourceType: "invoice",
        sourceId: invoice.id,
        sourceLineId: line.id,
        reference: `Invoice ${invoice.number}`,
        idempotencyKey: `invoice:${invoice.id}:${line.id}:${part.productId}`,
        meta: p.product_type === "bundle" ? { bundleProductId: p.id } : null,
        afterCommit: args.afterCommit,
      });
      movementIds.push(r.movementId);
      costFils += r.costFils;
      draft.push({
        accountId: r.accounts.cogs,
        fils: r.costFils,
        costCenterId: line.costCenterId ?? null,
        description: `COGS - Invoice ${invoice.number} - ${r.product.sku ?? r.product.name}`,
      });
      draft.push({
        accountId: r.accounts.inventory,
        fils: -r.costFils,
        description: `Stock out - Invoice ${invoice.number}`,
      });
    }
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: invoice.companyId,
    date,
    memo: `Cost of goods sold - Invoice ${invoice.number}`,
    source: "invoice_cogs",
    sourceId: invoice.id,
    idempotencyKey: `invoice:${invoice.id}:cogs`,
    lines: draft,
    actorId: args.userId,
  });
  if (entryId) await linkMovementsToEntry(tx, movementIds, entryId);
  return { entryId, costFils };
}

/** invoice void: mirror the COGS entry and put the stock back. */
export async function onInvoiceVoided(
  tx: LedgerTx,
  args: {
    companyId: string;
    invoiceId: string;
    number?: string | null;
    userId: string;
    reason?: string;
  }
): Promise<void> {
  await reverseBySource(
    args.companyId,
    "invoice_cogs",
    args.invoiceId,
    { void: true, reason: args.reason ?? "Invoice voided" },
    { actorId: args.userId, tx }
  );
  await reverseDocumentStock(tx, {
    companyId: args.companyId,
    sourceType: "invoice",
    sourceId: args.invoiceId,
    actorId: args.userId,
    label: `Invoice ${args.number ?? args.invoiceId.slice(0, 8)}`,
  });
}

/** credit note issue: restock product lines at the original sale's unit cost. */
export async function onCreditNoteIssued(
  tx: LedgerTx,
  args: {
    original: SalesDocLike;
    creditNote: SalesDocLike;
    lines: SalesLineLike[];
    userId: string;
    /** S1: false = the goods are written off (not returned): no stock in, COGS stays. */
    restock?: boolean;
  }
): Promise<{ entryId: string | null }> {
  const { original, creditNote } = args;
  if (args.restock === false) return { entryId: null };
  const existing = await documentMovements(tx, creditNote.companyId, "credit_note", creditNote.id);
  if (existing.length) return { entryId: null };
  const date = isoDate(creditNote.date);
  const draft: DraftLine[] = [];
  const movementIds: string[] = [];
  for (const line of args.lines) {
    if (!line.productId) continue;
    const p = await productOrNull(tx, creditNote.companyId, line.productId);
    if (!p) continue;
    const parts =
      p.product_type === "bundle"
        ? await bundleComponents(tx, creditNote.companyId, p.id)
        : isStocked(p)
          ? [{ productId: p.id, quantity: 1 }]
          : [];
    const qty = wholeQty(line.quantity, { creditNoteLineId: line.id });
    for (const part of parts) {
      const sold = (
        await q<{ qty: string; cost: string }>(
          tx,
          sql`SELECT COALESCE(SUM(quantity), 0)::text AS qty, COALESCE(SUM(-total_cost), 0)::text AS cost
                FROM inventory_movements
               WHERE company_id = ${creditNote.companyId} AND source_type = 'invoice'
                 AND source_id = ${original.id} AND product_id = ${part.productId} AND type = 'sale'
                 AND reversed_by_movement_id IS NULL`
        )
      )[0];
      const returned = (
        await q<{ qty: string }>(
          tx,
          sql`SELECT COALESCE(SUM(m.quantity), 0)::text AS qty
                FROM inventory_movements m
               WHERE m.company_id = ${creditNote.companyId} AND m.source_type = 'credit_note'
                 AND m.product_id = ${part.productId} AND m.reversed_by_movement_id IS NULL
                 AND m.reverses_movement_id IS NULL
                 AND m.meta ->> 'originalInvoiceId' = ${original.id}`
        )
      )[0];
      const soldQty = Number(sold?.qty ?? 0);
      const returnable = soldQty - Number(returned?.qty ?? 0);
      const want = qty * part.quantity;
      const back = Math.min(want, returnable);
      if (back <= 0 || soldQty <= 0) continue;
      const value = prorate(toFils(sold.cost, { rounding: "halfUp" }), back, soldQty);
      const r = await stockIn(
        tx,
        part.productId,
        back,
        value,
        {
          companyId: creditNote.companyId,
          actorId: args.userId,
          date,
          sourceType: "credit_note",
          sourceId: creditNote.id,
          sourceLineId: line.id,
          reference: `Credit note ${creditNote.number}`,
          idempotencyKey: `credit_note:${creditNote.id}:${line.id}:${part.productId}`,
          meta: { originalInvoiceId: original.id },
        },
        "return"
      );
      movementIds.push(r.movementId);
      draft.push({
        accountId: r.accounts.inventory,
        fils: value,
        description: `Restock - ${creditNote.number}`,
      });
      draft.push({
        accountId: r.accounts.cogs,
        fils: -value,
        costCenterId: line.costCenterId ?? null,
        description: `Reverse COGS - ${creditNote.number}`,
      });
      draft.push(...trueUpLines(r, value, line.costCenterId, `Credit note ${creditNote.number}`));
    }
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: creditNote.companyId,
    date,
    memo: `Stock returned - Credit note ${creditNote.number}`,
    source: "credit_note_cogs",
    sourceId: creditNote.id,
    idempotencyKey: `credit_note:${creditNote.id}:cogs`,
    lines: draft,
    actorId: args.userId,
  });
  if (entryId) await linkMovementsToEntry(tx, movementIds, entryId);
  return { entryId };
}

export async function onCreditNoteVoided(
  tx: LedgerTx,
  args: { companyId: string; creditNoteId: string; number?: string | null; userId: string }
): Promise<void> {
  await reverseBySource(
    args.companyId,
    "credit_note_cogs",
    args.creditNoteId,
    { void: true, reason: "Credit note voided" },
    { actorId: args.userId, tx }
  );
  await reverseDocumentStock(tx, {
    companyId: args.companyId,
    sourceType: "credit_note",
    sourceId: args.creditNoteId,
    actorId: args.userId,
    label: `Credit note ${args.number ?? args.creditNoteId.slice(0, 8)}`,
  });
}

// ─── Purchase-order goods receipts ──────────────────────────────────────────

export interface GoodsReceivedEvent {
  companyId: string;
  purchaseOrderId: string;
  receiptId: string;
  receivedDate: string;
  actorId?: string | null;
  lines: Array<{ lineId: string; productId: string | null; quantity: number; unitPrice: unknown }>;
}

/** inventory.onGoodsReceived — stock in at the PO price against GRNI. Idempotent per receipt line. */
export async function onGoodsReceived(
  event: GoodsReceivedEvent
): Promise<{ entryId: string | null }> {
  const po = (
    await withLedgerTx((tx) =>
      q<{ currency: string; number: string; created_by: string | null }>(
        tx,
        sql`SELECT currency, number, created_by FROM purchase_orders
             WHERE id = ${event.purchaseOrderId} AND company_id = ${event.companyId}`
      )
    )
  )[0];
  if (!po) throw new DomainError("PO_NOT_FOUND", 404);
  const currency = (po.currency || "AED").toUpperCase();
  const actorId = event.actorId ?? po.created_by;
  if (!actorId) throw new DomainError("ACTOR_REQUIRED", 422);
  return withLedgerTx(async (tx, { afterCommit }) => {
    const draft: DraftLine[] = [];
    const movementIds: string[] = [];
    const date = isoDate(event.receivedDate);
    const label = `PO ${po.number} receipt`;
    for (const l of event.lines) {
      if (!l.productId) continue;
      const key = `po_receipt:${event.receiptId}:${l.lineId}`;
      if (await movementExists(tx, event.companyId, key)) continue;
      const p = await productOrNull(tx, event.companyId, l.productId);
      if (!p || !isStocked(p)) continue;
      const qty = wholeQty(l.quantity, { purchaseOrderLineId: l.lineId });
      const g = (
        await q<{ billed_ahead_qty: number }>(
          tx,
          sql`INSERT INTO inventory_grni (purchase_order_line_id, company_id, product_id)
              VALUES (${l.lineId}, ${event.companyId}, ${p.id})
              ON CONFLICT (purchase_order_line_id) DO UPDATE SET product_id = EXCLUDED.product_id
              RETURNING billed_ahead_qty`
        )
      )[0];
      const ahead = Math.min(qty, Number(g?.billed_ahead_qty ?? 0));
      const stockQty = qty - ahead;
      if (ahead > 0) {
        await tx.execute(
          sql`UPDATE inventory_grni SET billed_ahead_qty = billed_ahead_qty - ${ahead}
               WHERE purchase_order_line_id = ${l.lineId}`
        );
      }
      if (stockQty <= 0) continue;
      const unitDoc = toFils(String(l.unitPrice ?? 0), { rounding: "halfUp" });
      let valueFils = mulRate(unitDoc, stockQty);
      if (currency !== "AED" && valueFils > 0) {
        const convert =
          resolve<
            (
              c: string,
              a: number,
              f: string,
              t: string,
              d?: string
            ) => Promise<{ convertedFils: number }>
          >("fx.convert");
        valueFils = (await convert(event.companyId, valueFils, currency, "AED", date))
          .convertedFils;
      }
      const r = await stockIn(tx, p.id, stockQty, valueFils, {
        companyId: event.companyId,
        actorId,
        date,
        sourceType: "po_receipt",
        sourceId: event.receiptId,
        sourceLineId: l.lineId,
        reference: label,
        idempotencyKey: key,
        meta: { purchaseOrderId: event.purchaseOrderId },
        afterCommit,
      });
      movementIds.push(r.movementId);
      await tx.execute(
        sql`UPDATE inventory_grni SET received_qty = received_qty + ${stockQty},
                   received_value = received_value + ${fromFils(valueFils)}
             WHERE purchase_order_line_id = ${l.lineId}`
      );
      const grni = await ensureAccountByCode(tx, event.companyId, INVENTORY_CODES.GRNI);
      draft.push({
        accountId: r.accounts.inventory,
        fils: valueFils,
        description: `${label} - stock in`,
      });
      draft.push({
        accountId: grni,
        fils: -valueFils,
        description: `${label} - goods received not invoiced`,
      });
      draft.push(...trueUpLines(r, valueFils, null, label));
    }
    const entryId = await postInventoryJournal(tx, {
      companyId: event.companyId,
      date,
      memo: `Goods received - PO ${po.number}`,
      source: "po_receipt",
      sourceId: event.receiptId,
      idempotencyKey: `po_receipt:${event.receiptId}`,
      lines: draft,
      actorId,
    });
    if (entryId) await linkMovementsToEntry(tx, movementIds, entryId);
    log.info({ receiptId: event.receiptId, entryId }, "PO goods received into stock");
    return { entryId };
  });
}

export const hasFx = () => has("fx.convert");

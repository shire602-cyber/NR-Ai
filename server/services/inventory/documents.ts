/**
 * Document hooks (W4-B: R10-01, R10-02, R10-15). Each runs on the document's own ledger
 * transaction, so stock and the inventory / COGS journal commit atomically with the document.
 *
 *   bill approval        product lines: Dr Inventory instead of expense, stock in at cost.
 *                        PO-linked lines first clear Goods Received Not Invoiced (2015);
 *                        the price difference is capitalised into inventory for received
 *                        units still on hand and goes to COGS for the sold part (IAS 2.10).
 *   bill void / revise   stock taken back at its own value (true-up to COGS when it changed).
 *   invoice issue        product lines: stock out at cost, Dr COGS / Cr Inventory ('invoice_cogs').
 *   invoice void         COGS entry mirrored, stock put back at the cost it left at.
 *   credit note issue    product lines restocked at the original sale's unit cost
 *                        ('credit_note_cogs': Dr Inventory / Cr COGS); void mirrors it.
 *   PO goods received    stock in at the PO price, Dr Inventory / Cr GRNI (own transaction:
 *                        the purchase-order module calls it after its commit).
 */
import { todayDubai } from "@shared/accounting-date";
import { journalLine, journalMemo } from "@shared/journal-memo";
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
  revalueStock,
  reverseMovement,
  stockIn,
  stockOut,
  toKernelLines,
  trueUpLines,
  docLabel,
  type DocRef,
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
  loadState,
  lockProduct,
  lockProductsOrdered,
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
const todayIso = () => todayDubai();

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
const reversalDoc = (d: DocRef): DocRef => ({
  docKind:
    d.docKind === "bill"
      ? "reversalBill"
      : d.docKind === "invoice"
        ? "reversalInvoice"
        : "reversalCreditNote",
  ref: d.ref,
});

export async function reverseDocumentStock(
  tx: LedgerTx,
  args: {
    companyId: string;
    sourceType: string;
    sourceId: string;
    actorId: string;
    doc: DocRef & { docKind: "bill" | "invoice" | "creditNote" };
  }
): Promise<{ reversed: number; adjustmentEntryId: string | null }> {
  const movements = await documentMovements(tx, args.companyId, args.sourceType, args.sourceId);
  if (!movements.length) return { reversed: 0, adjustmentEntryId: null };
  const date = todayIso();
  const lines: DraftLine[] = [];
  let firstReversal: string | null = null;
  await lockProductsOrdered(
    tx,
    args.companyId,
    movements.map((m) => m.product_id)
  );
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
    // S2 (W4-B residual): a PO line billed before receipt. The bill stocked the units and left
    // them "billed ahead"; a goods receipt since then consumed that and booked nothing. Voiding
    // the bill must therefore not take received goods out of stock: those units stay on hand,
    // re-booked as goods received not invoiced (Dr Inventory / Cr GRNI) at the bill's cost.
    // Units still billed ahead (not yet received) leave stock with the bill.
    let receivedSinceBill = 0;
    if (meta.billedAheadQty && meta.poLineId) {
      const ahead = Number(meta.billedAheadQty);
      const g = (
        await q<{ billed_ahead_qty: number }>(
          tx,
          sql`SELECT billed_ahead_qty FROM inventory_grni
               WHERE purchase_order_line_id = ${String(meta.poLineId)} FOR UPDATE`
        )
      )[0];
      const stillAhead = Math.min(ahead, Math.max(0, Number(g?.billed_ahead_qty ?? 0)));
      receivedSinceBill = ahead - stillAhead;
      await tx.execute(
        sql`UPDATE inventory_grni SET billed_ahead_qty = billed_ahead_qty - ${stillAhead}
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
      reference: `Reversal - ${docLabel(args.doc)}`,
    };
    const r = await reverseMovement(tx, m, ctx);
    firstReversal ??= r.movementId;
    const mirrored = -filsOfNumeric(m.total_cost);
    lines.push(...trueUpLines(r, mirrored, null, reversalDoc(args.doc)));
    if (receivedSinceBill > 0) {
      const movedQty = Math.abs(Number(m.quantity));
      const valueFils = prorate(filsOfNumeric(m.total_cost), receivedSinceBill, movedQty || 1);
      const restored = await stockIn(tx, m.product_id, receivedSinceBill, Math.max(0, valueFils), {
        ...ctx,
        // Not the bill's own movement: a later reversal of the bill must not take it back.
        sourceType: "po_grni_restore",
        sourceId: String(meta.poLineId),
        sourceLineId: m.source_line_id,
        reference: `Goods received, ${docLabel(args.doc)} voided`,
        idempotencyKey: `grni_restore:${m.id}`,
        meta: { poLineId: meta.poLineId, restoredFromMovementId: m.id },
      });
      await tx.execute(
        sql`UPDATE inventory_grni SET received_qty = received_qty + ${receivedSinceBill},
                   received_value = received_value + ${fromFils(Math.max(0, valueFils))}
             WHERE purchase_order_line_id = ${String(meta.poLineId)}`
      );
      const grni = await ensureAccountByCode(tx, args.companyId, INVENTORY_CODES.GRNI);
      lines.push({
        accountId: restored.accounts.inventory,
        controlLeg: "inventory",
        fils: Math.max(0, valueFils),
        ...journalLine("docVoidedKept", args.doc),
      });
      lines.push({
        accountId: grni,
        controlLeg: "grni",
        fils: -Math.max(0, valueFils),
        ...journalLine("docVoidedGrni", args.doc),
      });
      lines.push(...trueUpLines(restored, Math.max(0, valueFils), null, args.doc));
    }
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: args.companyId,
    date,
    ...journalMemo("inventoryReversalAdjustment", { ref: docLabel(args.doc) }),
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
  const doc: DocRef = { docKind: "bill", ref: bill.bill_number || bill.id.slice(0, 8) };
  const label = docLabel(doc);
  const out: PostJournalLineInput[] = [];
  const movementIds: string[] = [];
  if (!replay) {
    await lockProductsOrdered(
      tx,
      companyId,
      rows.map((r) => r.product_id)
    );
  }
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
          controlLeg: "grni",
          fils: clearFils,
          ...journalLine("docClearGrni", doc),
        });
        // A2 (H2, IAS 2.10-11): the invoiced price is the cost of purchase. The difference to
        // the receipt value is capitalised for the received units still on hand and expensed
        // to COGS only for the part already sold.
        const variance = lineK - clearFils;
        let capitalised = 0;
        if (variance !== 0) {
          const state = await loadState(tx, product);
          const onHand = Math.min(k, Math.max(0, Number(state.qty)));
          let share = onHand > 0 ? prorate(variance, onHand, k) : 0;
          if (share < 0 && state.valueFils + share < 0) share = -Math.max(0, state.valueFils);
          if (share !== 0) {
            const r = await revalueStock(
              tx,
              product.id,
              share,
              {
                companyId,
                actorId: input.actorId,
                date: input.date,
                sourceType: "bill",
                sourceId: bill.id,
                sourceLineId: row.id,
                reference: `${label} - purchase price variance`,
                idempotencyKey: `${revKey}:${row.id}:ppv`,
                meta: { poLineId: row.purchase_order_line_id, ppv: true, onHandQty: onHand },
              },
              "cost_adjustment"
            );
            movementIds.push(r.movementId);
            capitalised = r.stockDeltaFils;
            draft.push({
              accountId: r.accounts.inventory,
              controlLeg: "inventory",
              fils: capitalised,
              ...journalLine("docPpvOnHand", doc),
            });
          }
        }
        draft.push({
          accountId: cogs,
          fils: variance - capitalised,
          costCenterId: cc,
          ...journalLine("docPpvSold", doc),
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
        controlLeg: "inventory",
        fils: stockValue,
        ...journalLine("docStockItem", { ...doc, item: product.sku ?? product.name }),
      });
      draft.push(...trueUpLines(r, stockValue, cc, doc));
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
    doc: { docKind: "bill", ref: bill.bill_number || bill.id.slice(0, 8) },
  });
}

// ─── Purchase returns (vendor debit notes) ─────────────────────────────────

export interface PurchaseReturnLine {
  /** Index of the debit-note line (echoed back in `handled`). */
  index: number;
  productId: string;
  quantity: number;
  /** Net credit of the line in base fils (what the vendor credits for the goods). */
  creditFils: number;
  description: string;
}

/**
 * A2 (M4, IAS 2): goods returned to the vendor leave stock at their carrying cost (the costing
 * method's cost: weighted average or FIFO layers), Cr Inventory. Any difference between the
 * credit the vendor gives and that cost is a purchase price variance to COGS. Runs on the debit
 * note's transaction; returns the credit lines that replace the expense credit of each product
 * line, and the movement ids to link to the debit-note journal.
 */
export async function planPurchaseReturnStock(
  tx: LedgerTx,
  args: {
    companyId: string;
    noteId: string;
    number: string;
    date: string;
    lines: PurchaseReturnLine[];
    actorId: string;
  }
): Promise<{ lines: PostJournalLineInput[]; movementIds: string[]; handled: number[] }> {
  const doc: DocRef = { docKind: "debitNote", ref: args.number };
  const label = docLabel(doc);
  const draft: DraftLine[] = [];
  const movementIds: string[] = [];
  const handled: number[] = [];
  await lockProductsOrdered(
    tx,
    args.companyId,
    args.lines.map((l) => l.productId)
  );
  for (const l of args.lines) {
    const product = await productOrNull(tx, args.companyId, l.productId);
    if (!product || !isStocked(product)) continue;
    const qty = wholeQty(l.quantity, { debitNoteLine: l.index });
    const r = await stockOut(
      tx,
      product.id,
      qty,
      {
        companyId: args.companyId,
        actorId: args.actorId,
        date: args.date,
        sourceType: "vendor_debit_note",
        sourceId: args.noteId,
        reference: label,
        idempotencyKey: `vendor_debit_note:${args.noteId}:${l.index}`,
        meta: { creditFils: l.creditFils },
      },
      "purchase_return"
    );
    movementIds.push(r.movementId);
    handled.push(l.index);
    // stockDeltaFils is negative: the value that left stock.
    draft.push({
      accountId: r.accounts.inventory,
      controlLeg: "inventory",
      fils: r.stockDeltaFils,
      ...journalLine("docReturned", { ...doc, item: product.sku ?? product.name }),
    });
    draft.push({
      accountId: r.accounts.cogs,
      fils: -(l.creditFils + r.stockDeltaFils),
      ...journalLine("docPurchaseReturnDiff", doc),
    });
  }
  return { lines: toKernelLines(draft), movementIds, handled };
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

export type BundleParts = Map<string, Array<{ productId: string; quantity: number }>>;

/**
 * Lock every product a sales document will touch (line products and bundle components) in the
 * common id order, and return the component snapshot the locks were taken from. The movement
 * loops use that same snapshot, so a concurrent bundle edit cannot add an unlocked product.
 */
async function lockSalesProducts(
  tx: LedgerTx,
  companyId: string,
  lines: SalesLineLike[]
): Promise<BundleParts> {
  const ids = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
  const bundles: BundleParts = new Map();
  if (!ids.length) return bundles;
  const rows = await q<{
    bundle_product_id: string;
    component_product_id: string;
    quantity: number;
  }>(
    tx,
    sql`SELECT bundle_product_id, component_product_id, quantity FROM product_components
         WHERE company_id = ${companyId} AND bundle_product_id IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `
         )})
         ORDER BY bundle_product_id, id`
  );
  for (const r of rows) {
    const parts = bundles.get(r.bundle_product_id) ?? [];
    parts.push({ productId: r.component_product_id, quantity: Number(r.quantity) });
    bundles.set(r.bundle_product_id, parts);
  }
  await lockProductsOrdered(tx, companyId, [...ids, ...rows.map((r) => r.component_product_id)]);
  return bundles;
}

/**
 * inventory.lockSalesProducts: the invoice / credit note posting calls this BEFORE it posts its own
 * revenue journal. That journal takes the company/date journal-number lock, and a stocktake holds
 * its product locks while it asks for that same lock, so the products must be locked first (id
 * order) or the two wait on each other (40P01). No product lines: empty snapshot.
 * Returns the locked bundle snapshot; the caller passes it to onInvoiceIssued /
 * onCreditNoteIssued (`bundles`) so they move exactly the products that were locked.
 */
export async function lockSalesDocumentProducts(
  tx: LedgerTx,
  args: { companyId: string; lines: SalesLineLike[] }
): Promise<BundleParts> {
  return lockSalesProducts(tx, args.companyId, args.lines);
}

/**
 * inventory.lockDocumentProducts: same ordering rule for a void, which mirrors the document's
 * journal (journal-number lock) before `reverseDocumentStock` locks the products it moved.
 */
export async function lockDocumentProducts(
  tx: LedgerTx,
  args: {
    companyId: string;
    sourceType: string;
    sourceId: string;
    /** Extra products the caller is about to move (e.g. a bill revision's new lines). */
    productIds?: ReadonlyArray<string | null | undefined>;
  }
): Promise<void> {
  const movements = await documentMovements(tx, args.companyId, args.sourceType, args.sourceId);
  // One query for the union of the document's movement products and the extra ids.
  await lockProductsOrdered(tx, args.companyId, [
    ...movements.map((m) => m.product_id),
    ...(args.productIds ?? []),
  ]);
}

/** invoice issue: stock out and post COGS in the invoice's transaction. */
export async function onInvoiceIssued(
  tx: LedgerTx,
  args: {
    invoice: SalesDocLike;
    lines: SalesLineLike[];
    userId: string;
    afterCommit?: MoveContext["afterCommit"];
    /** Snapshot from lockSalesProducts taken before the journal lock; omitted by direct callers. */
    bundles?: BundleParts;
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
  // Common lock order (product id, bundle components included) before the line-order loop below:
  // a stocktake locks its products in id order, so line order alone could deadlock with it.
  const bundles = args.bundles ?? (await lockSalesProducts(tx, invoice.companyId, args.lines));
  for (const line of args.lines) {
    const p = await productOrNull(tx, invoice.companyId, line.productId);
    if (!p) continue;
    const parts =
      p.product_type === "bundle"
        ? (bundles.get(p.id) ?? [])
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
        ...journalLine("invoiceCogsLine", {
          ref: invoice.number,
          item: r.product.sku ?? r.product.name,
        }),
      });
      draft.push({
        accountId: r.accounts.inventory,
        controlLeg: "inventory",
        fils: -r.costFils,
        ...journalLine("invoiceStockOutLine", { ref: invoice.number }),
      });
    }
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: invoice.companyId,
    date,
    ...journalMemo("cogs", { ref: invoice.number }),
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
    doc: { docKind: "invoice", ref: args.number ?? args.invoiceId.slice(0, 8) },
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
    /** Snapshot from lockSalesProducts taken before the journal lock; omitted by direct callers. */
    bundles?: BundleParts;
  }
): Promise<{ entryId: string | null }> {
  const { original, creditNote } = args;
  if (args.restock === false) return { entryId: null };
  const existing = await documentMovements(tx, creditNote.companyId, "credit_note", creditNote.id);
  if (existing.length) return { entryId: null };
  const date = isoDate(creditNote.date);
  const draft: DraftLine[] = [];
  const movementIds: string[] = [];
  const bundles = args.bundles ?? (await lockSalesProducts(tx, creditNote.companyId, args.lines));
  for (const line of args.lines) {
    if (!line.productId) continue;
    const p = await productOrNull(tx, creditNote.companyId, line.productId);
    if (!p) continue;
    const parts =
      p.product_type === "bundle"
        ? (bundles.get(p.id) ?? [])
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
        controlLeg: "inventory",
        fils: value,
        ...journalLine("creditNoteRestock", { ref: creditNote.number }),
      });
      draft.push({
        accountId: r.accounts.cogs,
        fils: -value,
        costCenterId: line.costCenterId ?? null,
        ...journalLine("creditNoteReverseCogs", { ref: creditNote.number }),
      });
      draft.push(
        ...trueUpLines(r, value, line.costCenterId, {
          docKind: "creditNote",
          ref: creditNote.number,
        })
      );
    }
  }
  const entryId = await postInventoryJournal(tx, {
    companyId: creditNote.companyId,
    date,
    ...journalMemo("stockReturned", { ref: creditNote.number }),
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
    doc: { docKind: "creditNote", ref: args.number ?? args.creditNoteId.slice(0, 8) },
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

/**
 * inventory.onGoodsReceived — stock in at the PO price against GRNI. Idempotent per receipt line.
 * Pass the receipt's transaction as `outer` (F2): stock, GRNI and the journal then commit or roll
 * back together with the receipt itself.
 */
export async function onGoodsReceived(
  event: GoodsReceivedEvent,
  outer?: LedgerTx
): Promise<{ entryId: string | null }> {
  const po = (
    await withLedgerTx(
      (tx) =>
        q<{ currency: string; number: string; created_by: string | null }>(
          tx,
          sql`SELECT currency, number, created_by FROM purchase_orders
               WHERE id = ${event.purchaseOrderId} AND company_id = ${event.companyId}`
        ),
      outer
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
    // Id order before the line loop (see lockProductsOrdered), as stocktakes lock.
    await lockProductsOrdered(
      tx,
      event.companyId,
      event.lines.map((l) => l.productId)
    );
    const doc: DocRef = { docKind: "poReceipt", ref: po.number };
    const label = docLabel(doc);
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
        controlLeg: "inventory",
        fils: valueFils,
        ...journalLine("docStockIn", doc),
      });
      draft.push({
        accountId: grni,
        controlLeg: "grni",
        fils: -valueFils,
        ...journalLine("docGrni", doc),
      });
      draft.push(...trueUpLines(r, valueFils, null, doc));
    }
    const entryId = await postInventoryJournal(tx, {
      companyId: event.companyId,
      date,
      ...journalMemo("goodsReceived", { ref: po.number }),
      source: "po_receipt",
      sourceId: event.receiptId,
      idempotencyKey: `po_receipt:${event.receiptId}`,
      lines: draft,
      actorId,
    });
    if (entryId) await linkMovementsToEntry(tx, movementIds, entryId);
    log.info({ receiptId: event.receiptId, entryId }, "PO goods received into stock");
    return { entryId };
  }, outer);
}

export const hasFx = () => has("fx.convert");

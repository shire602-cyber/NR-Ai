// Weighted-average inventory costing and cost-of-goods-sold (COGS) posting.
//
// Costing: every product with `track_inventory` carries a running weighted-average unit cost
// (`average_cost`, 6 dp). Stock coming IN with a unit cost (purchase, a positive adjustment, a
// return) re-averages it:  new = (stock * avg + qty * cost) / (stock + qty).  Stock going OUT
// (sale, a negative adjustment) is consumed at the current average and does not change it.
//
// COGS posting: when an invoice is ISSUED and the company has `inventory_costing_enabled`, each
// line that names a tracked product consumes stock at its average cost and one balanced journal
// is posted on the invoice date:   Dr 5200 Cost of Goods Sold / Cr 1070 Inventory.
// The journal has the system source `inventory_cogs`, so it is read-only in the journal screens
// (journal-entry-protection.ts). Voiding the invoice, or a credit note with `restock: true`,
// returns the stock at the cost it left at and reverses the COGS (in full, or for the returned
// quantities). A credit note WITHOUT `restock: true` has no stock effect: the goods are not
// assumed to be back on the shelf.
//
// Ledger tie-out: with the company setting on, account 1070 always equals the sum of the tracked
// products' `inventory_value` (value in at cost, out at the average, the last unit out takes the
// remainder). Every stock movement posts the exact amount it moves:
//   purchase        Dr 1070 / Cr 2015 Goods Received Not Invoiced (clear it by coding the vendor bill to 2015)
//   adjustment in   Dr 1070 / Cr 5210 Inventory Adjustments       adjustment out  Dr 5210 / Cr 1070
//   manual sale     Dr 5200 / Cr 1070 at average                  manual return   Dr 1070 / Cr 5200 at average
//   invoice issue   Dr 5200 / Cr 1070 (as above, per invoice)
// Switching the setting on (or tracking a product that already holds stock) posts the opening stock:
// Dr 1070 / Cr Opening Balance Equity, source `inventory_opening`.
//
// Everything here runs inside a transaction the caller owns (document lock + posted-month lock
// are taken by the callers / storage.createJournalEntry), so the stock check, the movements, the
// stock update and the journal commit or roll back together.

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "../db";
import {
  accounts,
  companies,
  inventoryMovements,
  invoiceLines,
  journalEntries,
  products,
} from "../../shared/schema";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { AppError } from "../errors";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { createLogger } from "../config/logger";
import { uaeCalendarDate } from "../utils/date";
import { ensureOpeningBalanceEquity } from "./opening-balance.service";

const log = createLogger("inventory-costing");

type Tx = typeof db;

/** `source` of the system journals this service posts. */
export const COGS_SOURCE = "inventory_cogs";
/** Journals of manual stock movements (purchase, adjustment, manual sale / return). */
export const MOVEMENT_SOURCE = "inventory_movement";
/** Opening stock when costing is switched on (or a product that holds stock starts being tracked). */
export const OPENING_SOURCE = "inventory_opening";


// Pure math lives in inventory-costing-math.ts (no I/O, unit-tested); re-exported here.
export * from "./inventory-costing-math";
import {
  addStock,
  aggregateDemand,
  buildCogsJournalLines,
  buildCogsPlan,
  movementJournalLegs,
  planRestock,
  removeStock,
  restockAmounts,
  stockValueAtAverage,
  valueOfUnits,
  valueOut,
  weightedAverageCost,
  type CostedProduct,
  type OutstandingStock,
  type StockState,
} from "./inventory-costing-math";

// ---------------------------------------------------------------------------
// Account resolution (5200 is created on demand for charts that predate it)
// ---------------------------------------------------------------------------

async function findAccount(tx: Tx, companyId: string, code: string, type: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code), eq(accounts.type, type)));
  return row ?? null;
}

/**
 * A system account of the default chart, created from the template for a chart that predates it
 * (5200 COGS, 5210 Inventory Adjustments, 2015 Goods Received Not Invoiced).
 */
export async function ensureSystemAccount(tx: Tx, companyId: string, code: string, type: string): Promise<{ id: string }> {
  const existing = await findAccount(tx, companyId, code, type);
  if (existing) return existing;
  const template = defaultChartOfAccounts.find((a) => a.code === code);
  if (!template) throw new Error(`Default chart is missing the template for account ${code}`);
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code: template.code,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      description: template.description,
      type: template.type,
      subType: template.subType,
      isVatAccount: template.isVatAccount,
      vatType: template.vatType,
      isSystemAccount: template.isSystemAccount,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: accounts.id });
  return created;
}

/** Cost of Goods Sold (5200): created from the default template for a chart that lacks it. */
export const ensureCogsAccount = (tx: Tx, companyId: string) => ensureSystemAccount(tx, companyId, ACCOUNT_CODES.COGS, "expense");

async function resolveLedgerAccounts(tx: Tx, companyId: string) {
  const cogs = await ensureCogsAccount(tx, companyId);
  const inventory = await findAccount(tx, companyId, ACCOUNT_CODES.INVENTORY, "asset");
  if (!inventory) {
    throw new AppError({
      message: "Cannot post cost of goods sold: the Inventory account (1070) is missing from the chart of accounts.",
      statusCode: 422,
      code: "CHART_OF_ACCOUNTS_MISSING",
    });
  }
  return { cogsAccountId: cogs.id, inventoryAccountId: inventory.id };
}

export type ProductCheck = { ok: true } | { ok: false; status: 400; code: "INVALID_PRODUCT"; message: string };

/**
 * Tenant check of the products named on document lines: every productId must be a product of THIS
 * company. Without it a line naming another company's product would be saved and then silently
 * ignored by COGS (lockProducts is company-scoped), so the sale would post no cost.
 */
export async function checkProductsForCompany(
  companyId: string,
  ids: Array<string | null | undefined>
): Promise<ProductCheck> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return { ok: true };
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, wanted)));
  const found = new Set(rows.map((r: { id: string }) => r.id));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    status: 400,
    code: "INVALID_PRODUCT",
    message: "One or more invoice lines name a product that does not exist in this company.",
  };
}

// ---------------------------------------------------------------------------
// Stock primitives
// ---------------------------------------------------------------------------

/** Lock the product rows (stable order, so concurrent invoices cannot deadlock) and read them. */
async function lockProducts(tx: Tx, companyId: string, productIds: string[]): Promise<Map<string, CostedProduct>> {
  const map = new Map<string, CostedProduct>();
  if (productIds.length === 0) return map;
  const sorted = [...productIds].sort();
  await tx.execute(
    sql`SELECT id FROM products WHERE company_id = ${companyId} AND id IN (${sql.join(sorted.map((id) => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`
  );
  const rows = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, sorted)));
  for (const p of rows) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      trackInventory: p.trackInventory,
      currentStock: p.currentStock,
      averageCost: Number(p.averageCost) || 0,
      inventoryValue: Number(p.inventoryValue) || 0,
    });
  }
  return map;
}

export type MovementType = "purchase" | "sale" | "adjustment" | "return";

export type MovementOutcome =
  | { ok: true; movementId: string; newStock: number; averageCost: number; inventoryValue: number }
  | { ok: false; onHand: number; requested: number };

/** Post a balanced two-leg journal of an inventory source, dated `date`, inside the caller's transaction. */
async function postInventoryJournal(
  tx: Tx,
  args: {
    companyId: string;
    userId: string;
    date: Date;
    memo: string;
    source: string;
    sourceId: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    label: string;
  }
) {
  return storage.createJournalEntry(
    {
      companyId: args.companyId,
      date: args.date,
      memo: args.memo,
      entryNumber: "PENDING", // assigned inside the transaction
      status: "posted",
      source: args.source,
      sourceId: args.sourceId,
      createdBy: args.userId,
      postedBy: args.userId,
      postedAt: args.date,
    } as any,
    [
      { accountId: args.debitAccountId, debit: args.amount, credit: 0, description: args.label },
      { accountId: args.creditAccountId, debit: 0, credit: args.amount, description: args.label },
    ] as any,
    { tx }
  );
}

/** Account ids by code for the legs of a stock movement journal (5200 / 5210 / 2015 created on demand). */
async function movementAccounts(tx: Tx, companyId: string) {
  const inventory = await findAccount(tx, companyId, ACCOUNT_CODES.INVENTORY, "asset");
  if (!inventory) {
    throw new AppError({
      message: "Cannot post the stock movement: the Inventory account (1070) is missing from the chart of accounts.",
      statusCode: 422,
      code: "CHART_OF_ACCOUNTS_MISSING",
    });
  }
  const cogs = await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.COGS, "expense");
  const adjustments = await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.INVENTORY_ADJUSTMENTS, "expense");
  const grni = await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.GRNI, "liability");
  return new Map<string, string>([
    [ACCOUNT_CODES.INVENTORY, inventory.id],
    [ACCOUNT_CODES.COGS, cogs.id],
    [ACCOUNT_CODES.INVENTORY_ADJUSTMENTS, adjustments.id],
    [ACCOUNT_CODES.GRNI, grni.id],
  ]);
}

/**
 * Apply one manual movement to a product inside `tx` (row lock + stock check + costing + ledger).
 * Direction is carried by `type` (adjustment is signed). Inbound value is qty x unit cost (the
 * average when none is given; a manual return always comes back at the average); outbound value
 * leaves at the average, the last unit taking the remainder. When the company posts inventory to
 * the ledger and the product is tracked, the exact amount is journalled (see the file header).
 */
export async function applyMovementInTx(
  tx: Tx,
  input: {
    productId: string;
    companyId: string;
    type: MovementType;
    quantity: number;
    unitCost?: string | number | null;
    reference?: string | null;
    notes?: string | null;
    sourceInvoiceId?: string | null;
    userId?: string;
  }
): Promise<MovementOutcome & { productFound: boolean }> {
  const locked = await lockProducts(tx, input.companyId, [input.productId]);
  const product = locked.get(input.productId);
  if (!product) return { ok: false, onHand: 0, requested: 0, productFound: false };

  const stockChange =
    input.type === "sale"
      ? -Math.abs(input.quantity)
      : input.type === "adjustment"
        ? input.quantity
        : Math.abs(input.quantity);
  const newStock = product.currentStock + stockChange;
  if (newStock < 0 && input.type !== "adjustment") {
    return { ok: false, onHand: product.currentStock, requested: Math.abs(stockChange), productFound: true };
  }

  const inbound = stockChange > 0;
  const qty = Math.abs(stockChange);
  const suppliedCost = input.unitCost === null || input.unitCost === undefined || input.unitCost === "" ? null : Number(input.unitCost);
  const hasCost = suppliedCost !== null && Number.isFinite(suppliedCost) && suppliedCost >= 0;
  const before: StockState = {
    stock: product.currentStock,
    value: product.inventoryValue ?? 0,
    averageCost: product.averageCost,
  };

  let after: StockState;
  let amount = 0;
  let recordedCost: number | null = hasCost ? suppliedCost : null;
  if (!product.trackInventory) {
    // Untracked: stock count only (the cost still follows purchases), nothing on the ledger.
    const averageCost =
      inbound && hasCost
        ? weightedAverageCost({ stock: product.currentStock, averageCost: product.averageCost, qty: stockChange, unitCost: suppliedCost! })
        : product.averageCost;
    after = { stock: newStock, value: before.value, averageCost };
    if (!inbound) recordedCost = product.averageCost;
  } else if (inbound) {
    // A manual return always comes back at the average (that is what the sale took out).
    const unit = input.type === "return" && product.averageCost > 0 ? product.averageCost : hasCost ? suppliedCost! : product.averageCost;
    amount = valueOfUnits(qty, unit);
    after = addStock(before, qty, amount);
    recordedCost = unit;
  } else {
    amount = valueOut(before, qty);
    after = removeStock(before, qty, amount);
    recordedCost = product.averageCost; // consumed at the average
  }

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      productId: input.productId,
      companyId: input.companyId,
      type: input.type,
      quantity: input.quantity,
      unitCost: recordedCost,
      totalCost: product.trackInventory ? amount : valueOfUnits(qty, recordedCost ?? 0),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
    })
    .returning({ id: inventoryMovements.id });
  await tx
    .update(products)
    .set({ currentStock: newStock, averageCost: after.averageCost, inventoryValue: after.value })
    .where(eq(products.id, input.productId));

  if (product.trackInventory && amount > 0 && input.userId && (await isCostingEnabled(tx, input.companyId))) {
    const ids = await movementAccounts(tx, input.companyId);
    const legs = movementJournalLegs(input.type, inbound);
    const label = `${product.name} (${input.type}${input.reference ? `, ${input.reference}` : ""})`;
    await postInventoryJournal(tx, {
      companyId: input.companyId,
      userId: input.userId,
      date: uaeCalendarDate(),
      memo: `Inventory ${input.type} - ${product.name}`,
      source: MOVEMENT_SOURCE,
      sourceId: movement.id,
      debitAccountId: ids.get(legs.debitCode)!,
      creditAccountId: ids.get(legs.creditCode)!,
      amount,
      label,
    });
  }
  return { ok: true, movementId: movement.id, newStock, averageCost: after.averageCost, inventoryValue: after.value, productFound: true };
}

// ---------------------------------------------------------------------------
// Opening stock: bring the ledger in line when costing is switched on / a product starts being tracked
// ---------------------------------------------------------------------------

/**
 * Make account 1070 (as far as the inventory journals go) equal the sum of the tracked products'
 * stock values. First switch-on: Dr 1070 / Cr Opening Balance Equity for the stock on hand.
 * Afterwards only the difference (stock moved while the setting was off, a product untracked, a
 * stock figure edited by hand): up Dr 1070 / Cr Opening Balance Equity, down Dr 5210 / Cr 1070.
 * Dated today, source `inventory_opening`, same period lock as any journal. Caller checks the setting.
 */
export async function postInventoryOpeningInTx(
  tx: Tx,
  companyId: string,
  userId: string
): Promise<{ amount: number; journalEntryId: string | null }> {
  const inventory = await findAccount(tx, companyId, ACCOUNT_CODES.INVENTORY, "asset");
  if (!inventory) return { amount: 0, journalEntryId: null };
  const valueRes: any = await tx.execute(
    sql`SELECT COALESCE(SUM(inventory_value), 0) AS total FROM products WHERE company_id = ${companyId} AND track_inventory = true`
  );
  const wanted = new Decimal((valueRes.rows ?? valueRes)[0]?.total ?? 0);
  const ledgerRes: any = await tx.execute(sql`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.company_id = ${companyId} AND je.status = 'posted' AND jl.account_id = ${inventory.id}
       AND je.source IN (${COGS_SOURCE}, ${MOVEMENT_SOURCE}, ${OPENING_SOURCE})`);
  const posted = new Decimal((ledgerRes.rows ?? ledgerRes)[0]?.net ?? 0);
  const delta = wanted.minus(posted).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (delta.isZero()) return { amount: 0, journalEntryId: null };

  const amount = delta.abs().toNumber();
  const counter = delta.gt(0)
    ? await ensureOpeningBalanceEquity(tx, companyId)
    : await ensureSystemAccount(tx, companyId, ACCOUNT_CODES.INVENTORY_ADJUSTMENTS, "expense");
  const entry = await postInventoryJournal(tx, {
    companyId,
    userId,
    date: uaeCalendarDate(),
    memo: delta.gt(0) ? "Opening inventory (stock on hand at average cost)" : "Inventory write-down to stock value",
    source: OPENING_SOURCE,
    sourceId: companyId,
    debitAccountId: delta.gt(0) ? inventory.id : counter.id,
    creditAccountId: delta.gt(0) ? counter.id : inventory.id,
    amount,
    label: delta.gt(0) ? "Opening inventory" : "Inventory write-down",
  });
  log.info({ companyId, amount: delta.toNumber() }, "Inventory opening journal posted");
  return { amount: delta.toNumber(), journalEntryId: entry.id };
}

/** Re-derive a product's value from stock x average after its stock was edited outside a movement (0 once untracked). */
export async function resetProductValueInTx(tx: Tx, companyId: string, productId: string): Promise<void> {
  const locked = await lockProducts(tx, companyId, [productId]);
  const p = locked.get(productId);
  if (!p) return;
  const value = p.trackInventory ? stockValueAtAverage(p.currentStock, p.averageCost) : 0;
  await tx.update(products).set({ inventoryValue: value }).where(eq(products.id, productId));
}

// ---------------------------------------------------------------------------
// Invoice issue: stock + COGS journal
// ---------------------------------------------------------------------------

interface InvoiceRef {
  id: string;
  companyId: string;
  number: string;
  date: string | Date;
  invoiceType?: string | null;
  isOpeningBalance?: boolean | null;
}

export async function isCostingEnabled(tx: Tx, companyId: string): Promise<boolean> {
  const [c] = await tx
    .select({ enabled: companies.inventoryCostingEnabled })
    .from(companies)
    .where(eq(companies.id, companyId));
  return !!c?.enabled;
}

async function findCogsOriginal(tx: Tx, companyId: string, invoiceId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.source, COGS_SOURCE),
        eq(journalEntries.sourceId, invoiceId),
        isNull(journalEntries.reversedEntryId)
      )
    );
  return entry ?? null;
}

async function invoiceMovements(tx: Tx, companyId: string, invoiceId: string) {
  return tx
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.companyId, companyId), eq(inventoryMovements.sourceInvoiceId, invoiceId)));
}

const stateOf = (p: CostedProduct): StockState => ({
  stock: p.currentStock,
  value: p.inventoryValue ?? stockValueAtAverage(p.currentStock, p.averageCost),
  averageCost: p.averageCost,
});

export interface IssueCogsResult {
  /** True when this call consumed stock (false: setting off, nothing tracked, or already done). */
  consumed: boolean;
  journalEntryId: string | null;
}

/**
 * Consume stock and post COGS for an invoice being issued. Idempotent (a second call finds the
 * sale movements and does nothing). Throws AppError 422 INSUFFICIENT_STOCK before writing anything.
 * Must run inside the caller's transaction.
 */
export async function postCogsForInvoiceInTx(tx: Tx, invoice: InvoiceRef, userId: string): Promise<IssueCogsResult> {
  const none: IssueCogsResult = { consumed: false, journalEntryId: null };
  if (invoice.invoiceType === "credit_note" || invoice.isOpeningBalance) return none;
  if (!(await isCostingEnabled(tx, invoice.companyId))) return none;

  const lines = await tx
    .select({ productId: invoiceLines.productId, quantity: invoiceLines.quantity })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoice.id), isNotNull(invoiceLines.productId)));
  const demand = aggregateDemand(lines);
  if (demand.size === 0) return none;

  const already = (await invoiceMovements(tx, invoice.companyId, invoice.id)).some((m: { type: string }) => m.type === "sale");
  if (already) return none;

  const locked = await lockProducts(tx, invoice.companyId, [...demand.keys()]);
  const plan = buildCogsPlan(demand, locked);
  if (!plan.ok) {
    throw new AppError({ message: plan.message, statusCode: 422, code: plan.code, details: plan.details });
  }
  if (plan.items.length === 0) return none;

  for (const item of plan.items) {
    await tx.insert(inventoryMovements).values({
      productId: item.productId,
      companyId: invoice.companyId,
      type: "sale",
      quantity: item.quantity,
      unitCost: item.unitCost,
      totalCost: item.amount,
      reference: `Invoice ${invoice.number}`,
      sourceInvoiceId: invoice.id,
    });
    const product = locked.get(item.productId)!;
    const after = removeStock(stateOf(product), item.quantity, item.amount);
    await tx
      .update(products)
      .set({ currentStock: after.stock, averageCost: after.averageCost, inventoryValue: after.value })
      .where(eq(products.id, item.productId));
  }

  let journalEntryId: string | null = null;
  if (plan.total > 0) {
    const ledger = await resolveLedgerAccounts(tx, invoice.companyId);
    const date = invoice.date instanceof Date ? invoice.date : new Date(invoice.date);
    const entry = await storage.createJournalEntry(
      {
        companyId: invoice.companyId,
        date,
        memo: `Cost of goods sold - Invoice ${invoice.number}`,
        entryNumber: "PENDING", // assigned inside the transaction
        status: "posted",
        source: COGS_SOURCE,
        sourceId: invoice.id,
        createdBy: userId,
        postedBy: userId,
        postedAt: date,
      } as any,
      buildCogsJournalLines({
        amount: plan.total,
        cogsAccountId: ledger.cogsAccountId,
        inventoryAccountId: ledger.inventoryAccountId,
        label: `Invoice ${invoice.number}`,
      }) as any,
      { tx }
    );
    journalEntryId = entry.id;
  }
  log.info({ invoiceId: invoice.id, items: plan.items.length, total: plan.total }, "Stock consumed and COGS posted");
  return { consumed: true, journalEntryId };
}

/** Issue-path entry point: its own locked transaction (same lock the revenue posting uses). */
export async function postCogsForInvoice(invoice: InvoiceRef, userId: string): Promise<IssueCogsResult> {
  return withDocumentLock(invoice.id, LOCK_NS.INVOICE_POSTING, (tx) => postCogsForInvoiceInTx(tx, invoice, userId));
}

// ---------------------------------------------------------------------------
// Returning stock: void and restocking credit notes
// ---------------------------------------------------------------------------

/**
 * Bring stock back for an invoice and reverse its COGS. `requested = null` returns everything still
 * outstanding (void, full credit note); a map returns those quantities (partial restocking credit
 * note). Idempotent by construction: it only returns what the invoice's movements say is still out.
 * Must run inside the caller's transaction (which holds the invoice's document lock).
 */
export async function restockInvoiceInTx(
  tx: Tx,
  args: {
    invoice: InvoiceRef;
    userId: string;
    requested: Map<string, number> | null;
    reversalDate: Date;
    postedAt: Date;
    /** Source document of the reversal journal: the invoice (void) or the credit note. */
    source: { id: string; label: string };
    reason: string;
    /** Tag stored on the 'return' movements so the restock can be found again (credit note void). */
    movementNotes?: string;
  }
): Promise<{ restocked: number; reversalEntryId: string | null }> {
  const { invoice, userId, requested, reversalDate, postedAt, source, reason, movementNotes } = args;
  const movements = await invoiceMovements(tx, invoice.companyId, invoice.id);
  const sold = new Map<string, { quantity: number; unitCost: number; value: number }>();
  const returned = new Map<string, { quantity: number; value: number }>();
  const worth = (m: { quantity: number; unitCost: unknown; totalCost?: unknown }) =>
    m.totalCost !== null && m.totalCost !== undefined ? Number(m.totalCost) : valueOfUnits(m.quantity, Number(m.unitCost) || 0);
  for (const m of movements) {
    if (m.type === "sale") {
      const prev = sold.get(m.productId);
      sold.set(m.productId, {
        quantity: (prev?.quantity ?? 0) + m.quantity,
        unitCost: Number(m.unitCost) || 0,
        value: (prev?.value ?? 0) + worth(m),
      });
    } else if (m.type === "return") {
      const prev = returned.get(m.productId);
      returned.set(m.productId, { quantity: (prev?.quantity ?? 0) + m.quantity, value: (prev?.value ?? 0) + worth(m) });
    }
  }
  const outstanding: OutstandingStock[] = [...sold].map(([productId, s]) => ({
    productId,
    quantity: s.quantity - (returned.get(productId)?.quantity ?? 0),
    unitCost: s.unitCost,
    value: Math.max(0, new Decimal(s.value).minus(returned.get(productId)?.value ?? 0).toNumber()),
  }));
  const items = planRestock(outstanding, requested);
  if (items.length === 0) return { restocked: 0, reversalEntryId: null };
  const amounts = restockAmounts(items, outstanding);

  const locked = await lockProducts(tx, invoice.companyId, items.map((i) => i.productId));
  let total = new Decimal(0);
  for (const item of items) {
    const product = locked.get(item.productId);
    if (!product) continue; // product deleted since: movement rows are gone with it
    const amount = amounts.get(item.productId) ?? 0;
    await tx.insert(inventoryMovements).values({
      productId: item.productId,
      companyId: invoice.companyId,
      type: "return",
      quantity: item.quantity,
      unitCost: item.unitCost,
      totalCost: amount,
      reference: `${reason} ${invoice.number}`,
      notes: movementNotes ?? null,
      sourceInvoiceId: invoice.id,
    });
    const after = addStock(stateOf(product), item.quantity, amount);
    await tx
      .update(products)
      .set({ currentStock: after.stock, averageCost: after.averageCost, inventoryValue: after.value })
      .where(eq(products.id, item.productId));
    total = total.plus(amount);
  }

  const amount = total.toNumber();
  if (!(amount > 0)) return { restocked: items.length, reversalEntryId: null }; // zero-cost sale: nothing on the ledger
  const original = await findCogsOriginal(tx, invoice.companyId, invoice.id);
  const ledger = await resolveLedgerAccounts(tx, invoice.companyId);

  const entry = await storage.createJournalEntry(
    {
      companyId: invoice.companyId,
      date: reversalDate,
      memo: `Cost of goods sold reversal - ${source.label}`,
      entryNumber: "PENDING",
      status: "posted",
      source: COGS_SOURCE,
      sourceId: source.id,
      reversedEntryId: original?.id ?? null,
      reversalReason: reason,
      createdBy: userId,
      postedBy: userId,
      postedAt,
    } as any,
    buildCogsJournalLines({
      amount,
      cogsAccountId: ledger.cogsAccountId,
      inventoryAccountId: ledger.inventoryAccountId,
      label: source.label,
      reverse: true,
    }) as any,
    { tx }
  );
  log.info({ invoiceId: invoice.id, amount, items: items.length }, "Stock returned and COGS reversed");
  return { restocked: items.length, reversalEntryId: entry.id };
}

/** Void / cancel: everything still out comes back, COGS reverses in full. */
export function restockForVoidInTx(
  tx: Tx,
  args: { invoice: InvoiceRef; userId: string; reversalDate: Date; postedAt: Date; targetStatus: string }
) {
  return restockInvoiceInTx(tx, {
    invoice: args.invoice,
    userId: args.userId,
    requested: null,
    reversalDate: args.reversalDate,
    postedAt: args.postedAt,
    source: { id: args.invoice.id, label: `Void Invoice ${args.invoice.number}` },
    reason: `Invoice ${args.targetStatus}`,
  });
}


// ---------------------------------------------------------------------------
// Voiding a restocking credit note: take the returned stock back out
// ---------------------------------------------------------------------------

/** Tag stored in `inventory_movements.notes` on the 'return' rows a restocking credit note creates. */
export const creditNoteRestockTag = (creditNoteId: string) => `credit_note:${creditNoteId}`;

/**
 * Undo the restock of a credit note that is being voided. Follows the service's own convention:
 * stock leaves as 'sale' movements (at the cost the 'return' brought it in at, so they net out in
 * the invoice's movement history), and a Dr 5200 / Cr 1070 journal, dated `reversalDate`, reverses
 * the credit note's COGS reversal. Refuses with 409 STOCK_ALREADY_CONSUMED, before writing anything,
 * when the returned units have been sold again (stock would go negative). No-op when the credit
 * note restocked nothing. Must run inside the void transaction (it holds the document locks).
 */
export async function undoCreditNoteRestockInTx(
  tx: Tx,
  args: {
    creditNote: { id: string; number: string; companyId: string; originalInvoiceId: string | null };
    userId: string;
    reversalDate: Date;
    postedAt: Date;
  }
): Promise<{ undone: number; reversalEntryId: string | null }> {
  const { creditNote, userId, reversalDate, postedAt } = args;
  const none = { undone: 0, reversalEntryId: null };
  if (!creditNote.originalInvoiceId) return none;

  const returns = await tx
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.companyId, creditNote.companyId),
        eq(inventoryMovements.sourceInvoiceId, creditNote.originalInvoiceId),
        eq(inventoryMovements.type, "return"),
        eq(inventoryMovements.notes, creditNoteRestockTag(creditNote.id))
      )
    );
  if (returns.length === 0) return none;

  const back = new Map<string, { quantity: number; unitCost: number; value: number }>();
  for (const m of returns) {
    const prev = back.get(m.productId);
    back.set(m.productId, {
      quantity: (prev?.quantity ?? 0) + m.quantity,
      unitCost: Number(m.unitCost) || 0,
      value:
        (prev?.value ?? 0) +
        (m.totalCost !== null && m.totalCost !== undefined ? Number(m.totalCost) : valueOfUnits(m.quantity, Number(m.unitCost) || 0)),
    });
  }

  const locked = await lockProducts(tx, creditNote.companyId, [...back.keys()]);
  const short: Array<Record<string, unknown>> = [];
  for (const [productId, b] of back) {
    const product = locked.get(productId);
    if (product && product.currentStock < b.quantity) {
      short.push({ productId, name: product.name, onHand: product.currentStock, required: b.quantity });
    }
  }
  if (short.length > 0) {
    throw new AppError({
      message: `Cannot void credit note ${creditNote.number}: the restocked units have since been sold again (${short
        .map((s) => `${s.name}: ${s.onHand} on hand, ${s.required} to take back`)
        .join("; ")}).`,
      statusCode: 409,
      code: "STOCK_ALREADY_CONSUMED",
      details: short,
    });
  }

  let undone = 0;
  let undoneValue = new Decimal(0);
  for (const [productId, b] of back) {
    const product = locked.get(productId);
    if (!product) continue; // product deleted since: its movement rows are gone with it
    await tx.insert(inventoryMovements).values({
      productId,
      companyId: creditNote.companyId,
      type: "sale",
      quantity: b.quantity,
      unitCost: b.unitCost,
      totalCost: b.value,
      reference: `Void credit note ${creditNote.number}`,
      notes: `void_${creditNoteRestockTag(creditNote.id)}`,
      sourceInvoiceId: creditNote.originalInvoiceId,
    });
    const after = removeStock(stateOf(product), b.quantity, b.value);
    await tx
      .update(products)
      .set({ currentStock: after.stock, averageCost: after.averageCost, inventoryValue: after.value })
      .where(eq(products.id, productId));
    undone += 1;
    undoneValue = undoneValue.plus(b.value);
  }

  const original = await findCogsOriginal(tx, creditNote.companyId, creditNote.originalInvoiceId);
  if (!original) return { undone, reversalEntryId: null };
  const [reversal] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, creditNote.companyId),
        eq(journalEntries.source, COGS_SOURCE),
        eq(journalEntries.sourceId, creditNote.id),
        eq(journalEntries.reversedEntryId, original.id),
        eq(journalEntries.status, "posted")
      )
    );
  if (!reversal) return { undone, reversalEntryId: null }; // zero-cost restock: nothing on the ledger

  const ledger = await resolveLedgerAccounts(tx, creditNote.companyId);
  const amount = undoneValue.toNumber();
  if (!(amount > 0)) return { undone, reversalEntryId: null };

  const entry = await storage.createJournalEntry(
    {
      companyId: creditNote.companyId,
      date: reversalDate,
      memo: `Cost of goods sold - void of Credit Note ${creditNote.number} restock`,
      entryNumber: "PENDING",
      status: "posted",
      source: COGS_SOURCE,
      sourceId: creditNote.id,
      reversedEntryId: reversal.id,
      reversalReason: "Credit note void",
      createdBy: userId,
      postedBy: userId,
      postedAt,
    } as any,
    buildCogsJournalLines({
      amount,
      cogsAccountId: ledger.cogsAccountId,
      inventoryAccountId: ledger.inventoryAccountId,
      label: `Void Credit Note ${creditNote.number}`,
    }) as any,
    { tx }
  );
  log.info({ creditNoteId: creditNote.id, amount, items: undone }, "Credit note restock undone");
  return { undone, reversalEntryId: entry.id };
}

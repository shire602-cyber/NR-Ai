// Persists the sales line model (Phase 8 D1): item and shipping lines from the client, plus the signed lines
// the server derives from them (line and document discounts, advance deductions). See shared/sales-line-math.ts.
//
// One entry point per document table. Every caller (invoice create/update, apply or remove an advance, quote
// create/update, quote -> invoice, sales-order invoicing, recurring, late fee) goes through the same derivation,
// so the stored lines, the totals and the VAT engines can never disagree.

import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  customerAdvanceApplications,
  customerAdvances,
  customerContacts,
  invoiceLines,
  invoices,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
} from "../../shared/schema";
import {
  deriveSalesLines,
  type AdvanceDeduction,
  type DeriveError,
  type DerivedSales,
  type DiscountType,
  type SalesLineInput,
} from "../../shared/sales-line-math";
import { ACCOUNT_CODES } from "../constants";
import { ensureSystemAccount } from "./inventory-costing.service";
import { AppError } from "../errors";

type Tx = typeof db;

export type SalesLineSource = SalesLineInput & {
  revenueAccountId?: string | null;
  productId?: string | null;
  priceListId?: string | null;
  salesOrderLineId?: string | null;
};

export interface SalesAccountIds {
  discount: string;
  shipping: string;
  advance: string;
}

/** The system accounts the derived lines post to, created from the default chart when a company lacks them. */
export async function resolveSalesAccounts(tx: Tx, companyId: string): Promise<SalesAccountIds> {
  const ensure = async (code: string, type: string) => {
    try {
      return (await ensureSystemAccount(tx, companyId, code, type)).id;
    } catch (err: any) {
      // Two requests creating the same account at once: the unique (company, code) index refuses the second.
      if (err?.code === "23505" || err?.cause?.code === "23505") {
        return (await ensureSystemAccount(tx, companyId, code, type)).id;
      }
      throw err;
    }
  };
  return {
    discount: await ensure(ACCOUNT_CODES.DISCOUNTS_GIVEN, "income"),
    shipping: await ensure(ACCOUNT_CODES.SHIPPING_INCOME, "income"),
    advance: await ensure(ACCOUNT_CODES.CUSTOMER_ADVANCES, "liability"),
  };
}

export function deriveError(res: DeriveError): AppError {
  return new AppError({ message: res.message, statusCode: 422, code: res.code });
}

/** The active advance applications of an invoice, as deductions (with the text for the line). */
export async function loadAdvanceDeductions(tx: Tx, companyId: string, invoiceId: string): Promise<AdvanceDeduction[]> {
  const rows = await tx
    .select({
      applicationId: customerAdvanceApplications.id,
      net: customerAdvanceApplications.netAmount,
      advanceId: customerAdvances.id,
      number: customerAdvances.number,
      vatRate: customerAdvances.vatRate,
      vatSupplyType: customerAdvances.vatSupplyType,
      advanceInvoiceNumber: invoices.number,
    })
    .from(customerAdvanceApplications)
    .innerJoin(customerAdvances, eq(customerAdvances.id, customerAdvanceApplications.advanceId))
    .innerJoin(invoices, eq(invoices.id, customerAdvances.invoiceId))
    .where(
      and(
        eq(customerAdvanceApplications.companyId, companyId),
        eq(customerAdvanceApplications.invoiceId, invoiceId),
        eq(customerAdvanceApplications.kind, "application"),
        eq(customerAdvanceApplications.status, "active")
      )
    )
    .orderBy(asc(customerAdvanceApplications.createdAt));
  return rows.map((r: any) => ({
    advanceId: r.advanceId,
    applicationId: r.applicationId,
    description: `Less advance ${r.number} (${r.advanceInvoiceNumber})`,
    net: Number(r.net),
    vatRate: Number(r.vatRate),
    vatSupplyType: r.vatSupplyType,
  }));
}

/** The ledger account a derived line posts to: discounts 4050, advances 2055, shipping 4035 unless the client chose one. */
export function accountIdForDerived(
  d: { lineKind: string },
  source: { revenueAccountId?: string | null } | undefined,
  accounts: SalesAccountIds
): string | null {
  const own = source?.revenueAccountId ?? null;
  if (d.lineKind === "discount") return accounts.discount;
  if (d.lineKind === "advance") return accounts.advance;
  if (d.lineKind === "shipping") return own ?? accounts.shipping;
  return own;
}

function lineRow(
  d: ReturnType<typeof pickDerived>,
  source: SalesLineSource | undefined,
  accounts: SalesAccountIds,
  id: string,
  parentId: string | null,
  sortOrder: number
) {
  const revenueAccountId = accountIdForDerived(d, source, accounts);
  return {
    id,
    description: d.description,
    quantity: d.quantity,
    unitPrice: d.unitPrice,
    vatRate: d.vatRate,
    vatSupplyType: d.vatSupplyType,
    revenueAccountId,
    productId: d.lineKind === "item" ? (source?.productId ?? null) : null,
    lineKind: d.lineKind,
    parentLineId: parentId,
    discountType: d.discountType ?? null,
    discountValue: d.discountValue ?? null,
    sortOrder,
  };
}
const pickDerived = (d: DerivedSales["lines"][number]) => d;

export interface WrittenLines {
  derived: DerivedSales;
  /** Stored line id per derived line, same order. */
  lineIds: string[];
}

/** Derive and (re)write the lines of an INVOICE and its totals. Existing lines are replaced. */
export async function replaceInvoiceLines(
  tx: Tx,
  args: {
    companyId: string;
    invoiceId: string;
    lines: SalesLineSource[];
    discountType?: DiscountType | null;
    discountValue?: number | null;
    exchangeRate?: number;
    /** Extra columns written on every item line (e.g. price list id, sales order line id). */
    itemExtras?: (source: SalesLineSource, index: number) => Record<string, unknown>;
  }
): Promise<WrittenLines> {
  const advances = await loadAdvanceDeductions(tx, args.companyId, args.invoiceId);
  const derived = deriveSalesLines({
    lines: args.lines,
    discountType: args.discountType,
    discountValue: args.discountValue,
    advances,
  });
  if (!derived.ok) throw deriveError(derived);
  const accounts = await resolveSalesAccounts(tx, args.companyId);

  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, args.invoiceId));
  const ids = derived.lines.map(() => randomUUID());
  for (let i = 0; i < derived.lines.length; i++) {
    const d = derived.lines[i];
    const source = d.sourceIndex !== undefined ? args.lines[d.sourceIndex] : undefined;
    const base = lineRow(d, source, accounts, ids[i], d.parentIndex !== undefined ? ids[d.parentIndex] : null, i);
    const extras = source && args.itemExtras ? args.itemExtras(source, d.sourceIndex!) : {};
    await tx.insert(invoiceLines).values({
      ...base,
      ...extras,
      invoiceId: args.invoiceId,
      customerAdvanceId: d.customerAdvanceId ?? null,
    } as any);
  }
  // The application remembers which line it became.
  for (let i = 0; i < derived.lines.length; i++) {
    const d = derived.lines[i];
    if (d.applicationId) {
      await tx
        .update(customerAdvanceApplications)
        .set({ invoiceLineId: ids[i] })
        .where(eq(customerAdvanceApplications.id, d.applicationId));
    }
  }

  const rate = args.exchangeRate && args.exchangeRate > 0 ? args.exchangeRate : undefined;
  await tx
    .update(invoices)
    .set({
      subtotal: derived.subtotal,
      vatAmount: derived.vatAmount,
      total: derived.total,
      discountType: args.discountType ?? null,
      discountValue: args.discountType ? (args.discountValue ?? null) : null,
      discountAmount: derived.discountAmount,
      shippingAmount: derived.shippingAmount,
      ...(rate ? { baseCurrencyAmount: Math.round(derived.total * rate * 100) / 100 } : {}),
    } as any)
    .where(and(eq(invoices.id, args.invoiceId), eq(invoices.companyId, args.companyId)));
  return { derived, lineIds: ids };
}

/** Derive and (re)write the lines of a QUOTE and its totals. */
export async function replaceQuoteLines(
  tx: Tx,
  args: {
    companyId: string;
    quoteId: string;
    lines: SalesLineSource[];
    discountType?: DiscountType | null;
    discountValue?: number | null;
  }
): Promise<WrittenLines> {
  const derived = deriveSalesLines({
    lines: args.lines,
    discountType: args.discountType,
    discountValue: args.discountValue,
  });
  if (!derived.ok) throw deriveError(derived);
  const accounts = await resolveSalesAccounts(tx, args.companyId);

  await tx.delete(quoteLines).where(eq(quoteLines.quoteId, args.quoteId));
  const ids = derived.lines.map(() => randomUUID());
  for (let i = 0; i < derived.lines.length; i++) {
    const d = derived.lines[i];
    const source = d.sourceIndex !== undefined ? args.lines[d.sourceIndex] : undefined;
    const base = lineRow(d, source, accounts, ids[i], d.parentIndex !== undefined ? ids[d.parentIndex] : null, i);
    const { productId, ...rest } = base;
    await tx.insert(quoteLines).values({ ...rest, productId, quoteId: args.quoteId } as any);
  }
  await tx
    .update(quotes)
    .set({
      subtotal: derived.subtotal,
      vatAmount: derived.vatAmount,
      total: derived.total,
      discountType: args.discountType ?? null,
      discountValue: args.discountType ? (args.discountValue ?? null) : null,
      discountAmount: derived.discountAmount,
      shippingAmount: derived.shippingAmount,
      updatedAt: new Date(),
    } as any)
    .where(and(eq(quotes.id, args.quoteId), eq(quotes.companyId, args.companyId)));
  return { derived, lineIds: ids };
}

/**
 * The client-editable lines of a stored document (items and shipping), as input for a rebuild: the derived
 * lines (discounts, advances) are dropped and regenerated from the stored discount inputs.
 */
export function editableLinesOf(rows: Array<Record<string, any>>): SalesLineSource[] {
  return rows
    .filter((r) => r.lineKind === "item" || r.lineKind === "shipping")
    .map((r) => ({
      kind: r.lineKind as "item" | "shipping",
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice),
      vatRate: Number(r.vatRate),
      vatSupplyType: r.vatSupplyType,
      discountType: r.discountType ?? null,
      discountValue: r.discountValue === null || r.discountValue === undefined ? null : Number(r.discountValue),
      revenueAccountId: r.revenueAccountId ?? null,
      productId: r.productId ?? null,
      priceListId: r.priceListId ?? null,
      salesOrderLineId: r.salesOrderLineId ?? null,
    }));
}

/** Stored lines of an invoice in document order. */
export async function loadInvoiceLineRows(tx: Tx, invoiceId: string) {
  return await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.id));
}

export async function advanceNumbersByIds(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return await tx.select().from(customerAdvances).where(inArray(customerAdvances.id, ids));
}

export type ContactCheck = { ok: true } | { ok: false; code: "CONTACT_NOT_FOUND"; message: string };

/** A contact id from a request must belong to the company (null/undefined = none, which is fine). */
export async function checkContactForCompany(companyId: string, contactId: unknown): Promise<ContactCheck> {
  if (contactId === undefined || contactId === null || contactId === "") return { ok: true };
  if (typeof contactId !== "string" || !/^[0-9a-f-]{36}$/i.test(contactId)) {
    return { ok: false, code: "CONTACT_NOT_FOUND", message: "contactId is not a contact of this company" };
  }
  const [row] = await db
    .select({ id: customerContacts.id })
    .from(customerContacts)
    .where(and(eq(customerContacts.id, contactId), eq(customerContacts.companyId, companyId)));
  return row ? { ok: true } : { ok: false, code: "CONTACT_NOT_FOUND", message: "contactId is not a contact of this company" };
}

/** Items net after line and document discounts (shipping and advance deductions left out), 2dp. */
export function itemsSubtotalOf(lines: Array<{ lineKind?: string | null; quantity: number | string; unitPrice: number | string }>): number {
  let sum = 0;
  for (const l of lines) {
    if (l.lineKind === "item" || l.lineKind === "discount" || !l.lineKind) sum += Number(l.quantity) * Number(l.unitPrice);
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

/** Derive and (re)write the lines of a SALES ORDER and its totals (percent discounts only, see the sales-order service). */
export async function replaceSalesOrderLines(
  tx: Tx,
  args: {
    companyId: string;
    salesOrderId: string;
    lines: SalesLineSource[];
    discountType?: DiscountType | null;
    discountValue?: number | null;
  }
): Promise<WrittenLines> {
  const derived = deriveSalesLines({
    lines: args.lines,
    discountType: args.discountType,
    discountValue: args.discountValue,
  });
  if (!derived.ok) throw deriveError(derived);
  const accounts = await resolveSalesAccounts(tx, args.companyId);

  await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, args.salesOrderId));
  const ids = derived.lines.map(() => randomUUID());
  for (let i = 0; i < derived.lines.length; i++) {
    const d = derived.lines[i];
    const source = d.sourceIndex !== undefined ? args.lines[d.sourceIndex] : undefined;
    const base = lineRow(d, source, accounts, ids[i], d.parentIndex !== undefined ? ids[d.parentIndex] : null, i);
    await tx.insert(salesOrderLines).values({ ...base, priceListId: source?.priceListId ?? null, salesOrderId: args.salesOrderId } as any);
  }
  await tx
    .update(salesOrders)
    .set({
      subtotal: derived.subtotal,
      vatAmount: derived.vatAmount,
      total: derived.total,
      discountType: args.discountType ?? null,
      discountValue: args.discountType ? (args.discountValue ?? null) : null,
      discountAmount: derived.discountAmount,
      shippingAmount: derived.shippingAmount,
      updatedAt: new Date(),
    } as any)
    .where(and(eq(salesOrders.id, args.salesOrderId), eq(salesOrders.companyId, args.companyId)));
  return { derived, lineIds: ids };
}

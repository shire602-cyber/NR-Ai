/**
 * Partial credit notes: which lines of an invoice can still be credited, how much is left, and the request the server takes
 * (`lines` with `originalLineId`, or nothing for the whole remaining balance). Pure, so a unit test can check the arithmetic.
 */
import { round2, salesErrorMessage, type AdvanceApplicationRow } from "@/lib/sales-api";

export { salesErrorMessage };

export interface CreditableLineRow {
  id: string;
  lineKind?: string | null;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
  vatSupplyType?: string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  productId?: string | null;
  revenueAccountId?: string | null;
}

export interface CreditableInvoice {
  id: string;
  number: string;
  /** The invoice date: a credit note cannot be dated before it. */
  date?: string | null;
  currency: string;
  /** AED per unit of the invoice currency (1 for AED). */
  exchangeRate?: number | string | null;
  /** The emirate of supply the credit note inherits (null: the company's emirate). */
  emirate?: string | null;
  total: number | string;
  creditedAmount?: number | string | null;
  lines: CreditableLineRow[];
  advanceApplications?: AdvanceApplicationRow[];
  /** Quantities already credited per original line (when the server reports them). */
  creditedByLine?: Record<string, number>;
}

export interface CreditableLine {
  id: string;
  description: string;
  vatRate: number;
  vatSupplyType: string | null;
  productId: string | null;
  /** Quantity on the invoice that can still be credited. */
  creditableQty: number;
  /** Price per unit after the line's own discount (what the customer actually paid per unit). */
  creditUnitPrice: number;
}

export interface CreditLineChoice {
  line: CreditableLine;
  quantity: number;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** What is still creditable on the invoice, gross: its total less what earlier credit notes took. */
export function remainingCreditable(inv: Pick<CreditableInvoice, "total" | "creditedAmount">): number {
  return Math.max(0, round2(n(inv.total) - n(inv.creditedAmount)));
}

/** Item and shipping lines (derived discount, advance and late-fee lines are not credited line by line). */
export function creditableLines(inv: CreditableInvoice): CreditableLine[] {
  return inv.lines
    .filter((l) => !l.lineKind || l.lineKind === "item" || l.lineKind === "shipping")
    .map((l) => {
      const quantity = n(l.quantity);
      const gross = quantity * n(l.unitPrice);
      const off =
        l.discountType === "percent" ? gross * (Math.min(n(l.discountValue), 100) / 100) : l.discountType === "amount" ? Math.min(n(l.discountValue), gross) : 0;
      const already = inv.creditedByLine?.[l.id] ?? 0;
      return {
        id: l.id,
        description: l.description,
        vatRate: n(l.vatRate),
        vatSupplyType: l.vatSupplyType ?? null,
        productId: l.productId ?? null,
        creditableQty: Math.max(0, round2(quantity - already)),
        creditUnitPrice: quantity > 0 ? Math.round(((gross - off) / quantity) * 1e6) / 1e6 : n(l.unitPrice),
      };
    });
}

/** Net, VAT and gross of the lines picked. */
export function creditSelectionTotals(choices: CreditLineChoice[]): { subtotal: number; vat: number; total: number } {
  let subtotal = 0;
  let vat = 0;
  for (const c of choices) {
    if (!(c.quantity > 0)) continue;
    const net = c.quantity * c.line.creditUnitPrice;
    subtotal += net;
    vat += net * c.line.vatRate;
  }
  const s = round2(subtotal);
  const v = round2(vat);
  return { subtotal: s, vat: v, total: round2(s + v) };
}

/** The request body: the picked lines (each naming its original line), or nothing for the whole remaining balance. */
export function creditNoteBody(args: { mode: "lines" | "whole"; choices: CreditLineChoice[]; date: string; restock: boolean; reason?: string }) {
  const base: Record<string, unknown> = { date: args.date };
  if (args.restock) base.restock = true;
  if (args.reason?.trim()) base.reason = args.reason.trim();
  if (args.mode === "whole") return base;
  const lines = args.choices
    .filter((c) => c.quantity > 0)
    .map((c) => ({
      description: c.line.description,
      quantity: c.quantity,
      unitPrice: c.line.creditUnitPrice,
      vatRate: c.line.vatRate,
      ...(c.line.vatSupplyType && c.line.vatRate === 0 ? { vatSupplyType: c.line.vatSupplyType } : {}),
      originalLineId: c.line.id,
    }));
  return { ...base, lines };
}

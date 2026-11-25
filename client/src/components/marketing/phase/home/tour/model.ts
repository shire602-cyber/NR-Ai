/** Pure logic behind the homepage tour. Money is integer fils; no React, no I/O. */
import { toAsciiDigits } from "@shared/arabic-text";
import { formatFils, mulRate, tryToFils } from "@shared/money";
import {
  BANK_ROWS,
  INVOICE_NUMBER,
  TOUR_TRANSACTIONS,
  type BankRow,
  type TourTransaction,
} from "./sample";

export const VAT_RATE = 0.05;
export const MAX_QTY = 999;
export const MAX_UNIT_FILS = 100_000_000;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Quantity from raw input: whole number, clamped to 0..MAX_QTY, blank/garbage is 0. */
export function parseQty(raw: string): number {
  const n = Math.trunc(Number(toAsciiDigits(raw).trim()));
  return Number.isFinite(n) ? clamp(n, 0, MAX_QTY) : 0;
}

/** Unit price (AED, up to 2 decimals, half-up beyond) to fils, clamped to 0..MAX_UNIT_FILS. */
export function parseUnitFils(raw: string): number {
  const cleaned = toAsciiDigits(raw).trim().replace(/,/g, "");
  const fils = tryToFils(cleaned, { rounding: "halfUp" });
  return fils === null ? 0 : clamp(fils, 0, MAX_UNIT_FILS);
}

export interface InvoiceLineInput {
  qty: number;
  unitFils: number;
}

export interface InvoiceTotals {
  amounts: number[];
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
}

/** qty x unit price per line, VAT 5% on the subtotal rounded half-up to whole fils. */
export function invoiceTotals(lines: readonly InvoiceLineInput[]): InvoiceTotals {
  const amounts = lines.map((l) => l.qty * l.unitFils);
  const subtotalFils = amounts.reduce((a, b) => a + b, 0);
  const vatFils = subtotalFils === 0 ? 0 : mulRate(subtotalFils, VAT_RATE);
  return { amounts, subtotalFils, vatFils, totalFils: subtotalFils + vatFils };
}

/** "1,234.50" with Western digits and no currency (the currency sits in the label). */
export const money = (fils: number) => formatFils(fils, { currency: null });

/** "1234.50": for editable inputs (no grouping, no currency). */
export const moneyPlain = (fils: number) => formatFils(fils, { currency: null, grouping: false });

export interface TourDocument extends TourTransaction {
  vatFils: number;
  totalFils: number;
}

export function withVat(tx: TourTransaction): TourDocument {
  const vatFils = tx.rate === "standard" && tx.netFils > 0 ? mulRate(tx.netFils, VAT_RATE) : 0;
  return { ...tx, vatFils, totalFils: tx.netFils + vatFils };
}

/** The tour ledger with INV-2001 repriced to the sample invoice as the visitor edited it. */
export function transactionsWithInvoice(invoiceNetFils: number): TourTransaction[] {
  return TOUR_TRANSACTIONS.map((t) =>
    t.ref === INVOICE_NUMBER ? { ...t, netFils: invoiceNetFils } : t
  );
}

export interface BoxFigure {
  amountFils: number;
  vatFils: number;
}

export interface Vat201Boxes {
  box1b: BoxFigure;
  box4: BoxFigure;
  box8: BoxFigure;
  box9: BoxFigure;
  box11: BoxFigure;
  box14: BoxFigure;
}

const add = (a: BoxFigure, b: BoxFigure): BoxFigure => ({
  amountFils: a.amountFils + b.amountFils,
  vatFils: a.vatFils + b.vatFils,
});
const ZERO: BoxFigure = { amountFils: 0, vatFils: 0 };

/**
 * VAT 201 boxes from transactions: 1b standard-rated sales, 4 zero-rated sales, 8 their total,
 * 9 standard-rated expenses (recoverable), 11 total expenses, 14 = output VAT less recoverable VAT.
 */
export function vat201Boxes(txs: readonly TourTransaction[] = TOUR_TRANSACTIONS): Vat201Boxes {
  let box1b = ZERO;
  let box4 = ZERO;
  let box9 = ZERO;
  for (const doc of txs.map(withVat)) {
    const fig = { amountFils: doc.netFils, vatFils: doc.vatFils };
    if (doc.kind === "sale") {
      if (doc.rate === "standard") box1b = add(box1b, fig);
      else box4 = add(box4, fig);
    } else if (doc.rate === "standard") {
      box9 = add(box9, fig);
    }
  }
  const box8 = add(box1b, box4);
  const box11 = box9;
  return {
    box1b,
    box4,
    box8,
    box9,
    box11,
    box14: { amountFils: 0, vatFils: box8.vatFils - box11.vatFils },
  };
}

export interface MatchResult {
  rowId: string;
  /** Reference of the invoice or expense the row settles, or null when it needs review. */
  ref: string | null;
  kind: "sale" | "expense" | null;
}

/**
 * Match each bank line to the one document with the same gross amount and direction (money in
 * settles an invoice, money out an expense). A document is used once; no match means review.
 */
export function reconcileBank(
  rows: readonly BankRow[] = BANK_ROWS,
  txs: readonly TourTransaction[] = TOUR_TRANSACTIONS
): MatchResult[] {
  const free = txs.map(withVat);
  return rows.map((row) => {
    const kind = row.amountFils >= 0 ? "sale" : "expense";
    const gross = Math.abs(row.amountFils);
    const at = free.findIndex((d) => d.kind === kind && d.totalFils === gross);
    if (at === -1) return { rowId: row.id, ref: null, kind: null };
    const [doc] = free.splice(at, 1);
    return { rowId: row.id, ref: doc.ref, kind };
  });
}

export interface ClientFigures {
  openInvoices: number;
  openAmountFils: number;
  review: number;
}

/** What the first sample client shows, derived from the tour transactions and the bank result. */
export function pearlFigures(): ClientFigures {
  const settled = new Set(reconcileBank().map((m) => m.ref));
  const open = TOUR_TRANSACTIONS.filter((t) => t.kind === "sale" && !settled.has(t.ref)).map(
    withVat
  );
  return {
    openInvoices: open.length,
    openAmountFils: open.reduce((sum, d) => sum + d.totalFils, 0),
    review: reconcileBank().filter((m) => m.ref === null).length,
  };
}

/** Wrap-around index for the roving tab list; `rtl` mirrors the arrow keys. */
export function nextTabIndex(key: string, current: number, count: number, rtl: boolean) {
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === forward) return (current + 1) % count;
  if (key === backward) return (current + count - 1) % count;
  return null;
}

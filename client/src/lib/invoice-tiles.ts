/**
 * Invoices page status-tile maths. Open and Overdue show the remaining balance owed in base
 * currency (server-computed `openBalanceBase`, the dashboard `outstanding` rule); Draft and
 * Paid show document totals in base currency.
 */
import { invoiceDisplayStatus, type InvoiceListItem } from "@shared/invoice-balance";

export type InvoiceTileKey = "draft" | "open" | "overdue" | "paid";
export interface InvoiceTile {
  key: InvoiceTileKey;
  count: number;
  value: number;
}

const docBase = (inv: InvoiceListItem) => Number(inv.baseCurrencyAmount ?? inv.total ?? 0);
const owedBase = (inv: InvoiceListItem) => Number(inv.openBalanceBase ?? 0);

export function computeInvoiceTiles(all: InvoiceListItem[], today: Date): InvoiceTile[] {
  const live = all.filter((inv) => Number(inv.total) >= 0);
  const draft = live.filter((inv) => inv.status === "draft");
  const open = live.filter(
    (inv) => (inv.status === "sent" || inv.status === "partial") && owedBase(inv) > 0
  );
  const overdue = open.filter((inv) => inv.dueDate && new Date(inv.dueDate) < today);
  // Credited invoices (settled by credit notes, nothing received) are not "paid" revenue cash.
  const paid = live.filter((inv) => invoiceDisplayStatus(inv) === "paid");
  const sum = (rows: InvoiceListItem[], f: (i: InvoiceListItem) => number) =>
    Math.round(rows.reduce((s, i) => s + f(i), 0) * 100) / 100;
  return [
    { key: "draft", count: draft.length, value: sum(draft, docBase) },
    { key: "open", count: open.length, value: sum(open, owedBase) },
    { key: "overdue", count: overdue.length, value: sum(overdue, owedBase) },
    { key: "paid", count: paid.length, value: sum(paid, docBase) },
  ];
}

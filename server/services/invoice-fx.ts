// Foreign-currency context of an invoice, shared by the posting service and by
// the reversals (void / credit note) so all of them convert to AED the same
// way: at the invoice's stored transaction-date rate.

export interface InvoiceFxSource {
  currency?: string | null;
  exchangeRate?: string | number | null;
}

export interface InvoiceFx {
  currency: string;
  /** AED per 1 unit of document currency; 1 when the rate is missing / invalid. */
  rate: number;
  /** True when the ledger amounts differ from the document amounts. */
  isForeign: boolean;
}

export function positiveExchangeRate(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function resolveInvoiceFx(invoice: InvoiceFxSource): InvoiceFx {
  const currency = (invoice.currency || "AED").toUpperCase();
  const rate = positiveExchangeRate(invoice.exchangeRate);
  return { currency, rate, isForeign: currency !== "AED" && rate !== 1 };
}

/** Document-currency amount in AED, rounded to fils. */
export function toBaseCurrencyAmount(docAmount: number, rate: number): number {
  return Math.round(docAmount * rate * 100) / 100;
}

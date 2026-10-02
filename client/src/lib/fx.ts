/** Document currency and the rate to AED: the books are in AED, a foreign document carries the rate it was booked at. */
export const BASE_CURRENCY = "AED";
export const DOCUMENT_CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR", "INR", "PKR", "EGP", "CHF", "JPY", "CNY"] as const;

export interface RateRow {
  fromCurrency: string;
  toCurrency: string;
  rate: number | string;
  effectiveDate: string;
  scope?: "company" | "system";
}

export interface PickedRate {
  /** AED per 1 unit of the document currency. */
  rate: number;
  /** The day the rate was set (YYYY-MM-DD). */
  date: string;
  scope: "company" | "system";
}

const dayOf = (value: string): string => String(value).slice(0, 10);

/**
 * The rate to use for a document dated `ymd`: the latest rate set on or before that day, the company's own before a
 * system rate set the same day; a rate stored the other way round (AED to the currency) is inverted. Null when there is none.
 */
export function pickRate(rows: readonly RateRow[], currency: string, ymd: string): PickedRate | null {
  if (!currency || currency === BASE_CURRENCY) return null;
  let best: (PickedRate & { rank: number }) | null = null;
  for (const row of rows) {
    const direct = row.fromCurrency === currency && row.toCurrency === BASE_CURRENCY;
    const inverse = row.fromCurrency === BASE_CURRENCY && row.toCurrency === currency;
    if (!direct && !inverse) continue;
    const date = dayOf(row.effectiveDate);
    if (!date || date > ymd) continue;
    const raw = Number(row.rate);
    if (!(raw > 0)) continue;
    const rate = direct ? raw : 1 / raw;
    const scope = row.scope === "system" ? "system" : "company";
    // later day wins, then the company's own rate, then a direct pair over an inverted one
    const rank = Number(date.replace(/-/g, "")) * 4 + (scope === "company" ? 2 : 0) + (direct ? 1 : 0);
    if (!best || rank > best.rank) best = { rate, date, scope, rank };
  }
  return best ? { rate: best.rate, date: best.date, scope: best.scope } : null;
}

/** The AED value of an amount in the document currency at a rate, to the fils. */
export function aedEquivalent(amount: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return Math.round(amount * rate * 100) / 100;
}

/** A rate field's text as a usable rate: a positive number, else null. */
export function parseRate(text: string): number | null {
  const n = Number(text.trim().replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What to send for a document: AED needs no rate; a foreign currency needs the typed (or defaulted) rate. */
export function currencyPayload(currency: string, rateText: string): { currency: string; exchangeRate?: number } {
  if (currency === BASE_CURRENCY) return { currency, exchangeRate: 1 };
  const rate = parseRate(rateText);
  return rate ? { currency, exchangeRate: rate } : { currency };
}

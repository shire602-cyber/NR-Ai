/**
 * X5 (J1 D2): currencies a sales document or payment can be in, and the rate field rules.
 * Pure helpers shared by the invoice form and the payment dialogs.
 */

/** Common trade currencies offered even before the company has saved a rate for them. */
export const COMMON_DOCUMENT_CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "INR"] as const;

export interface CompanyRateLike {
  fromCurrency?: string | null;
  toCurrency?: string | null;
}

/** Base currency first, then currencies with a company rate, then the common ones (deduped). */
export function currencyChoices(baseCurrency: string, rates: CompanyRateLike[] = []): string[] {
  const out: string[] = [];
  const add = (c: string | null | undefined) => {
    const code = String(c ?? "")
      .trim()
      .toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && !out.includes(code)) out.push(code);
  };
  add(baseCurrency);
  for (const r of rates) {
    add(r.fromCurrency);
    add(r.toCurrency);
  }
  for (const c of COMMON_DOCUMENT_CURRENCIES) add(c);
  return out;
}

/**
 * The exchange rate to send with a document or payment: null for a base-currency document or a
 * blank field (the server resolves the rate for the date), else the typed positive rate.
 * Returns undefined when the text is not a valid rate (the form shows an error).
 */
export function rateToSend(
  currency: string | null | undefined,
  baseCurrency: string,
  text: string | null | undefined
): string | null | undefined {
  if (!currency || currency === baseCurrency) return null;
  const v = String(text ?? "").trim();
  if (!v) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(v) || !(Number(v) > 0)) return undefined;
  return v;
}

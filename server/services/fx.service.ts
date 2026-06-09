import Decimal from 'decimal.js';

/**
 * Centralised foreign-currency helpers. Lifted from invoices.routes.ts so the
 * receipt-posting, bank-reconciliation, and vendor-bill-payment paths all use
 * the SAME rounding / FX semantics — no one path can drift on rounding rules
 * and produce an unbalanced GL entry.
 *
 * All FX amounts are persisted as numeric(15,2) so rounding here is at the same
 * precision as the columns. We round HALF-UP to 2dp via Decimal to avoid the
 * IEEE-754 drift of Math.round on certain .5 boundaries.
 */

/**
 * Validate and normalise an incoming exchange rate. `undefined`/`null` default
 * to 1 (the implicit AED rate). Anything else must parse to a finite, strictly
 * positive number — zero or negative rates would silently zero out the base
 * amount, hiding an unbalanced JE behind a quiet "all zeros" entry.
 */
export function positiveExchangeRate(rawRate: unknown): number {
  if (rawRate === undefined || rawRate === null) return 1;
  const rate = Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a positive number');
  }
  return rate;
}

/**
 * Convert a foreign amount to AED (base currency). Returns the input unchanged
 * (rounded to 2dp) when currency is AED or missing.
 */
export function toBaseCurrencyAmount(
  amount: number,
  currency: string,
  exchangeRate: number,
): number {
  const amountD = new Decimal(amount || 0);
  return (currency || 'AED') === 'AED'
    ? amountD.toDecimalPlaces(2).toNumber()
    : amountD.times(exchangeRate).toDecimalPlaces(2).toNumber();
}

/**
 * Build the foreign-amount tracking fields for a journal line. AED returns
 * zeroed fields (exchangeRate=1) so the line still serialises consistently;
 * non-AED preserves the original foreign amounts + rate alongside the AED leg
 * already stored in `debit`/`credit`.
 */
export function withForeignAmount(
  currency: string,
  exchangeRate: number,
  foreignDebit: number,
  foreignCredit: number,
):
  | { foreignDebit: number; foreignCredit: number; exchangeRate: number }
  | {
      foreignCurrency: string;
      foreignDebit: number;
      foreignCredit: number;
      exchangeRate: number;
    } {
  if ((currency || 'AED') === 'AED') {
    return { foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 };
  }
  return {
    foreignCurrency: currency,
    foreignDebit,
    foreignCredit,
    exchangeRate,
  };
}

/**
 * Round a single AED amount to 2dp using Decimal (matches the persistence
 * precision of all money columns).
 */
export function round2(amount: number): number {
  return new Decimal(amount || 0).toDecimalPlaces(2).toNumber();
}

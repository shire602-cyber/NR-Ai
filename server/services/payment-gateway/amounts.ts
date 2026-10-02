// Minor-unit conversion for the provider API. Only 2-decimal currencies are supported online: zero- and
// three-decimal currencies (JPY, KWD, ...) are refused rather than risk a 100x or 1000x charge.

import Decimal from "decimal.js";

const NON_TWO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

export function isSupportedGatewayCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency.toUpperCase()) && !NON_TWO_DECIMAL.has(currency.toUpperCase());
}

export function toMinor(amount: number): number {
  return new Decimal(amount).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromMinor(minor: number): number {
  return new Decimal(minor).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** Smallest amount charged online, in the invoice currency (the provider's own minimum is about AED 2). */
export const MIN_ONLINE_AMOUNT = 2;

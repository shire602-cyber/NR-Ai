/**
 * The one money formatter (D2b, CTO checkpoint issue 1).
 *
 * Rules
 * - Digits are always Latin with a "," group and "." decimal separator, two decimals.
 * - The sign comes first and is a true minus (U+2212), never a hyphen.
 * - English: currency code at the inline start, `AED 8,922.33`.
 * - Arabic: currency after the number in reading order, `8,922.33 د.إ` (renders with the
 *   currency on the left inside right-to-left text, the Arabic convention).
 * - AED in Arabic is `د.إ` (no trailing dot); every other currency keeps its ISO code.
 *
 * Components render money through `<Money>` / `<MoneyCell>` (client/src/components/ui/money.tsx),
 * which use `formatMoneyParts` and put each part in its own isolated span. `formatMoneyText`
 * is the plain-string form for places that cannot hold markup (chart tooltips, aria labels,
 * toasts); it wraps the parts in Unicode isolates so the order survives any surrounding
 * direction. `lib/format.ts#formatCurrency` delegates here.
 */

import { isolateLtrText, isolateRtlText } from "./format-bidi";

export type MoneyLocale = "en" | "ar" | string;

export interface MoneyFormatOptions {
  /** "auto" (default): minus only. "always": also "+" for positive amounts (deltas). */
  signDisplay?: "auto" | "always";
  /** Fraction digits (default 2). */
  fractionDigits?: number;
}

export interface MoneyParts {
  /** "" | "−" | "+" */
  sign: string;
  /** Absolute amount with Latin digits, e.g. "77,765.65". */
  amount: string;
  /** Display label for the currency: "AED", "USD", or "د.إ" for AED in Arabic. */
  currency: string;
  /** Where the currency goes in reading order. */
  currencyPosition: "start" | "end";
  /** Text direction the whole figure is laid out in. */
  dir: "ltr" | "rtl";
  isNegative: boolean;
  isZero: boolean;
}

export const MINUS_SIGN = "−";

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);

/** ISO 4217 minor-unit digits for the currencies we hold (3 for KWD/BHD/OMR, 0 for JPY, else 2). */
export function currencyFractionDigits(currency: string | null | undefined): number {
  const code = (currency || "AED").toUpperCase();
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  return 2;
}

const numberFormatters = new Map<number, Intl.NumberFormat>();
function numberFormatter(digits: number): Intl.NumberFormat {
  let f = numberFormatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: true,
    });
    numberFormatters.set(digits, f);
  }
  return f;
}

/** Currency label in the UI locale. */
export function currencyLabel(currency: string | null | undefined, locale: MoneyLocale): string {
  const code = (currency || "AED").toUpperCase();
  if (locale === "ar" && code === "AED") return "د.إ";
  return code;
}

/** Latin-digit number with grouping, e.g. 1234.5 -> "1,234.50" (no sign handling). */
export function formatAmountDigits(value: number, fractionDigits = 2): string {
  return numberFormatter(fractionDigits).format(Math.abs(value));
}

export function formatMoneyParts(
  amount: number,
  currency: string | null | undefined = "AED",
  locale: MoneyLocale = "en",
  options: MoneyFormatOptions = {}
): MoneyParts {
  const digits = options.fractionDigits ?? 2;
  const value = Number.isFinite(amount) ? amount : 0;
  const rounded = Number(value.toFixed(digits));
  const isZero = rounded === 0;
  const isNegative = rounded < 0;
  const sign = isNegative ? MINUS_SIGN : !isZero && options.signDisplay === "always" ? "+" : "";
  const ar = locale === "ar";
  return {
    sign,
    amount: formatAmountDigits(rounded, digits),
    currency: currencyLabel(currency, locale),
    currencyPosition: ar ? "end" : "start",
    dir: ar ? "rtl" : "ltr",
    isNegative,
    isZero,
  };
}

/** Plain-string money for non-markup contexts (tooltips, aria, toasts). */
export function formatMoneyText(
  amount: number,
  currency: string | null | undefined = "AED",
  locale: MoneyLocale = "en",
  options: MoneyFormatOptions = {}
): string {
  const p = formatMoneyParts(amount, currency, locale, options);
  const figure = isolateLtrText(`${p.sign}${p.amount}`);
  if (p.currencyPosition === "end") {
    const label = p.currency === "د.إ" ? p.currency : isolateLtrText(p.currency);
    return isolateRtlText(`${figure} ${label}`);
  }
  return `${p.currency} ${figure}`;
}

/** Percentage delta with the same sign rules, e.g. "+12.4%" / "−4.2%" (Latin digits). */
export function formatPercentDelta(value: number, fractionDigits = 1): string {
  const rounded = Number(value.toFixed(fractionDigits));
  const sign = rounded < 0 ? MINUS_SIGN : rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(fractionDigits)}%`;
}

/** Strip the Unicode isolate controls (for tests and plain-text exports). */
export function stripBidiControls(text: string): string {
  return text.replace(/[⁦-⁩‎‏]/g, "");
}

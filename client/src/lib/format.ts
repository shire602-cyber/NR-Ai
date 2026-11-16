// Formatting utilities for currency and numbers
import { formatMoneyText } from "./format-money";
import { useI18n } from "./i18n";
import { formatDate as formatDisplayDate } from "./format-date";

/**
 * Display money as a string. Delegates to the one money formatter (lib/format-money.ts):
 * Latin digits, true minus, `AED 1,250.00` in English and `1,250.00 د.إ` in Arabic.
 * Prefer `<Money>` / `<MoneyCell>` in JSX.
 */
export function formatCurrency(
  amount: number,
  currency: string = "AED",
  locale: string = "en"
): string {
  return formatMoneyText(Number(amount) || 0, currency || "AED", locale);
}

/** Raw Intl currency string (no bidi isolates) for PDF/print renderers only. */
export function formatCurrencyPlain(
  amount: number,
  currency: string = "AED",
  locale: string = "en"
): string {
  // For Arabic locale, use ar-AE
  const formatLocale = locale === "ar" ? "ar-AE" : "en-AE";

  return new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number, locale: string = "en"): string {
  const formatLocale = locale === "ar" ? "ar-AE" : "en-AE";

  return new Intl.NumberFormat(formatLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Display date, `d MMM yyyy` (lib/format-date.ts). */
export function formatDate(date: Date | string, locale: string = "en"): string {
  return formatDisplayDate(date, locale);
}

/** Raw Intl date string for PDF/print renderers only. */
export function formatDatePlain(date: Date | string, locale: string = "en"): string {
  const formatLocale = locale === "ar" ? "ar-AE" : "en-AE";
  const dateObj = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(formatLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(dateObj);
}

/** Short month label for a `YYYY-MM` key ("Nov" / "نوفمبر"), in the UI locale (R18-02). */
export function formatMonthKey(key: string, locale: string = "en"): string {
  const match = /^(\d{4})-(\d{2})/.exec(key ?? "");
  if (!match) return key;
  const formatLocale = locale === "ar" ? "ar-AE" : "en-AE";
  return new Intl.DateTimeFormat(formatLocale, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  );
}

export function formatPercent(value: number, locale: string = "en"): string {
  const formatLocale = locale === "ar" ? "ar-AE" : "en-AE";

  return new Intl.NumberFormat(formatLocale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

// Calculate UAE VAT (5%)
export function calculateVAT(amount: number, vatRate: number = 0.05): number {
  return amount * vatRate;
}

export function calculateTotal(subtotal: number, vatAmount: number): number {
  return subtotal + vatAmount;
}

/**
 * Money as text for helpers that cannot call hooks (module-level formatters). Reads the
 * current UI locale from the i18n store; always two decimals, locale currency label.
 */
export function formatAedText(amount: number): string {
  return formatMoneyText(Number(amount) || 0, "AED", useI18n.getState().locale);
}

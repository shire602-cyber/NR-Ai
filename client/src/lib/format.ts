// Formatting utilities for currency, numbers and dates.
//
// The product shows WESTERN (Latin) digits in both languages: the `-u-nu-latn`
// Unicode extension pins that regardless of the browser's default numbering
// system for Arabic. Currency codes are never translated ("AED 1,050.00").

/** Intl locale tag for the UI language, always with Western digits. */
export function intlLocale(locale: string): string {
  return locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE";
}

export function formatCurrency(
  amount: number,
  currency: string = "AED",
  locale: string = "en"
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number, locale: string = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// Dates are shown as UAE calendar days whatever the browser's time zone is (a stored 2026-09-30T20:00Z is 1 October here).
const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Dubai",
};

/** Options for a fixed calendar date such as "2026-04-26" (no time-zone shift). */
export const CALENDAR_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  ...DEFAULT_DATE_FORMAT,
  month: "long",
  timeZone: "UTC",
};

/** Short-month variant of {@link CALENDAR_DATE_FORMAT}, e.g. "12 Jun 2026". */
export const CALENDAR_DATE_SHORT_FORMAT: Intl.DateTimeFormatOptions = {
  ...CALENDAR_DATE_FORMAT,
  month: "short",
};

export function formatDate(
  date: Date | string,
  locale: string = "en",
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(intlLocale(locale), options).format(dateObj);
}

export function formatPercent(value: number, locale: string = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), {
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

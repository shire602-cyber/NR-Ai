// Formatting utilities for currency and numbers

export function formatCurrency(amount: number, currency: string = 'AED', locale: string = 'en'): string {
  // For Arabic locale, use ar-AE
  const formatLocale = locale === 'ar' ? 'ar-AE' : 'en-AE';
  
  return new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number, locale: string = 'en'): string {
  const formatLocale = locale === 'ar' ? 'ar-AE' : 'en-AE';
  
  return new Intl.NumberFormat(formatLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date: Date | string, locale: string = 'en'): string {
  const formatLocale = locale === 'ar' ? 'ar-AE' : 'en-AE';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return new Intl.DateTimeFormat(formatLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
}

export function formatPercent(value: number, locale: string = 'en'): string {
  const formatLocale = locale === 'ar' ? 'ar-AE' : 'en-AE';
  
  return new Intl.NumberFormat(formatLocale, {
    style: 'percent',
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

/**
 * Arabic number, currency, and date formatting utilities for Muhasib.ai.
 *
 * - Converts Western digits (0-9) to Eastern Arabic digits (٠-٩)
 * - Formats currency amounts with Arabic locale conventions
 * - Formats Gregorian dates using Arabic month names
 */

/* ══════════════════════════════════════════════════════════════════════
   1. DIGIT CONVERSION
   ══════════════════════════════════════════════════════════════════════ */

/** Eastern Arabic digit map (Unicode U+0660 – U+0669) */
const EASTERN_ARABIC_DIGITS: readonly string[] = [
  '\u0660', // ٠
  '\u0661', // ١
  '\u0662', // ٢
  '\u0663', // ٣
  '\u0664', // ٤
  '\u0665', // ٥
  '\u0666', // ٦
  '\u0667', // ٧
  '\u0668', // ٨
  '\u0669', // ٩
] as const;

/**
 * Converts Western (Latin) digits to Eastern Arabic digits.
 *
 * Handles numbers, strings, and preserves all non-digit characters
 * (decimal points, commas, minus signs, etc.).
 *
 * @example
 * toArabicDigits(12345)       // "١٢٣٤٥"
 * toArabicDigits('1,234.56')  // "١,٢٣٤.٥٦"
 * toArabicDigits(-99)         // "-٩٩"
 */
export function toArabicDigits(value: number | string): string {
  const str = String(value);
  return str.replace(/[0-9]/g, (digit) => EASTERN_ARABIC_DIGITS[parseInt(digit, 10)]);
}

/**
 * Converts Eastern Arabic digits back to Western (Latin) digits.
 *
 * @example
 * fromArabicDigits('١٢٣٤٥')  // "12345"
 */
export function fromArabicDigits(value: string): string {
  return value.replace(/[\u0660-\u0669]/g, (char) =>
    String(char.charCodeAt(0) - 0x0660),
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2. CURRENCY FORMATTING
   ══════════════════════════════════════════════════════════════════════ */

/** Common currency codes used in UAE accounting */
type CurrencyCode = 'AED' | 'USD' | 'SAR' | 'EUR' | 'GBP' | string;

/** Arabic currency name map */
const CURRENCY_NAMES_AR: Record<string, string> = {
  AED: 'درهم',
  USD: 'دولار',
  SAR: 'ريال',
  EUR: 'يورو',
  GBP: 'جنيه',
  BHD: 'دينار',
  KWD: 'دينار',
  OMR: 'ريال',
  QAR: 'ريال',
  EGP: 'جنيه',
  JOD: 'دينار',
};

/** Format options for `formatArabicCurrency` */
interface ArabicCurrencyOptions {
  /** Number of decimal places (default: 2) */
  decimals?: number;
  /** Whether to show the currency name/symbol (default: true) */
  showCurrency?: boolean;
  /** Use Eastern Arabic digits (default: true) */
  useArabicDigits?: boolean;
  /** Position currency name: 'after' (default for Arabic) or 'before' */
  currencyPosition?: 'before' | 'after';
}

/**
 * Formats a numeric amount as an Arabic currency string.
 *
 * Uses the Arabic thousands separator (comma) and decimal point (period),
 * with Eastern Arabic digits by default.
 *
 * @example
 * formatArabicCurrency(12345.67, 'AED')
 * // "١٢,٣٤٥.٦٧ درهم"
 *
 * formatArabicCurrency(12345.67, 'AED', { useArabicDigits: false })
 * // "12,345.67 درهم"
 *
 * formatArabicCurrency(-500, 'USD')
 * // "-٥٠٠.٠٠ دولار"
 */
export function formatArabicCurrency(
  amount: number,
  currency: CurrencyCode = 'AED',
  options: ArabicCurrencyOptions = {},
): string {
  const {
    decimals = 2,
    showCurrency = true,
    useArabicDigits = true,
    currencyPosition = 'after',
  } = options;

  // Format the number with grouping
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  const parts = absAmount.toFixed(decimals).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimalPart = parts[1] || '';

  let formatted = decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;

  if (isNegative) {
    formatted = `-${formatted}`;
  }

  // Convert digits if requested
  if (useArabicDigits) {
    formatted = toArabicDigits(formatted);
  }

  // Append or prepend currency name
  if (showCurrency) {
    const currencyName = CURRENCY_NAMES_AR[currency.toUpperCase()] || currency;
    if (currencyPosition === 'before') {
      formatted = `${currencyName} ${formatted}`;
    } else {
      formatted = `${formatted} ${currencyName}`;
    }
  }

  return formatted;
}

/**
 * Formats a number with Arabic thousands separators and optional Arabic digits.
 * Does not include currency — use `formatArabicCurrency` for that.
 *
 * @example
 * formatArabicNumber(1234567.89) // "١,٢٣٤,٥٦٧.٨٩"
 */
export function formatArabicNumber(
  value: number,
  options: { decimals?: number; useArabicDigits?: boolean } = {},
): string {
  const { decimals = 2, useArabicDigits = true } = options;

  const parts = Math.abs(value).toFixed(decimals).split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimalPart = parts[1] || '';

  let formatted = decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;

  if (value < 0) {
    formatted = `-${formatted}`;
  }

  return useArabicDigits ? toArabicDigits(formatted) : formatted;
}

/* ══════════════════════════════════════════════════════════════════════
   3. DATE FORMATTING
   ══════════════════════════════════════════════════════════════════════ */

/** Gregorian month names in Arabic */
const ARABIC_MONTHS: readonly string[] = [
  'يناير',     // January
  'فبراير',    // February
  'مارس',      // March
  'أبريل',     // April
  'مايو',      // May
  'يونيو',     // June
  'يوليو',     // July
  'أغسطس',     // August
  'سبتمبر',    // September
  'أكتوبر',    // October
  'نوفمبر',    // November
  'ديسمبر',    // December
] as const;

/** Short Gregorian month names in Arabic */
const ARABIC_MONTHS_SHORT: readonly string[] = [
  'ينا',
  'فبر',
  'مار',
  'أبر',
  'ماي',
  'يون',
  'يول',
  'أغس',
  'سبت',
  'أكت',
  'نوف',
  'ديس',
] as const;

/** Arabic day names */
const ARABIC_DAYS: readonly string[] = [
  'الأحد',      // Sunday
  'الاثنين',    // Monday
  'الثلاثاء',   // Tuesday
  'الأربعاء',   // Wednesday
  'الخميس',     // Thursday
  'الجمعة',     // Friday
  'السبت',      // Saturday
] as const;

/** Arabic day names — short form */
const ARABIC_DAYS_SHORT: readonly string[] = [
  'أحد',
  'اثنين',
  'ثلاثاء',
  'أربعاء',
  'خميس',
  'جمعة',
  'سبت',
] as const;

/** Format options for `formatArabicDate` */
interface ArabicDateOptions {
  /** Include day name (default: false) */
  showDay?: boolean;
  /** Use short month/day names (default: false) */
  short?: boolean;
  /** Include time (default: false) */
  showTime?: boolean;
  /** Use Eastern Arabic digits (default: true) */
  useArabicDigits?: boolean;
  /** Date format style:
   *  - 'long'    : ١٥ يناير ٢٠٢٦
   *  - 'short'   : ١٥/٠١/٢٠٢٦
   *  - 'numeric' : ٢٠٢٦-٠١-١٥
   */
  style?: 'long' | 'short' | 'numeric';
}

/**
 * Formats a Date object (or ISO string / timestamp) using Arabic month
 * names and optionally Eastern Arabic digits.
 *
 * @example
 * formatArabicDate(new Date('2026-01-15'))
 * // "١٥ يناير ٢٠٢٦"
 *
 * formatArabicDate('2026-03-19', { showDay: true })
 * // "الخميس ١٩ مارس ٢٠٢٦"
 *
 * formatArabicDate(new Date(), { style: 'short' })
 * // "١٩/٠٣/٢٠٢٦"
 *
 * formatArabicDate(new Date(), { style: 'numeric' })
 * // "٢٠٢٦-٠٣-١٩"
 *
 * formatArabicDate(new Date(), { showTime: true })
 * // "١٩ مارس ٢٠٢٦ ١٤:٣٠"
 */
export function formatArabicDate(
  input: Date | string | number,
  options: ArabicDateOptions = {},
): string {
  const {
    showDay = false,
    short = false,
    showTime = false,
    useArabicDigits = true,
    style = 'long',
  } = options;

  const date = input instanceof Date ? input : new Date(input);

  if (isNaN(date.getTime())) {
    return '';
  }

  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  const dayOfWeek = date.getDay(); // 0 = Sunday

  let result: string;

  switch (style) {
    case 'short': {
      const dd = String(day).padStart(2, '0');
      const mm = String(month + 1).padStart(2, '0');
      result = `${dd}/${mm}/${year}`;
      break;
    }
    case 'numeric': {
      const dd = String(day).padStart(2, '0');
      const mm = String(month + 1).padStart(2, '0');
      result = `${year}-${mm}-${dd}`;
      break;
    }
    case 'long':
    default: {
      const monthName = short
        ? ARABIC_MONTHS_SHORT[month]
        : ARABIC_MONTHS[month];
      result = `${day} ${monthName} ${year}`;
      break;
    }
  }

  // Prepend day name if requested
  if (showDay) {
    const dayName = short
      ? ARABIC_DAYS_SHORT[dayOfWeek]
      : ARABIC_DAYS[dayOfWeek];
    result = `${dayName} ${result}`;
  }

  // Append time if requested
  if (showTime) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    result = `${result} ${hours}:${minutes}`;
  }

  // Convert digits
  if (useArabicDigits) {
    result = toArabicDigits(result);
  }

  return result;
}

/**
 * Returns the Arabic name of a Gregorian month (1-indexed).
 *
 * @example
 * getArabicMonthName(1)  // "يناير"
 * getArabicMonthName(12) // "ديسمبر"
 */
export function getArabicMonthName(month: number, short = false): string {
  const idx = Math.max(0, Math.min(11, month - 1));
  return short ? ARABIC_MONTHS_SHORT[idx] : ARABIC_MONTHS[idx];
}

/**
 * Returns the Arabic name of a day of the week (0 = Sunday).
 *
 * @example
 * getArabicDayName(0) // "الأحد"
 * getArabicDayName(5) // "الجمعة"
 */
export function getArabicDayName(dayIndex: number, short = false): string {
  const idx = Math.max(0, Math.min(6, dayIndex));
  return short ? ARABIC_DAYS_SHORT[idx] : ARABIC_DAYS[idx];
}

/* ══════════════════════════════════════════════════════════════════════
   4. PERCENTAGE FORMATTING
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Formats a percentage value in Arabic.
 *
 * @example
 * formatArabicPercentage(15.5) // "١٥.٥٪"
 */
export function formatArabicPercentage(
  value: number,
  options: { decimals?: number; useArabicDigits?: boolean } = {},
): string {
  const { decimals = 1, useArabicDigits = true } = options;
  const formatted = value.toFixed(decimals);
  const withSymbol = `${formatted}٪`;
  return useArabicDigits ? toArabicDigits(withSymbol) : withSymbol;
}

/* ══════════════════════════════════════════════════════════════════════
   5. RELATIVE TIME (ARABIC)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Returns a human-readable relative time string in Arabic.
 *
 * @example
 * formatArabicRelativeTime(new Date(Date.now() - 60000))
 * // "منذ دقيقة"
 *
 * formatArabicRelativeTime(new Date(Date.now() - 3600000 * 3))
 * // "منذ ٣ ساعات"
 */
export function formatArabicRelativeTime(
  input: Date | string | number,
  options: { useArabicDigits?: boolean } = {},
): string {
  const { useArabicDigits = true } = options;
  const date = input instanceof Date ? input : new Date(input);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  let result: string;

  if (diffSec < 60) {
    result = 'منذ لحظات';
  } else if (diffMin === 1) {
    result = 'منذ دقيقة';
  } else if (diffMin === 2) {
    result = 'منذ دقيقتين';
  } else if (diffMin <= 10) {
    result = `منذ ${diffMin} دقائق`;
  } else if (diffMin < 60) {
    result = `منذ ${diffMin} دقيقة`;
  } else if (diffHour === 1) {
    result = 'منذ ساعة';
  } else if (diffHour === 2) {
    result = 'منذ ساعتين';
  } else if (diffHour <= 10) {
    result = `منذ ${diffHour} ساعات`;
  } else if (diffHour < 24) {
    result = `منذ ${diffHour} ساعة`;
  } else if (diffDay === 1) {
    result = 'أمس';
  } else if (diffDay === 2) {
    result = 'منذ يومين';
  } else if (diffDay <= 10) {
    result = `منذ ${diffDay} أيام`;
  } else if (diffDay < 30) {
    result = `منذ ${diffDay} يوم`;
  } else if (diffMonth === 1) {
    result = 'منذ شهر';
  } else if (diffMonth === 2) {
    result = 'منذ شهرين';
  } else if (diffMonth <= 10) {
    result = `منذ ${diffMonth} أشهر`;
  } else if (diffMonth < 12) {
    result = `منذ ${diffMonth} شهر`;
  } else if (diffYear === 1) {
    result = 'منذ سنة';
  } else if (diffYear === 2) {
    result = 'منذ سنتين';
  } else if (diffYear <= 10) {
    result = `منذ ${diffYear} سنوات`;
  } else {
    result = `منذ ${diffYear} سنة`;
  }

  return useArabicDigits ? toArabicDigits(result) : result;
}

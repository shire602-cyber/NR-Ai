/**
 * Shared zod primitives for request bodies (server) and forms (client).
 *
 * Every primitive is strict: it either yields a canonical value or a zod
 * issue — never a silently-coerced garbage value. Compose them into
 * `z.object({...})` schemas and mount with `strictBody(schema)`
 * (server/http/strict-body.ts).
 *
 * Output conventions (frozen):
 *   - money primitives → canonical 2dp decimal string ("1234.50"), ready for a
 *     numeric(15,2) column; `zMoneyFils` → integer fils (shared/money.ts).
 *   - dates → "YYYY-MM-DD" string (calendar-validated, range-checked).
 *   - identifiers (TRN, IBAN, Emirates ID, currency, email) → normalised form.
 */
import "../zod-config";
import { z } from "zod";
import { uaeToday } from "../uae-date";
import { MoneyError, fromFils, toFils, type ToFilsOptions } from "../money";

// ─── Money ────────────────────────────────────────────────────

type MoneySign = "nonNegative" | "positive" | "signed";

function moneyFilsSchema(sign: MoneySign, opts: ToFilsOptions = {}) {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    let fils: number;
    try {
      fils = toFils(value, opts);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof MoneyError ? err.message : "Invalid amount",
        params: { code: err instanceof MoneyError ? err.code : "MONEY_INVALID" },
      });
      return z.NEVER;
    }
    if (sign === "nonNegative" && fils < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be zero or more" });
      return z.NEVER;
    }
    if (sign === "positive" && fils <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    return fils;
  });
}

/** Amount >= 0 → "1234.50". Rejects >2dp, NaN, Infinity, out of numeric(15,2). */
export const zMoney = moneyFilsSchema("nonNegative").transform(fromFils);
/** Amount > 0 → "1234.50". */
export const zMoneyPositive = moneyFilsSchema("positive").transform(fromFils);
/** Amount of either sign (adjustments, credit balances) → "-12.30". */
export const zMoneySigned = moneyFilsSchema("signed").transform(fromFils);
/** Amount >= 0 → integer fils (for code that does arithmetic). */
export const zMoneyFils = moneyFilsSchema("nonNegative");
/** Amount of either sign → integer fils. */
export const zMoneyFilsSigned = moneyFilsSchema("signed");

/** Quantity >= 0 with at most 4 decimal places → number. Accepts numeric strings. */
export const zQuantity = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const s = typeof value === "number" ? value.toString() : value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(s)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quantity must be a non-negative number with at most 4 decimal places",
    });
    return z.NEVER;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n > 1e11) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Quantity is out of range" });
    return z.NEVER;
  }
  return n;
});

// ─── Dates ────────────────────────────────────────────────────

export const DEFAULT_MIN_DATE = "1990-01-01";
/** Default allowance for future dates (≈5 years): due dates, terminations, plans. */
export const DEFAULT_MAX_DAYS_AHEAD = 1827;

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** True when y-m-d is a real calendar day (rejects 2025-02-30, 2025-13-01). */
export function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/** Today's UAE (Asia/Dubai, UTC+4) calendar day: the day a user in Dubai means by "today". */
function todayUae(): string {
  return uaeToday();
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Parse to canonical "YYYY-MM-DD" or null. Accepts ISO date / ISO datetime strings and valid Dates. */
export function parseIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealCalendarDate(y, mo, d)) return null;
  if (value.trim().length > 10 && Number.isNaN(new Date(value.trim()).getTime())) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface DateRangeOptions {
  /** Earliest allowed date, inclusive. Default 1990-01-01. */
  min?: string;
  /** Latest allowed date as days after today (Dubai day). Default ≈5 years. */
  maxDaysAhead?: number;
}

/** Calendar date within [min, today + maxDaysAhead] → "YYYY-MM-DD". */
export function zDateIn(opts: DateRangeOptions = {}) {
  const min = opts.min ?? DEFAULT_MIN_DATE;
  const maxDaysAhead = opts.maxDaysAhead ?? DEFAULT_MAX_DAYS_AHEAD;
  return z.union([z.string(), z.date()]).transform((value, ctx) => {
    const iso = parseIsoDate(value);
    if (!iso) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be a real calendar date in YYYY-MM-DD format",
      });
      return z.NEVER;
    }
    const max = addDaysIso(todayUae(), maxDaysAhead);
    if (iso < min || iso > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Date must be between ${min} and ${max}`,
      });
      return z.NEVER;
    }
    return iso;
  });
}

/** Default date primitive: 1990-01-01 .. today + ~5 years. */
export const zDate = zDateIn();

/** Payroll/VAT period month, 1..12 (accepts "7"). */
export const zPeriodMonth = z.coerce
  .number({
    error: (iss) =>
      iss.code === "invalid_type" && iss.input !== undefined ? "Month must be a number" : undefined,
  })
  .int()
  .min(1)
  .max(12);
/** Period year, 1990..2100 (accepts "2026"). */
export const zPeriodYear = z.coerce
  .number({
    error: (iss) =>
      iss.code === "invalid_type" && iss.input !== undefined ? "Year must be a number" : undefined,
  })
  .int()
  .min(1990)
  .max(2100);

// ─── Identifiers ──────────────────────────────────────────────

export const zUuid = z
  .string()
  .trim()
  .guid("Must be a UUID")
  .transform((s) => s.toLowerCase());

/** UAE Tax Registration Number: exactly 15 digits. */
export const zTrn = z
  .string()
  .trim()
  .regex(/^\d{15}$/, "TRN must be exactly 15 digits");

/** ISO 13616 mod-97 check over an IBAN (already upper-case, no spaces). */
export function ibanMod97Valid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** UAE IBAN: "AE" + 21 digits (23 chars) with valid mod-97. Spaces allowed on input. */
export const zIbanAE = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .refine((s) => /^AE\d{21}$/.test(s), "UAE IBAN must be AE followed by 21 digits")
  .refine((s) => ibanMod97Valid(s), "IBAN check digits are invalid");

/** Luhn (mod-10) check over a digit string. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Emirates ID 784-YYYY-NNNNNNN-C (hyphens optional on input) → canonical hyphenated form. */
export const zEmiratesId = z.string().transform((value, ctx) => {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^784\d{12}$/.test(digits)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Emirates ID must be 784-YYYY-NNNNNNN-C",
    });
    return z.NEVER;
  }
  const year = Number(digits.slice(3, 7));
  if (year < 1900 || year > new Date().getUTCFullYear()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Emirates ID birth year is invalid" });
    return z.NEVER;
  }
  if (!luhnValid(digits)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Emirates ID check digit is invalid" });
    return z.NEVER;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
});

/** Active ISO 4217 alphabetic codes. */
export const ISO_4217_CODES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XCG",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
] as const;
const ISO_4217 = new Set<string>(ISO_4217_CODES);

export const zCurrency = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => ISO_4217.has(s), "Unknown ISO 4217 currency code");

// ─── UAE enums ────────────────────────────────────────────────

export const EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;
/** One of the seven emirates. No default — VAT 201 Box 1 attribution depends on it. */
export const zEmirate = z.enum(EMIRATES);

/** UAE VAT rate in percent: 0 or 5 (accepts "5"). */
export const zVatRate = z.coerce
  .number()
  .refine((n) => n === 0 || n === 5, "VAT rate must be 0 or 5");

export const SUPPLY_TYPES = [
  "standard_rated",
  "zero_rated",
  "exempt",
  "out_of_scope",
  "reverse_charge",
] as const;
export const zSupplyType = z.enum(SUPPLY_TYPES);

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export const zAccountType = z.enum(ACCOUNT_TYPES);

// ─── Text, URLs, email ────────────────────────────────────────

// C0/C1 control characters except tab (\x09), LF (\x0A) and CR (\x0D).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Strip markup and control characters from user text. Isomorphic (no DOM),
 * so it runs in both client forms and server validation. Tags are removed,
 * not escaped; a lone "<" that is not part of a tag survives.
 */
export function sanitizePlainText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[A-Za-z!][^<>]*>/g, "")
    .replace(CONTROL_CHARS, "")
    .trim();
}

/** Sanitised, trimmed text with a max length (measured after sanitising). */
export function zText(max: number, opts: { min?: number } = {}) {
  return z
    .string()
    .transform(sanitizePlainText)
    .pipe(
      z
        .string()
        .min(opts.min ?? 0)
        .max(max)
    );
}

/** https:// URL or a raster data:image URL (no SVG). Never javascript:, http:, or other schemes. */
export const zHttpsUrl = z
  .string()
  .trim()
  .refine((s) => {
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return true;
    try {
      const u = new URL(s);
      return u.protocol === "https:" && u.hostname.length > 0;
    } catch {
      return false;
    }
  }, "Must be an https:// URL or a data:image URL");

export const zEmail = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().email("Must be a valid email address").max(254));

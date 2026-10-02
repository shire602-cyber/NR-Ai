// Number and date helpers shared by the statement parsers. Pure.

import Decimal from "decimal.js";

export const round2 = (value: number): number => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/** UTC midnight of a calendar day. Returns null for an impossible date (31 February). */
export function utcDay(year: number, month1: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return null;
  const d = new Date(Date.UTC(year, month1 - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month1 - 1 && d.getUTCDate() === day ? d : null;
}

/** "YYYY-MM-DD" of a UTC-midnight date. */
export const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** 1234,56 / 1.234,56 / 1,234.56 / 1234.56 -> number. Null when it is not a number. */
export function parseDecimal(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // the later separator is the decimal point
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234" with exactly three trailing digits and no other comma reads as thousands, otherwise a decimal comma
    const frac = s.length - lastComma - 1;
    s = frac === 3 && s.indexOf(",") === lastComma && !/^0,/.test(s) ? s.replace(",", "") : s.replace(",", ".");
  }
  if (!/^[+-]?\d*\.?\d+$|^[+-]?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the five predefined XML entities and numeric references; anything else is left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Strip a UTF-8 byte order mark and normalise line endings to \n. */
export const normalizeText = (text: string): string => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

/** Is this string shaped like an IBAN (country code, check digits, up to 30 alphanumerics)? */
export const looksLikeIban = (value: string): boolean => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(value.replace(/\s+/g, "").toUpperCase());

/** Compare account ids loosely: whitespace and case ignored. */
export const sameAccountId = (a: string, b: string): boolean =>
  a.replace(/\s+/g, "").toUpperCase() === b.replace(/\s+/g, "").toUpperCase();

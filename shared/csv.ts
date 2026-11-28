// Single CSV cell encoder for every export (server and client-safe: no imports).
//
// Spreadsheet formula injection (S05): a cell whose text starts with = + - @ TAB or CR runs as a
// formula in Excel / Sheets / LibreOffice. User-controlled text (names, descriptions, references,
// memos) must never reach a CSV cell without passing through here.

const FORMULA_LEAD = /^[=+\-@\t\r]/;
// Plain numbers pre-formatted as text ("-12.5", "-1,234.00") are data, not formulas: leave them.
const NUMERIC_TEXT = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

/** Prefix an apostrophe when text would be parsed as a formula; numeric text is left alone. */
export function guardFormula(s: string): string {
  return FORMULA_LEAD.test(s) && !NUMERIC_TEXT.test(s) ? `'${s}` : s;
}

/**
 * One cell, quoted only when needed. Numbers stay numeric (a negative number is not guarded);
 * Dates become YYYY-MM-DD; null/undefined/non-finite numbers become empty.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  const s = guardFormula(raw);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Always-quoted variant (audit export): objects are JSON-encoded, strings guarded then quoted. */
export function csvQuotedCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${guardFormula(s).replace(/"/g, '""')}"`;
}

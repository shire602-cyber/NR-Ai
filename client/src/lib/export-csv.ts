import type { ExportData } from "./export";

// CSV export for the report screens. It takes the same rows the Excel export takes
// (ExportData[]: columns + row objects) so every prepare*ForExport function feeds both.
//
//  - RFC 4180: fields containing a comma, a double quote, CR or LF are quoted and inner quotes
//    are doubled; records end with CRLF.
//  - UTF-8 byte-order mark first, so Excel reads Arabic text as UTF-8 instead of the ANSI code page.
//  - Numbers are written as plain JS numbers (1234.5, never "1,234.50"), so the column stays numeric.
//  - Text that a spreadsheet would run as a formula (leading = + @ tab CR, or a - that does not start
//    a number) gets a leading apostrophe: a customer named "=HYPERLINK(...)" must not execute on open.

export const CSV_BOM = "﻿";
const CRLF = "\r\n";
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

function neutraliseFormula(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (text.startsWith("-") && !NUMERIC_TEXT.test(text)) return `'${text}`;
  return text;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") return neutraliseFormula(JSON.stringify(value));
  return neutraliseFormula(String(value));
}

/** One CSV field, quoted when it holds a delimiter, a quote or a line break. */
export function csvField(value: unknown): string {
  const text = cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRecord = (values: unknown[]): string => values.map(csvField).join(",");

/**
 * The CSV text (with BOM) for one or more sheets. A CSV file holds one table, so several sheets are
 * written one after another, each introduced by its sheet name and separated by a blank record.
 */
export function buildCsv(sheets: ExportData[]): string {
  const blocks = sheets.map((sheet) => {
    const records: string[] = [];
    if (sheets.length > 1 && sheet.sheetName) records.push(csvRecord([sheet.sheetName]));
    records.push(csvRecord(sheet.columns.map((c) => c.header)));
    for (const row of sheet.rows) records.push(csvRecord(sheet.columns.map((c) => row[c.key])));
    return records.join(CRLF);
  });
  return CSV_BOM + blocks.join(CRLF + CRLF) + CRLF;
}

/** Download the sheets as `<filename>.csv`. */
export function exportToCsv(rows: ExportData[], filename: string): void {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Cell formatting for the report viewer (Phase 8 D4). Pure, so it is unit tested. Digits are always Western (Latin)
// in both languages, as everywhere else in the product (lib/format.ts); money has two decimals, percent one.

import type { ReportColumn, ReportRow } from "@shared/report-result";
import { intlLocale } from "./format";

export type ReportCell = string | number | null | undefined;

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, decimals: number): Intl.NumberFormat {
  const key = `${locale}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(key, f);
  }
  return f;
}

/** Text of a cell for its column type; empty for a missing value. */
export function formatCell(value: ReportCell, type: ReportColumn["type"], locale: string): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "money": {
      const n = Number(value);
      return Number.isFinite(n) ? numberFormat(locale, 2).format(n) : String(value);
    }
    case "percent": {
      const n = Number(value);
      return Number.isFinite(n) ? `${numberFormat(locale, 1).format(n)}%` : String(value);
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n)
        ? numberFormat(locale, Number.isInteger(n) ? 0 : 2).format(n)
        : String(value);
    }
    default:
      return String(value);
  }
}

/** Numeric columns line up on the end edge. */
export const isNumericColumn = (type: ReportColumn["type"]): boolean =>
  type === "money" || type === "number" || type === "percent";

/** A negative amount or a drop shows in the danger colour; a zero or missing value does not. */
export const isNegativeCell = (value: ReportCell, type: ReportColumn["type"]): boolean =>
  (type === "money" || type === "number" || type === "percent") &&
  typeof value === "number" &&
  value < 0;

/** Columns that name the record, in the order a row's drill link prefers them. */
const LINK_COLUMN_PREFERENCE = [
  "name",
  "account",
  "customer",
  "vendor",
  "number",
  "description",
  "item",
  "employee",
];

/** The text column a row's drill link sits on: the one that names the record, else the first text column. */
export function linkColumnIndex(columns: ReportColumn[]): number {
  for (const key of LINK_COLUMN_PREFERENCE) {
    const index = columns.findIndex((c) => c.key === key && c.type === "text");
    if (index >= 0) return index;
  }
  return Math.max(
    0,
    columns.findIndex((c) => c.type === "text")
  );
}

/** A section row carries its heading in whichever text cell the report filled. */
export function sectionHeading(row: ReportRow, columns: ReportColumn[]): string {
  for (const column of columns) {
    const value = row.cells[column.key];
    if (column.type === "text" && value !== null && value !== undefined && value !== "")
      return String(value);
  }
  return "";
}

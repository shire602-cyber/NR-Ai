// Shared by the CSV / XLSX / PDF renderers (Phase 8 D4).

import type { ReportColumn, ReportResult } from "../../../shared/report-result";

export type Lang = "en" | "ar";

export const labelOf = (c: ReportColumn, lang: Lang): string => (lang === "ar" ? c.label.ar : c.label.en);
export const titleOf = (r: ReportResult, lang: Lang): string => (lang === "ar" ? r.title.ar : r.title.en);
export const totalLabel = (lang: Lang): string => (lang === "ar" ? "الإجمالي" : "Total");

/** The first text column: where the "Total" label goes. */
export function firstTextColumn(columns: ReportColumn[]): ReportColumn | undefined {
  return columns.find((c) => c.type === "text") ?? columns[0];
}

/** Totals as a cells object with the Total label added, or undefined when the report has no totals. */
export function totalsCells(r: ReportResult, lang: Lang): Record<string, string | number | null> | undefined {
  if (!r.totals) return undefined;
  const first = firstTextColumn(r.columns);
  const cells: Record<string, string | number | null> = { ...r.totals };
  if (first && (cells[first.key] === undefined || cells[first.key] === null)) cells[first.key] = totalLabel(lang);
  return cells;
}

/** File name (ASCII, dated) for a report download. */
export function reportFileName(r: ReportResult, ext: "csv" | "xlsx" | "pdf"): string {
  const day = r.params.asOf ?? r.params.to ?? r.generatedAt.slice(0, 10);
  const from = r.params.from && !r.params.asOf ? `${r.params.from}_` : "";
  return `${r.reportId}-${from}${day}.${ext}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

export const MIME = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

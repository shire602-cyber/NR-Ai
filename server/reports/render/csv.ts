// CSV renderer (Phase 8 D4): UTF-8 with a BOM so Excel opens Arabic correctly, CRLF lines, money to two decimals,
// and a leading apostrophe on any text cell Excel would read as a formula (= + - @).

import type { ReportResult } from "../../../shared/report-result";
import { labelOf, totalsCells, type Lang } from "./common";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined, type: string): string {
  if (value === null || value === undefined || value === "") return "";
  let text: string;
  if (typeof value === "number") {
    text = type === "money" || type === "percent" ? value.toFixed(2) : String(value);
    return text;
  }
  text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv(result: ReportResult, lang: Lang): Buffer {
  const lines: string[] = [];
  lines.push(result.columns.map((c) => csvCell(labelOf(c, lang), "text")).join(","));
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => csvCell(row.cells[c.key], c.type)).join(","));
  }
  const totals = totalsCells(result, lang);
  if (totals) lines.push(result.columns.map((c) => csvCell(totals[c.key], c.type)).join(","));
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

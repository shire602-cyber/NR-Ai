// The one generic report PDF renderer (Phase 8 D4), built on createPdfDocument so Arabic is shaped and embedded
// (Noto Sans Arabic). A4, landscape above six columns; company, title (English, or the Arabic report name), the
// parameters and the Dubai time at the top; the column header repeats on every page; sections, subtotals and a totals
// row; "Page x / y" at the bottom. For lang=ar the columns are mirrored and text right-aligned. Digits stay Western.

import type { ReportColumn, ReportResult, ReportRow } from "../../../shared/report-result";
import { createPdfDocument } from "../../services/pdf-fonts";
import { fitFontSize } from "../../services/pdf-layout";
import { formatMoney, formatPdfDate } from "../../services/pdf-format";
import { labelOf, titleOf, totalsCells, type Lang } from "./common";

const MARGIN = 36;
const BOTTOM_MARGIN = 20;
const HEADER_ROW = 20;
const ROW = 15;
const FOOTER_Y_FROM_BOTTOM = 34;
const BRAND = "#0F172A";

export const PDF_MAX_ROWS = 5000;

interface Layout {
  width: number;
  height: number;
  landscape: boolean;
}

function layoutFor(columnCount: number): Layout {
  const landscape = columnCount > 6;
  return landscape ? { width: 841.89, height: 595.28, landscape } : { width: 595.28, height: 841.89, landscape };
}

const WEIGHT: Record<string, number> = { text: 1.7, date: 1.1, money: 1.4, number: 1, percent: 1.2 };

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** "5 أغسطس 2026": Arabic month name, Western digits. English uses the shared "5 Aug 2026" formatter. */
function dateText(value: Date | string, lang: Lang): string {
  if (lang !== "ar") return formatPdfDate(value);
  const d = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const WIDE_TEXT = new Set(["name", "description", "customer", "vendor", "memo", "item", "title"]);

function columnWidths(columns: ReportColumn[], usable: number): number[] {
  const weights = columns.map((c) => (c.type === "text" && WIDE_TEXT.has(c.key) ? 3 : (WEIGHT[c.type] ?? 1.5)));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * usable);
}

function display(value: string | number | null | undefined, column: ReportColumn, lang: Lang): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (column.type === "money") return formatMoney(value);
    if (column.type === "percent") return `${value.toFixed(2)}%`;
    return String(value);
  }
  return column.type === "date" ? dateText(value, lang) : value;
}

function paramsLine(result: ReportResult, lang: Lang): string {
  const p = result.params;
  const parts: string[] = [];
  if (p.from && p.to) parts.push(lang === "ar" ? `من ${dateText(p.from, lang)} إلى ${dateText(p.to, lang)}` : `From ${dateText(p.from, lang)} to ${dateText(p.to, lang)}`);
  if (p.asOf) parts.push(lang === "ar" ? `كما في ${dateText(p.asOf, lang)}` : `As of ${dateText(p.asOf, lang)}`);
  const c = p.compare;
  if (c && c.mode !== "none") {
    const window = c.from && c.to ? `${dateText(c.from, lang)} - ${dateText(c.to, lang)}` : c.asOf ? dateText(c.asOf, lang) : c.mode;
    parts.push(lang === "ar" ? `مقارنة مع ${window}` : `Compared with ${window}`);
  }
  return parts.join("   |   ");
}

function dubaiStamp(iso: string, lang: Lang): string {
  const shifted = new Date(new Date(iso).getTime() + 4 * 3_600_000);
  const hm = shifted.toISOString().slice(11, 16);
  return `${lang === "ar" ? "أُنشئ" : "Generated"} ${dateText(shifted, lang)} ${hm} ${lang === "ar" ? "(توقيت دبي)" : "(Dubai)"}`;
}

export async function renderPdf(result: ReportResult, companyName: string, lang: Lang): Promise<Buffer> {
  const layout = layoutFor(result.columns.length);
  const usable = layout.width - 2 * MARGIN;
  const rtl = lang === "ar";
  const ordered = rtl ? [...result.columns].reverse() : result.columns;
  const widths = columnWidths(ordered, usable);
  const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? MARGIN : acc[i - 1] + widths[i - 1]], []);
  const bottomLimit = layout.height - BOTTOM_MARGIN - FOOTER_Y_FROM_BOTTOM + 14;

  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        layout: layout.landscape ? "landscape" : "portrait",
        margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: BOTTOM_MARGIN },
        bufferPages: true,
        info: { Title: titleOf(result, lang), Author: companyName },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      let y = MARGIN;
      const clipText = (text: string, width: number, size: number, bold: boolean) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica");
        const fitted = fitFontSize(doc, text, width, size, 6);
        doc.fontSize(fitted);
        if (doc.widthOfString(text) <= width) return text;
        let out = text;
        while (out.length > 1 && doc.widthOfString(out + "…") > width) out = out.slice(0, -1);
        return out + "…";
      };
      const cell = (text: string, i: number, rowY: number, opts: { size: number; bold?: boolean; color: string; alignRight: boolean; indent?: number }) => {
        if (!text) return;
        const pad = 3 + (opts.indent ?? 0);
        const w = widths[i] - 2 * 3 - (opts.indent ?? 0);
        const clipped = clipText(text, w, opts.size, !!opts.bold);
        doc.fillColor(opts.color).text(clipped, xs[i] + pad, rowY + 4, { width: w, align: opts.alignRight ? "right" : "left", lineBreak: false });
      };
      const isRightAligned = (c: ReportColumn) => c.type === "money" || c.type === "number" || c.type === "percent" || rtl;

      const drawHeader = () => {
        doc.rect(MARGIN, y, usable, HEADER_ROW).fill(BRAND);
        ordered.forEach((c, i) => cell(labelOf(c, lang), i, y, { size: 7.5, bold: true, color: "#FFFFFF", alignRight: isRightAligned(c) }));
        y += HEADER_ROW;
      };

      // Title block
      doc.font("Helvetica-Bold").fontSize(15).fillColor(BRAND);
      doc.text(titleOf(result, lang), MARGIN, y, { width: usable, align: rtl ? "right" : "left", lineBreak: false });
      y += 22;
      doc.font("Helvetica").fontSize(9).fillColor("#334155");
      doc.text(companyName, MARGIN, y, { width: usable, align: rtl ? "right" : "left", lineBreak: false });
      y += 13;
      const line = paramsLine(result, lang);
      if (line) {
        doc.fontSize(8.5).fillColor("#475569");
        doc.text(line, MARGIN, y, { width: usable, align: rtl ? "right" : "left", lineBreak: false });
        y += 12;
      }
      doc.fontSize(8).fillColor("#64748B");
      doc.text(dubaiStamp(result.generatedAt, lang), MARGIN, y, { width: usable, align: rtl ? "right" : "left", lineBreak: false });
      y += 18;
      drawHeader();

      const drawRow = (row: ReportRow, index: number) => {
        if (y + ROW > bottomLimit) {
          doc.addPage();
          y = MARGIN;
          drawHeader();
        }
        const isDetail = row.kind === "detail";
        if (row.kind === "section") doc.rect(MARGIN, y, usable, ROW).fill("#E2E8F0");
        else if (row.kind === "subtotal") doc.rect(MARGIN, y, usable, ROW).fill("#F1F5F9");
        else if (index % 2 === 1) doc.rect(MARGIN, y, usable, ROW).fill("#F8FAFC");
        const bold = !isDetail;
        let indented = false;
        ordered.forEach((c, i) => {
          const text = display(row.cells[c.key], c, lang);
          const indent = !indented && text && c.type === "text" ? (row.depth ?? 0) * 8 : 0;
          if (text && c.type === "text") indented = true;
          cell(text, i, y, { size: 7.5, bold, color: "#0F172A", alignRight: isRightAligned(c), indent });
        });
        y += ROW;
      };
      result.rows.forEach(drawRow);

      const totals = totalsCells(result, lang);
      if (totals) {
        if (y + ROW > bottomLimit) {
          doc.addPage();
          y = MARGIN;
          drawHeader();
        }
        doc.rect(MARGIN, y, usable, ROW).fill(BRAND);
        ordered.forEach((c, i) => cell(display(totals[c.key], c, lang), i, y, { size: 7.5, bold: true, color: "#FFFFFF", alignRight: isRightAligned(c) }));
        y += ROW;
      }
      if (result.warnings?.length) {
        y += 8;
        doc.font("Helvetica").fontSize(7.5).fillColor("#B45309");
        for (const w of result.warnings) {
          if (y + 10 > bottomLimit) {
            doc.addPage();
            y = MARGIN;
          }
          doc.text(w, MARGIN, y, { width: usable, align: rtl ? "right" : "left", lineBreak: false });
          y += 10;
        }
      }

      // Page numbers
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.font("Helvetica").fontSize(7.5).fillColor("#64748B");
        doc.text(`${rtl ? "صفحة" : "Page"} ${i + 1} / ${range.count}`, MARGIN, layout.height - FOOTER_Y_FROM_BOTTOM, {
          width: usable,
          align: "center",
          lineBreak: false,
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * RenderedReport[] → PDF in the "Ledger" family (Fable spec 2.8): accent top rule, company block,
 * stacked bilingual title, bilingual stacked column headers, the header repeated on every page,
 * "Page x of y" footer. PDFKit + server/services/pdf-fonts for Arabic shaping, bidi and RTL.
 *
 * Styling only: every figure arrives in the RenderedReport and is printed with the shared
 * `formatAmount` from ./model. Presentation-only adjustments here: ISO dates in date columns are
 * printed as "17 Nov 2026", day counts as whole numbers, and the balance-check note as a check
 * mark with a plain sentence.
 */
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { DOCUMENT_ACCENT_DEFAULT } from "../../../shared/document-accent";
import {
  ltr,
  measureHeight,
  measureWidth,
  preparePdfDocument,
  text as drawText,
  type PdfDoc,
} from "../pdf-fonts";
import {
  formatAmount,
  formatIsoDate,
  label,
  type Bilingual,
  type RenderColumn,
  type RenderCompany,
  type RenderTable,
  type RenderedReport,
} from "./model";

const MM = 72 / 25.4;
const PAGE_MARGIN = 18 * MM;
const ACCENT = DOCUMENT_ACCENT_DEFAULT;
const INK = "#111827";
const BODY = "#1F2937";
const MUTED = "#6B7280";
const HAIRLINE = "#D9DEE3";
const ROW_RULE = "#E7EAEE";
const HEAD_FILL = "#F3F5F7";
const FOOTER_RESERVE = 26;
const CELL_PAD = 4;

/** Columns whose values are identifiers or dates: sized to their content, never wrapped. */
const COMPACT_KEYS = new Set(["date", "entry", "code", "number"]);
/** Numeric columns that hold whole-day counts, not money. */
const INTEGER_KEYS = new Set(["days"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Balance-check notes become a plain sentence next to a drawn check mark. */
const BALANCED_NOTES: Record<string, Bilingual> = {
  "balance-sheet": {
    en: "Assets equal liabilities and equity",
    ar: "الأصول تساوي الالتزامات وحقوق الملكية",
  },
  "trial-balance": { en: "Debits equal credits", ar: "المدين يساوي الدائن" },
};

function pair(company: RenderCompany, text: Bilingual): [string, string] {
  return company.locale === "ar" ? [text.ar, text.en] : [text.en, text.ar];
}

function hairline(doc: PdfDoc, y: number, color = HAIRLINE): void {
  const width = doc.page.width - PAGE_MARGIN * 2;
  doc
    .save()
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + width, y)
    .strokeColor(color)
    .stroke()
    .restore();
}

function header(doc: PdfDoc, company: RenderCompany, report: RenderedReport): number {
  const width = doc.page.width - PAGE_MARGIN * 2;
  const rtl = company.locale === "ar";
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  doc
    .save()
    .rect(PAGE_MARGIN, PAGE_MARGIN - 14, width, 2)
    .fill(ACCENT)
    .restore();

  const startW = width * 0.56;
  const endW = width * 0.4;
  const sx = rtl ? PAGE_MARGIN + width - startW : PAGE_MARGIN;
  const ex = rtl ? PAGE_MARGIN : PAGE_MARGIN + width - endW;
  let sy = drawText(doc, company.legalName || company.name, {
    x: sx,
    y: PAGE_MARGIN,
    width: startW,
    bold: true,
    size: 14,
    color: INK,
    align: start,
  }).endY;
  const trn = company.trn ? `${rtl ? "الرقم الضريبي" : "TRN"} ${ltr(company.trn)}` : null;
  for (const line of [trn, company.address]) {
    if (!line) continue;
    sy = drawText(doc, line, {
      x: sx,
      y: sy,
      width: startW,
      size: 8,
      color: MUTED,
      align: start,
    }).endY;
  }

  const [primary, secondary] = pair(company, report.title);
  let ey = drawText(doc, primary, {
    x: ex,
    y: PAGE_MARGIN - 2,
    width: endW,
    bold: true,
    size: 18,
    color: INK,
    align: end,
  }).endY;
  ey = drawText(doc, secondary, {
    x: ex,
    y: ey + (rtl ? 3 : -2),
    width: endW,
    size: 13,
    color: MUTED,
    align: end,
  }).endY;
  ey = drawText(doc, report.period, {
    x: ex,
    y: ey + 2,
    width: endW,
    size: 8.5,
    color: MUTED,
    align: end,
  }).endY;
  const y = Math.max(sy, ey) + 10;
  hairline(doc, y);
  return y + 14;
}

/** Printed text of one cell (presentation only; numbers through the shared formatter). */
function cellText(column: RenderColumn, raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number" && column.numeric) {
    return INTEGER_KEYS.has(column.key) ? String(Math.round(raw)) : formatAmount(raw);
  }
  const value = String(raw);
  if (column.key === "date" && ISO_DATE.test(value)) return formatIsoDate(value);
  return value;
}

/**
 * Column widths from the weights, then widened for identifier/date columns so they never wrap
 * (taken from the widest flexible text column).
 */
function columnWidths(doc: PdfDoc, t: RenderTable, width: number): number[] {
  const weights = t.columns.map((c) => c.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * width);
  const flexible = t.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.numeric && !COMPACT_KEYS.has(c.key))
    .sort((a, b) => widths[b.i] - widths[a.i])[0];
  if (!flexible) return widths;
  t.columns.forEach((c, i) => {
    if (!COMPACT_KEYS.has(c.key)) return;
    let need = 0;
    for (const row of t.rows) {
      const v = cellText(c, row.cells[c.key]);
      if (v) need = Math.max(need, measureWidth(doc, v, { size: 8 }));
    }
    const extra = need + 2 * CELL_PAD + 2 - widths[i];
    if (extra > 0 && widths[flexible.i] - extra > width * 0.18) {
      widths[i] += extra;
      widths[flexible.i] -= extra;
    }
  });
  return widths;
}

function table(
  doc: PdfDoc,
  company: RenderCompany,
  report: RenderedReport,
  t: RenderTable,
  startY: number
): number {
  const rtl = company.locale === "ar";
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  const width = doc.page.width - PAGE_MARGIN * 2;
  const widths = columnWidths(doc, t, width);
  // RTL: first column on the right.
  const xs: number[] = [];
  let acc = 0;
  for (const w of widths) {
    xs.push(rtl ? PAGE_MARGIN + width - acc - w : PAGE_MARGIN + acc);
    acc += w;
  }
  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE;
  let y = startY;
  const headHeight =
    Math.max(
      ...t.columns.map((c, i) => {
        const [a, b] = pair(company, c.header);
        const w = widths[i] - 2 * CELL_PAD;
        return (
          measureHeight(doc, a, { size: 7.5, bold: true, width: w }) +
          (b && b !== a ? measureHeight(doc, b, { size: 7, width: w }) - 1 : 0)
        );
      })
    ) + 10;
  const drawHeader = () => {
    doc.save().rect(PAGE_MARGIN, y, width, headHeight).fill(HEAD_FILL).restore();
    t.columns.forEach((c, i) => {
      const [a, b] = pair(company, c.header);
      const align = c.numeric ? end : start;
      const w = widths[i] - 2 * CELL_PAD;
      const r = drawText(doc, a, {
        x: xs[i] + CELL_PAD,
        y: y + 5,
        width: w,
        bold: true,
        size: 7.5,
        color: BODY,
        align,
      });
      if (b && b !== a) {
        drawText(doc, b, {
          x: xs[i] + CELL_PAD,
          y: r.endY - 1,
          width: w,
          size: 7,
          color: MUTED,
          align,
        });
      }
    });
    y += headHeight;
  };
  if (t.title) {
    y =
      drawText(doc, label(company.locale, t.title), {
        x: PAGE_MARGIN,
        y,
        width,
        bold: true,
        size: 10,
        color: ACCENT,
        align: start,
      }).endY + 4;
  }
  drawHeader();
  for (const row of t.rows) {
    const bold = row.style === "heading" || row.style === "subtotal" || row.style === "total";
    const cells = t.columns.map((c, i) => {
      const value = cellText(c, row.cells[c.key]);
      const singleLine = !!c.numeric || COMPACT_KEYS.has(c.key);
      const h = value
        ? singleLine
          ? 8 * 1.35
          : measureHeight(doc, value, { size: 8, bold, width: widths[i] - 2 * CELL_PAD })
        : 0;
      return { c, i, value, singleLine, h };
    });
    const rowHeight = Math.max(14, ...cells.map((x) => x.h)) + 5;
    // P15: a section heading keeps with its first row; never orphaned at a page foot.
    const keepWithNext = row.style === "heading" ? Math.max(rowHeight, 24) + 4 : 0;
    if (y + rowHeight + keepWithNext > bottom) {
      doc.addPage();
      y = header(doc, company, report);
      drawHeader();
    }
    if (row.style === "total") hairline(doc, y, INK);
    for (const { c, i, value, singleLine } of cells) {
      if (!value) continue;
      drawText(doc, value, {
        x: xs[i] + CELL_PAD,
        y: y + 3,
        width: widths[i] - 2 * CELL_PAD,
        bold,
        size: 8,
        color: row.style === "heading" ? INK : BODY,
        singleLine,
        align: c.numeric ? end : start,
      });
    }
    y += rowHeight;
    if (row.style !== "total") hairline(doc, y, ROW_RULE);
  }
  return y + 12;
}

/** A small drawn check mark (no glyph dependency) followed by `text`. */
function balancedNote(doc: PdfDoc, company: RenderCompany, text: Bilingual, y: number): number {
  const rtl = company.locale === "ar";
  const width = doc.page.width - PAGE_MARGIN * 2;
  const [a, b] = pair(company, text);
  const sentence = `${a}  ·  ${b}`;
  const textW = measureWidth(doc, sentence, { size: 8 });
  const markX = rtl ? PAGE_MARGIN + width - 9 : PAGE_MARGIN;
  doc
    .save()
    .lineWidth(1.2)
    .strokeColor(ACCENT)
    .moveTo(markX + 1, y + 5.5)
    .lineTo(markX + 3.5, y + 8)
    .lineTo(markX + 8, y + 2.5)
    .stroke()
    .restore();
  return drawText(doc, sentence, {
    x: rtl ? PAGE_MARGIN + width - 13 - textW : PAGE_MARGIN + 13,
    y,
    width: textW + 1,
    size: 8,
    color: BODY,
    singleLine: true,
  }).endY;
}

/** One PDF; every report starts on a new page. */
export function buildReportPdf(company: RenderCompany, reports: RenderedReport[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: PAGE_MARGIN,
        bufferPages: true,
        autoFirstPage: false,
        info: { Creator: "Muhasib.ai", Author: company.name },
      });
      preparePdfDocument(doc);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const rtl = company.locale === "ar";
      const width = () => doc.page.width - PAGE_MARGIN * 2;
      for (const report of reports) {
        doc.addPage();
        let y = header(doc, company, report);
        for (const t of report.tables) y = table(doc, company, report, t, y);
        for (const note of report.notes) {
          if (y > doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - 20) {
            doc.addPage();
            y = header(doc, company, report);
          }
          const balanced = note.en === "Balanced." ? BALANCED_NOTES[report.id] : undefined;
          if (balanced) {
            y = balancedNote(doc, company, balanced, y) + 4;
            continue;
          }
          y =
            drawText(doc, label(company.locale, note), {
              x: PAGE_MARGIN,
              y,
              width: width(),
              size: 8,
              color: MUTED,
              align: rtl ? "right" : "left",
            }).endY + 2;
        }
      }
      if (reports.length === 0) doc.addPage();
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - PAGE_MARGIN - 12;
        hairline(doc, fy);
        drawText(doc, rtl ? "أُنشئ باستخدام Muhasib.ai" : "Generated with Muhasib.ai", {
          x: PAGE_MARGIN,
          y: fy + 5,
          width: width(),
          size: 7,
          color: MUTED,
          align: rtl ? "right" : "left",
          singleLine: true,
        });
        drawText(doc, rtl ? `صفحة ${i + 1} من ${range.count}` : `Page ${i + 1} of ${range.count}`, {
          x: PAGE_MARGIN,
          y: fy + 5,
          width: width(),
          size: 7,
          color: MUTED,
          align: rtl ? "left" : "right",
          singleLine: true,
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

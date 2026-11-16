/**
 * RenderedReport[] → branded PDF (PDFKit + server/services/pdf-fonts for Arabic shaping,
 * bidi and RTL alignment). An ar-locale company gets Arabic-first titles and headers.
 */
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { preparePdfDocument, text as drawText, type PdfDoc } from "../pdf-fonts";
import {
  bilingualLabel,
  formatAmount,
  label,
  type RenderCompany,
  type RenderTable,
  type RenderedReport,
} from "./model";

const BRAND = "#0F172A";
const MUTED = "#475569";
const RULE = "#CBD5E1";
const PAGE_MARGIN = 40;

function header(doc: PdfDoc, company: RenderCompany, report: RenderedReport): number {
  const width = doc.page.width - PAGE_MARGIN * 2;
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  doc.fillColor(BRAND);
  const rtl = company.locale === "ar";
  let y = PAGE_MARGIN - 10;
  y = drawText(doc, company.legalName || company.name, {
    x: PAGE_MARGIN,
    y,
    width,
    bold: true,
    size: 13,
    align: rtl ? "right" : "left",
  }).endY;
  const meta = [company.trn ? `TRN ${company.trn}` : null, company.address]
    .filter(Boolean)
    .join(" · ");
  if (meta) {
    y = drawText(doc, meta, {
      x: PAGE_MARGIN,
      y,
      width,
      size: 8,
      color: MUTED,
      align: rtl ? "right" : "left",
    }).endY;
  }
  doc.fillColor(BRAND);
  y = drawText(doc, bilingualLabel(company.locale, report.title), {
    x: PAGE_MARGIN,
    y: y + 6,
    width,
    bold: true,
    size: 15,
    align: rtl ? "right" : "left",
  }).endY;
  y = drawText(doc, report.period, {
    x: PAGE_MARGIN,
    y,
    width,
    size: 9,
    color: MUTED,
    align: rtl ? "right" : "left",
  }).endY;
  doc
    .moveTo(PAGE_MARGIN, y + 4)
    .lineTo(PAGE_MARGIN + width, y + 4)
    .strokeColor(RULE)
    .stroke();
  doc.fillColor("#000000");
  return y + 12;
}

function table(
  doc: PdfDoc,
  company: RenderCompany,
  report: RenderedReport,
  t: RenderTable,
  startY: number
): number {
  const rtl = company.locale === "ar";
  const width = doc.page.width - PAGE_MARGIN * 2;
  const weights = t.columns.map((c) => c.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * width);
  // RTL: first column on the right.
  const xs: number[] = [];
  let acc = 0;
  for (const w of widths) {
    xs.push(rtl ? PAGE_MARGIN + width - acc - w : PAGE_MARGIN + acc);
    acc += w;
  }
  const bottom = doc.page.height - PAGE_MARGIN - 20;
  let y = startY;
  const drawHeader = () => {
    doc.rect(PAGE_MARGIN, y - 2, width, 16).fill("#F1F5F9");
    doc.fillColor(BRAND);
    t.columns.forEach((c, i) => {
      drawText(doc, label(company.locale, c.header), {
        x: xs[i] + 2,
        y,
        width: widths[i] - 4,
        bold: true,
        size: 8,
        singleLine: true,
        align: c.numeric ? (rtl ? "left" : "right") : rtl ? "right" : "left",
      });
    });
    y += 16;
  };
  if (t.title) {
    y =
      drawText(doc, label(company.locale, t.title), {
        x: PAGE_MARGIN,
        y,
        width,
        bold: true,
        size: 10,
        align: rtl ? "right" : "left",
      }).endY + 2;
  }
  drawHeader();
  for (const row of t.rows) {
    if (y > bottom) {
      doc.addPage();
      y = header(doc, company, report);
      drawHeader();
    }
    const bold = row.style === "heading" || row.style === "subtotal" || row.style === "total";
    if (row.style === "total") {
      doc
        .moveTo(PAGE_MARGIN, y - 1)
        .lineTo(PAGE_MARGIN + width, y - 1)
        .strokeColor(RULE)
        .stroke();
    }
    doc.fillColor("#000000");
    let rowHeight = 12;
    t.columns.forEach((c, i) => {
      const raw = row.cells[c.key];
      if (raw === null || raw === undefined || raw === "") return;
      const value = typeof raw === "number" && c.numeric ? formatAmount(raw) : String(raw);
      const r = drawText(doc, value, {
        x: xs[i] + 2,
        y,
        width: widths[i] - 4,
        bold,
        size: 8,
        singleLine: !!c.numeric,
        align: c.numeric ? (rtl ? "left" : "right") : rtl ? "right" : "left",
      });
      rowHeight = Math.max(rowHeight, r.height);
    });
    y += rowHeight + 1;
  }
  return y + 8;
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
          if (y > doc.page.height - PAGE_MARGIN - 30) {
            doc.addPage();
            y = header(doc, company, report);
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
        drawText(doc, `Muhasib.ai · ${i + 1}/${range.count}`, {
          x: PAGE_MARGIN,
          y: doc.page.height - PAGE_MARGIN + 6,
          width: width(),
          size: 7,
          color: MUTED,
          align: "center",
          singleLine: true,
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

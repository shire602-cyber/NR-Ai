/**
 * RenderedReport[] → XLSX (exceljs). Numeric cells stay numeric (#,##0.00), strings are
 * guarded against spreadsheet formula injection, one sheet per report plus an optional
 * "Coverage" sheet that lists reports not rendered server-side.
 */
import ExcelJS from "exceljs";
import { bilingualLabel, label, type RenderCompany, type RenderedReport } from "./model";

const BRAND = "FF0F172A";

function safeSheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[\\/*?:[\]]/g, " ")
      .slice(0, 28)
      .trim() || "Sheet";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 25)} ${n++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function guardCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export interface CoverageRow {
  reportId: string;
  name: string;
  status: "rendered" | "open_in_app";
  basis: string;
  link: string | null;
}

export async function buildReportWorkbook(
  company: RenderCompany,
  reports: RenderedReport[],
  opts: { title: string; coverage?: CoverageRow[] }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Muhasib.ai";
  wb.created = new Date();
  wb.title = opts.title;
  wb.company = company.name;
  const used = new Set<string>();
  const loc = company.locale;

  for (const report of reports) {
    const ws = wb.addWorksheet(safeSheetName(report.title.en, used), {
      views: [{ rightToLeft: loc === "ar" }],
    });
    ws.addRow([guardCell(company.legalName || company.name)]).font = { bold: true, size: 13 };
    ws.addRow([guardCell(bilingualLabel(loc, report.title))]).font = { bold: true, size: 12 };
    ws.addRow([guardCell(report.period), company.trn ? guardCell(`TRN ${company.trn}`) : null]);
    ws.addRow([]);
    let widest = 0;
    for (const table of report.tables) {
      if (table.title) ws.addRow([guardCell(label(loc, table.title))]).font = { bold: true };
      const header = ws.addRow(table.columns.map((c) => label(loc, c.header)));
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
      });
      widest = Math.max(widest, table.columns.length);
      for (const row of table.rows) {
        const r = ws.addRow(table.columns.map((c) => guardCell(row.cells[c.key])));
        table.columns.forEach((c, i) => {
          const cell = r.getCell(i + 1);
          if (c.numeric && typeof cell.value === "number") cell.numFmt = "#,##0.00";
        });
        if (row.style && row.style !== "normal") r.font = { bold: true };
      }
      ws.addRow([]);
    }
    for (const note of report.notes)
      ws.addRow([guardCell(label(loc, note))]).font = { italic: true };
    for (let i = 1; i <= Math.max(widest, 2); i += 1) {
      ws.getColumn(i).width = i === 1 ? 16 : i === 2 ? 40 : 18;
    }
  }

  if (opts.coverage?.length) {
    const ws = wb.addWorksheet(safeSheetName("Coverage", used));
    const header = ws.addRow(["Report", "Status", "Data basis", "Open in app"]);
    header.font = { bold: true };
    for (const c of opts.coverage) {
      ws.addRow([
        guardCell(c.name),
        c.status === "rendered" ? "Included in this pack" : "Indicator report: open in app",
        guardCell(c.basis),
        guardCell(c.link),
      ]);
    }
    ws.getColumn(1).width = 36;
    ws.getColumn(2).width = 34;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 60;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

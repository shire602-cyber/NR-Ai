import ExcelJS from "exceljs";

import {
  computeCtLiability,
  computeCtTotals,
  parseCtPasteRows,
  type CtWorkpaperRow,
} from "../../shared/ct-workpaper";
import type { Company, CorporateTaxReturn } from "../../shared/schema";

const BRAND_COLOR = "FF0F172A";
const HEADER_FONT_COLOR = "FFFFFFFF";
const ZEBRA_COLOR = "FFF8FAFC";
const SECTION_COLOR = "FFE6F1EC";
const TOTAL_COLOR = "FFF7EFDA";
const AED_FMT = '"AED" #,##0.00;[Red]-"AED" #,##0.00';

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E293B" } } };
  });
}

function addTitleBlock(
  sheet: ExcelJS.Worksheet,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null,
  subtitle: string,
  width: number
): void {
  const title = sheet.addRow([`Muhasib.ai — ${subtitle}`]);
  title.getCell(1).font = { name: "Calibri", size: 15, bold: true };
  sheet.mergeCells(title.number, 1, title.number, width);

  const meta: string[][] = [
    ["Company", company?.name ?? "—", "TRN", company?.trnVatNumber ?? "—"],
    [
      "Tax period",
      `${isoDate(ctReturn.taxPeriodStart)} → ${isoDate(ctReturn.taxPeriodEnd)}`,
      "Status",
      String(ctReturn.status),
    ],
    ["Generated", new Date().toISOString().slice(0, 16).replace("T", " "), "", ""],
  ];
  for (const line of meta) {
    const row = sheet.addRow(line);
    row.getCell(1).font = { name: "Calibri", size: 10, bold: true };
    row.getCell(3).font = { name: "Calibri", size: 10, bold: true };
    row.getCell(2).font = { name: "Calibri", size: 10 };
    row.getCell(4).font = { name: "Calibri", size: 10 };
  }
  sheet.addRow([]);
}

function workpaperRows(ctReturn: CorporateTaxReturn): CtWorkpaperRow[] {
  const workpaper = ctReturn.workpaper as { rows?: CtWorkpaperRow[] } | null;
  return Array.isArray(workpaper?.rows) ? workpaper.rows : [];
}

function addWorkpaperSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("CT Workpaper", { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { key: "type", width: 12 },
    { key: "label", width: 44 },
    { key: "amount", width: 18 },
    { key: "notes", width: 36 },
  ];

  addTitleBlock(sheet, ctReturn, company, "Corporate Tax Workpaper", 4);

  const headerRow = sheet.addRow(["Type", "Line item", "Amount (AED)", "Notes"]);
  styleHeaderRow(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  const rows = workpaperRows(ctReturn);
  for (const section of ["revenue", "expense"] as const) {
    const sectionRows = rows.filter((row) => row.type === section);
    const sectionHeader = sheet.addRow([section === "revenue" ? "Revenue" : "Expenses"]);
    sheet.mergeCells(sectionHeader.number, 1, sectionHeader.number, 4);
    sectionHeader.getCell(1).font = { name: "Calibri", size: 10, bold: true };
    sectionHeader.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SECTION_COLOR },
    };
    sectionHeader.getCell(1).alignment = { vertical: "middle", indent: 1 };

    sectionRows.forEach((row, idx) => {
      const dataRow = sheet.addRow([
        section === "revenue" ? "Revenue" : "Expense",
        row.label,
        money(row.amount),
        row.notes ?? "",
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: "Calibri", size: 11 };
        cell.alignment = { vertical: "middle", indent: 1 };
        if (idx % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_COLOR } };
        }
        if (colNumber === 3) {
          cell.numFmt = AED_FMT;
          cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
        }
      });
    });

    const subtotal = sectionRows.reduce((sum, row) => sum + money(row.amount), 0);
    const subtotalRow = sheet.addRow([
      "",
      section === "revenue" ? "Total revenue" : "Total expenses",
      money(subtotal),
      "",
    ]);
    subtotalRow.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.border = { top: { style: "thin", color: { argb: "FF1E293B" } } };
      if (colNumber === 3) {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
    });
  }

  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
}

function addComputationSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("CT Computation", { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { key: "label", width: 46 },
    { key: "amount", width: 20 },
  ];

  addTitleBlock(sheet, ctReturn, company, "Corporate Tax Computation (copy-ready)", 2);

  const headerRow = sheet.addRow(["Item", "Amount (AED)"]);
  styleHeaderRow(headerRow);

  // Prefer the persisted bridge (full FDL 47/2022 schedule: add-backs, small
  // business relief, loss carryforward) when the return has been computed;
  // fall back to the simple liability formula for legacy returns.
  const computation = (ctReturn.workpaper as any)?.computation as
    | { bridge?: Array<{ label: string; amount: number }>; taxRate?: number }
    | undefined;

  let lines: Array<[string, number | string, boolean?]>;
  if (computation?.bridge?.length) {
    const emphasizedLabels = /taxable income$|corporate tax payable/i;
    lines = computation.bridge.map(
      (line) =>
        [line.label, line.amount, emphasizedLabels.test(line.label)] as [string, number, boolean]
    );
    lines.splice(lines.length - 1, 0, [
      "Corporate tax rate",
      `${((computation.taxRate ?? Number(ctReturn.taxRate ?? 0.09)) * 100).toFixed(0)}%`,
    ]);
  } else {
    const liability = computeCtLiability({
      totalRevenue: money(ctReturn.totalRevenue),
      totalExpenses: money(ctReturn.totalExpenses),
      totalDeductions: money(ctReturn.totalDeductions),
      exemptionThreshold: money(ctReturn.exemptionThreshold),
      taxRate: Number(ctReturn.taxRate ?? 0.09),
    });
    lines = [
      ["Total revenue", money(ctReturn.totalRevenue)],
      ["Total expenses", money(ctReturn.totalExpenses)],
      ["Accounting profit / (loss)", money(ctReturn.totalRevenue) - money(ctReturn.totalExpenses)],
      ["Deductions / adjustments", money(ctReturn.totalDeductions)],
      ["Taxable income", liability.taxableIncome, true],
      ["Small-business relief threshold", liability.exemptionThreshold],
      ["Income above threshold", liability.taxableAmount],
      [`Corporate tax rate`, `${(liability.taxRate * 100).toFixed(0)}%`],
      ["Corporate tax payable", liability.taxPayable, true],
    ];
  }

  if (ctReturn.relatedPartyNotes) {
    lines.push(["Related-party / transfer-pricing notes", ctReturn.relatedPartyNotes]);
  }

  for (const [label, amount, emphasized] of lines) {
    const row = sheet.addRow([label, amount]);
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: emphasized === true };
      cell.alignment = { vertical: "middle", indent: 1 };
      if (emphasized) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
      }
      if (colNumber === 2 && typeof cell.value === "number") {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
    });
  }

  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.fitToPage = true;
}

/** Downloadable Excel copy of a corporate-tax return: workpaper + computation. */
export async function buildCtReturnWorkbook(
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.title = "Muhasib Corporate Tax Workpaper";
  workbook.company = "Muhasib.ai";

  addWorkpaperSheet(workbook, ctReturn, company);
  addComputationSheet(workbook, ctReturn, company);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// Headers must round-trip through parseCtPasteRows (shared/ct-workpaper.ts).
const TEMPLATE_HEADERS = ["type", "label", "amount", "notes"];
const TEMPLATE_EXAMPLES: string[][] = [
  ["revenue", "Product sales", "450000.00", "Core trading income"],
  ["revenue", "Service income", "120000.00", ""],
  ["expense", "Salaries and wages", "210000.00", "Incl. WPS payroll"],
  ["expense", "Rent", "60000.00", ""],
];

/** Blank CT workpaper template whose rows paste/import back losslessly. */
export async function buildCtTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.title = "Muhasib CT Workpaper Template";

  const sheet = workbook.addWorksheet("CT Rows", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 10),
  }));
  styleHeaderRow(sheet.getRow(1));
  for (const example of TEMPLATE_EXAMPLES) {
    const row = sheet.addRow(example);
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF64748B" } };
      cell.alignment = { vertical: "middle", indent: 1 };
    });
  }

  const reference = workbook.addWorksheet("Types");
  reference.columns = [
    { header: "Type", key: "type", width: 14 },
    { header: "Meaning", key: "meaning", width: 44 },
  ];
  styleHeaderRow(reference.getRow(1));
  reference.addRow(["revenue", "Income lines (also accepts income/sales)"]);
  reference.addRow(["expense", "Deductible expense lines (default for unknown types)"]);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

function workbookCellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value)
      return workbookCellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value) {
      return (value as { richText: Array<{ text: string }> }).richText
        .map((part) => part.text)
        .join("");
    }
    if ("text" in value) return String((value as { text: string }).text);
    return String(value);
  }
  return String(value);
}

/** Reads an uploaded .xlsx and runs its first sheet through the shared parser. */
export async function parseCtWorkbookRows(buffer: Buffer): Promise<CtWorkpaperRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const lines: string[] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(workbookCellText(cell.value).replace(/\t/g, " "));
    });
    lines.push(cells.join("\t"));
  });

  return parseCtPasteRows(lines.join("\n"));
}

export function ctReturnExportFilename(
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name"> | null
): string {
  const slug = (company?.name ?? "company")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `ct-workpaper-${slug}-${isoDate(ctReturn.taxPeriodEnd) || "period"}.xlsx`;
}

export { computeCtTotals };

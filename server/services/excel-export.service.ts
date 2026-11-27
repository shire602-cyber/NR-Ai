import { todayDubai } from "@shared/accounting-date";
import ExcelJS from "exceljs";

// One row in the OCR / receipt Excel export. Field names match the column
// labels required by the spec: Date, Vendor, Invoice No., Amount, VAT.
export interface OcrExportRow {
  date: string | Date | null | undefined;
  vendor: string | null | undefined;
  invoiceNumber: string | null | undefined;
  amount: number | string | null | undefined;
  vat: number | string | null | undefined;
  currency?: string | null;
}

export interface OcrExportOptions {
  // Sheet title — defaults to "OCR Receipts".
  sheetName?: string;
  // Filename embedded in workbook properties (the HTTP filename is set by the
  // route). Defaults to "Muhasib OCR Export".
  title?: string;
  // Output language for headers, labels, sheet name and sheet direction.
  // Defaults to "en"; "ar" writes Arabic labels and a right-to-left sheet.
  locale?: "en" | "ar";
}

export interface GenericExportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface GenericExportSheet {
  sheetName?: string;
  columns: GenericExportColumn[];
  rows: Record<string, unknown>[];
  /** Right-to-left sheet (Arabic exports). */
  rtl?: boolean;
}

const BRAND_COLOR = "FF0F172A"; // slate-900 — matches Muhasib editorial palette
const HEADER_FONT_COLOR = "FFFFFFFF";
const ZEBRA_COLOR = "FFF8FAFC"; // slate-50

const COLUMN_DEFS: Array<{ key: keyof OcrExportRow; width: number }> = [
  { key: "date", width: 14 },
  { key: "vendor", width: 32 },
  { key: "invoiceNumber", width: 22 },
  { key: "amount", width: 16 },
  { key: "vat", width: 16 },
];

const RECEIPT_LABELS = {
  en: {
    headers: ["Date", "Vendor", "Invoice No.", "Amount", "VAT"],
    total: "Total",
    sheetNames: {} as Record<string, string>,
    titles: {} as Record<string, string>,
  },
  ar: {
    headers: ["التاريخ", "المورد", "رقم الفاتورة", "المبلغ", "ضريبة القيمة المضافة"],
    total: "الإجمالي",
    sheetNames: { "OCR Receipts": "إيصالات OCR", Receipts: "الإيصالات" } as Record<string, string>,
    titles: {
      "Muhasib OCR Export": "تصدير إيصالات OCR",
      "Muhasib Receipts Export": "تصدير الإيصالات",
    } as Record<string, string>,
  },
};

function rowCurrency(row: OcrExportRow): string {
  return (row.currency || "AED").toUpperCase();
}

const SUM_SCALE = 6; // decimals kept when summing (covers every ISO currency)
const SUM_MAX_ABS = 1e9;

/**
 * Cached result for a SUM() over the given cell values. It must equal what
 * Excel computes over those cells, so values are NOT rounded to the currency's
 * precision (KWD 10.125 + 5.5 = 15.625). They are summed in exact integer
 * micro-units, which removes binary float noise (0.30000000000000004 -> 0.3).
 * Returns undefined (leave the cached result unset; Excel recalculates) if a
 * value cannot be represented safely.
 */
function exactSumResult(values: Array<number | null>): number | undefined {
  let total = 0n;
  for (const v of values) {
    if (v === null) continue;
    if (!Number.isFinite(v) || Math.abs(v) >= SUM_MAX_ABS) return undefined;
    const fixed = Math.abs(v).toFixed(SUM_SCALE).replace(".", "");
    const micro = BigInt(fixed);
    total += v < 0 ? -micro : micro;
  }
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(SUM_SCALE + 1, "0");
  const text = `${neg ? "-" : ""}${digits.slice(0, -SUM_SCALE)}.${digits.slice(-SUM_SCALE)}`;
  return Number(text);
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "UGX",
  "PYG",
  "RWF",
  "XAF",
  "XOF",
  "XPF",
  "KMF",
  "GNF",
  "DJF",
  "VUV",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["KWD", "BHD", "OMR", "JOD", "IQD", "LYD", "TND"]);

/** Display decimals for a currency (display only; stored values are unchanged). */
function currencyDecimals(currency: string): number {
  if (THREE_DECIMAL_CURRENCIES.has(currency)) return 3;
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return 0;
  return 2;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toIsoDateString(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  // Already a YYYY-MM-DD string → keep as-is so locale parsing doesn't shift it.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function buildCurrencyFormat(currency: string): string {
  // ExcelJS treats numFmt as the raw Excel format code. Quoting the currency
  // literal lets us support AED/USD/EUR alike without breaking on locales.
  const safe = currency.replace(/"/g, "");
  const d = currencyDecimals(safe.toUpperCase());
  const num = d > 0 ? `#,##0.${"0".repeat(d)}` : "#,##0";
  return `"${safe}" ${num};[Red]-"${safe}" ${num}`;
}

export async function buildOcrReceiptsWorkbook(
  rows: OcrExportRow[],
  options: OcrExportOptions = {}
): Promise<Buffer> {
  const locale = options.locale === "ar" ? "ar" : "en";
  const rtl = locale === "ar";
  const labels = RECEIPT_LABELS[locale];

  // A single total over mixed currencies is meaningless (no FX here), so with
  // more than one currency the rows are grouped (stable, first-appearance order)
  // and each group gets its own total row.
  const currencyOrder: string[] = [];
  for (const row of rows) {
    const c = rowCurrency(row);
    if (!currencyOrder.includes(c)) currencyOrder.push(c);
  }
  if (currencyOrder.length > 1) {
    rows = [...rows].sort(
      (a, b) => currencyOrder.indexOf(rowCurrency(a)) - currencyOrder.indexOf(rowCurrency(b))
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.lastModifiedBy = "Muhasib.ai";
  workbook.created = new Date();
  workbook.modified = new Date();
  const baseTitle = options.title ?? "Muhasib OCR Export";
  workbook.title = labels.titles[baseTitle] ?? baseTitle;
  workbook.company = "Muhasib.ai";

  const baseSheetName = options.sheetName ?? "OCR Receipts";
  const sheetName = (labels.sheetNames[baseSheetName] ?? baseSheetName).slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: rtl }],
    properties: { defaultRowHeight: 18 },
  });

  sheet.columns = COLUMN_DEFS.map((c, i) => ({
    header: labels.headers[i],
    key: c.key as string,
    width: c.width,
  }));

  // ─── Header row ─────────────────────────────────────────────
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: "middle", horizontal: rtl ? "right" : "left", indent: 1 };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF1E293B" } },
    };
  });

  // ─── Data rows ──────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const currencyFmt = buildCurrencyFormat(rowCurrency(row));
    const amount = toNumber(row.amount);
    const vat = toNumber(row.vat);

    const dataRow = sheet.addRow({
      date: toIsoDateString(row.date),
      vendor: row.vendor ?? "",
      invoiceNumber: row.invoiceNumber ?? "",
      amount: amount,
      vat: vat,
    });

    const rowNumber = dataRow.number;
    const isZebra = idx % 2 === 1;

    dataRow.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = { vertical: "middle", indent: 1 };
      if (isZebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_COLOR } };
      }
      // Amount + VAT columns get currency formatting and right alignment.
      if (colNumber === 4 || colNumber === 5) {
        cell.numFmt = currencyFmt;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
      // Invoice No. uses a monospaced look-alike via right alignment for digits.
      if (colNumber === 3) {
        cell.alignment = { vertical: "middle", horizontal: rtl ? "right" : "left", indent: 1 };
      }
    });

    // Suppress label "0" when the row had no numeric value at all (the spec
    // treats missing → blank rather than zero).
    if (amount === null) dataRow.getCell(4).value = null;
    if (vat === null) dataRow.getCell(5).value = null;

    // Row number used to silence the `unused` lint warning.
    void rowNumber;
  });

  // ─── Totals rows (one per currency) ─────────────────────────
  const multiCurrency = currencyOrder.length > 1;
  for (const currency of currencyOrder) {
    const indices: number[] = [];
    rows.forEach((r, idx) => {
      if (rowCurrency(r) === currency) indices.push(idx);
    });
    const first = indices[0] + 2;
    const last = indices[indices.length - 1] + 2;
    const group = indices.map((i) => rows[i]);
    const amountSum = exactSumResult(group.map((r) => toNumber(r.amount)));
    const vatSum = exactSumResult(group.map((r) => toNumber(r.vat)));
    const totalRow = sheet.addRow({
      date: "",
      vendor: "",
      invoiceNumber: multiCurrency ? `${labels.total} (${currency})` : labels.total,
      amount: { formula: `SUM(D${first}:D${last})`, result: amountSum } as ExcelJS.CellFormulaValue,
      vat: { formula: `SUM(E${first}:E${last})`, result: vatSum } as ExcelJS.CellFormulaValue,
    });
    const currencyFmt = buildCurrencyFormat(currency);
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.border = { top: { style: "thin", color: { argb: "FF1E293B" } } };
      if (colNumber === 4 || colNumber === 5) {
        cell.numFmt = currencyFmt;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      } else if (colNumber === 3) {
        cell.alignment = { vertical: "middle", horizontal: rtl ? "left" : "right", indent: 1 };
      } else {
        cell.alignment = { vertical: "middle", indent: 1 };
      }
    });
  }

  // Print / page setup — landscape with fit-to-width for clean PDFs.
  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

export async function buildGenericWorkbook(
  sheets: GenericExportSheet[],
  options: { title?: string } = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.lastModifiedBy = "Muhasib.ai";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = options.title ?? "Muhasib Export";
  workbook.company = "Muhasib.ai";

  sheets.forEach((sourceSheet, index) => {
    const sheet = workbook.addWorksheet(
      safeSheetName(sourceSheet.sheetName || `Sheet ${index + 1}`),
      {
        views: [{ state: "frozen", ySplit: 1, rightToLeft: sourceSheet.rtl === true }],
        properties: { defaultRowHeight: 18 },
      }
    );

    sheet.columns = sourceSheet.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? Math.max(14, Math.min(36, column.header.length + 4)),
    }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR } };
      cell.alignment = {
        vertical: "middle",
        horizontal: sourceSheet.rtl ? "right" : "left",
        indent: 1,
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FF1E293B" } } };
    });

    sourceSheet.rows.forEach((row, rowIndex) => {
      const normalized: Record<string, unknown> = {};
      for (const column of sourceSheet.columns) {
        normalized[column.key] = normalizeGenericCell(row[column.key]);
      }

      const dataRow = sheet.addRow(normalized);
      const isZebra = rowIndex % 2 === 1;
      dataRow.eachCell((cell) => {
        cell.font = { name: "Calibri", size: 11 };
        cell.alignment = { vertical: "middle", indent: 1 };
        if (typeof cell.value === "number") {
          cell.numFmt = "#,##0.00";
          cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
        }
        if (isZebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_COLOR } };
        }
      });
    });

    sheet.pageSetup.orientation = "landscape";
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 0;
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// Maps a saved receipt record (from `storage.getReceipt*`) onto the export row
// shape. The Amount column is tax-EXCLUSIVE: saved receipts store `amount` as
// the net subtotal already, so we use that directly. If a caller supplies only
// `total` (incl. VAT) and `vatAmount`, derive the subtotal from total - VAT.
export function receiptToExportRow(receipt: {
  date?: string | Date | null;
  merchant?: string | null;
  invoiceNumber?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  total?: number | string | null;
  currency?: string | null;
}): OcrExportRow {
  const subtotal = toNumber(receipt.amount);
  const vat = toNumber(receipt.vatAmount);
  const total = toNumber(receipt.total);

  let amount: number | null;
  if (subtotal !== null) {
    amount = subtotal;
  } else if (total !== null && vat !== null) {
    amount = parseFloat((total - vat).toFixed(2));
  } else {
    amount = total;
  }

  return {
    date: receipt.date ?? null,
    vendor: receipt.merchant ?? null,
    invoiceNumber: receipt.invoiceNumber ?? null,
    amount,
    vat: receipt.vatAmount ?? null,
    currency: receipt.currency ?? "AED",
  };
}

// Generate a safe, dated filename. Used by both the OCR and bulk endpoints so
// downloads land with consistent naming.
export function buildExportFilename(prefix = "muhasib-ocr-receipts"): string {
  const stamp = todayDubai();
  return `${prefix}-${stamp}.xlsx`;
}

function safeSheetName(name: string): string {
  const sanitized = name.replace(/[\][:*?/\\]/g, " ").trim();
  return (sanitized || "Sheet").slice(0, 31);
}

/**
 * R11-10: report exports historically formatted money with toFixed(2), which
 * wrote "112200.00" as a TEXT cell that Excel cannot sum. A string that is a
 * plain 2-decimal amount (optionally negative, no grouping) is written as a
 * number. Codes such as "1020" or "0012" have no decimals and stay text;
 * percentages ("12.50%") and anything else stay text too.
 */
const MONEY_STRING = /^-?\d{1,15}\.\d{2}$/;

export function normalizeGenericCell(value: unknown): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (MONEY_STRING.test(trimmed)) return Number(trimmed);
    return value;
  }
  return String(value);
}

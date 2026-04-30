import ExcelJS from 'exceljs';

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
}

const BRAND_COLOR = 'FF0F172A'; // slate-900 — matches Muhasib editorial palette
const HEADER_FONT_COLOR = 'FFFFFFFF';
const ZEBRA_COLOR = 'FFF8FAFC'; // slate-50

const COLUMNS: Array<{ header: string; key: keyof OcrExportRow; width: number }> = [
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Vendor', key: 'vendor', width: 32 },
  { header: 'Invoice No.', key: 'invoiceNumber', width: 22 },
  { header: 'Amount', key: 'amount', width: 16 },
  { header: 'VAT', key: 'vat', width: 16 },
];

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toIsoDateString(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  // Already a YYYY-MM-DD string → keep as-is so locale parsing doesn't shift it.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function buildCurrencyFormat(currency: string): string {
  // ExcelJS treats numFmt as the raw Excel format code. Quoting the currency
  // literal lets us support AED/USD/EUR alike without breaking on locales.
  const safe = currency.replace(/"/g, '');
  return `"${safe}" #,##0.00;[Red]-"${safe}" #,##0.00`;
}

export async function buildOcrReceiptsWorkbook(
  rows: OcrExportRow[],
  options: OcrExportOptions = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Muhasib.ai';
  workbook.lastModifiedBy = 'Muhasib.ai';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = options.title ?? 'Muhasib OCR Export';
  workbook.company = 'Muhasib.ai';

  const sheetName = (options.sheetName ?? 'OCR Receipts').slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });

  sheet.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key as string,
    width: c.width,
  }));

  // ─── Header row ─────────────────────────────────────────────
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF1E293B' } },
    };
  });

  // ─── Data rows ──────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const currency = (row.currency || 'AED').toUpperCase();
    const currencyFmt = buildCurrencyFormat(currency);
    const amount = toNumber(row.amount);
    const vat = toNumber(row.vat);

    const dataRow = sheet.addRow({
      date: toIsoDateString(row.date),
      vendor: row.vendor ?? '',
      invoiceNumber: row.invoiceNumber ?? '',
      amount: amount,
      vat: vat,
    });

    const rowNumber = dataRow.number;
    const isZebra = idx % 2 === 1;

    dataRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = { vertical: 'middle', indent: 1 };
      if (isZebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_COLOR } };
      }
      // Amount + VAT columns get currency formatting and right alignment.
      if (colNumber === 4 || colNumber === 5) {
        cell.numFmt = currencyFmt;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      }
      // Invoice No. uses a monospaced look-alike via right alignment for digits.
      if (colNumber === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });

    // Suppress label "0" when the row had no numeric value at all (the spec
    // treats missing → blank rather than zero).
    if (amount === null) dataRow.getCell(4).value = null;
    if (vat === null) dataRow.getCell(5).value = null;

    // Row number used to silence the `unused` lint warning.
    void rowNumber;
  });

  // ─── Totals row ─────────────────────────────────────────────
  if (rows.length > 0) {
    const totalRow = sheet.addRow({
      date: '',
      vendor: '',
      invoiceNumber: 'Total',
      amount: { formula: `SUM(D2:D${rows.length + 1})` },
      vat: { formula: `SUM(E2:E${rows.length + 1})` },
    });
    const currencyFmt = buildCurrencyFormat((rows[0]?.currency || 'AED').toUpperCase());
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11, bold: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FF1E293B' } } };
      if (colNumber === 4 || colNumber === 5) {
        cell.numFmt = currencyFmt;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else if (colNumber === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else {
        cell.alignment = { vertical: 'middle', indent: 1 };
      }
    });
  }

  // Print / page setup — landscape with fit-to-width for clean PDFs.
  sheet.pageSetup.orientation = 'landscape';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;

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
    currency: receipt.currency ?? 'AED',
  };
}

// Generate a safe, dated filename. Used by both the OCR and bulk endpoints so
// downloads land with consistent naming.
export function buildExportFilename(prefix = 'muhasib-ocr-receipts'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}-${stamp}.xlsx`;
}

import ExcelJS from 'exceljs';

import { parseVatPasteRows, type ParsedVatPasteRow } from '../../shared/vat-workpaper-grid';
import type { getVatWorkpaperDetail } from './firm-vat-workspace.service';

type WorkpaperDetail = Awaited<ReturnType<typeof getVatWorkpaperDetail>>;
type WorkpaperRow = WorkpaperDetail['rows'][number];

const BRAND_COLOR = 'FF0F172A'; // header fill — matches the OCR export styling
const HEADER_FONT_COLOR = 'FFFFFFFF';
const ZEBRA_COLOR = 'FFF8FAFC';
const SECTION_COLOR = 'FFE6F1EC'; // pale emerald — section dividers
const TOTAL_COLOR = 'FFF7EFDA'; // pale gold — derived totals
const AED_FMT = '"AED" #,##0.00;[Red]-"AED" #,##0.00';

const CATEGORY_LABELS: Record<string, string> = {
  standard_sale: 'Standard-rated sale',
  tourist_refund: 'Tourist refund',
  reverse_charge_output: 'Reverse charge (output)',
  zero_rated_sale: 'Zero-rated sale',
  exempt_sale: 'Exempt sale',
  import: 'Import',
  import_adjustment: 'Import adjustment',
  standard_expense: 'Standard-rated expense',
  reverse_charge_input: 'Reverse charge (input)',
  manual_adjustment: 'Manual adjustment',
};

const EMIRATE_LABELS: Record<string, string> = {
  abu_dhabi: 'Abu Dhabi',
  dubai: 'Dubai',
  sharjah: 'Sharjah',
  ajman: 'Ajman',
  umm_al_quwain: 'Umm Al Quwain',
  ras_al_khaimah: 'Ras Al Khaimah',
  fujairah: 'Fujairah',
};

// VAT 201 rows in FTA order. Each entry pulls amount / VAT / adjustment from
// the totals object computed by calculateVatWorkpaperTotals.
const VAT201_LAYOUT: Array<
  | { section: string }
  | { box: string; label: string; amountKey?: string; vatKey?: string; adjKey?: string; derived?: boolean }
> = [
  { section: 'VAT on sales and all other outputs' },
  { box: '1a', label: 'Standard rated supplies — Abu Dhabi', amountKey: 'box1aAbuDhabiAmount', vatKey: 'box1aAbuDhabiVat', adjKey: 'box1aAbuDhabiAdj' },
  { box: '1b', label: 'Standard rated supplies — Dubai', amountKey: 'box1bDubaiAmount', vatKey: 'box1bDubaiVat', adjKey: 'box1bDubaiAdj' },
  { box: '1c', label: 'Standard rated supplies — Sharjah', amountKey: 'box1cSharjahAmount', vatKey: 'box1cSharjahVat', adjKey: 'box1cSharjahAdj' },
  { box: '1d', label: 'Standard rated supplies — Ajman', amountKey: 'box1dAjmanAmount', vatKey: 'box1dAjmanVat', adjKey: 'box1dAjmanAdj' },
  { box: '1e', label: 'Standard rated supplies — Umm Al Quwain', amountKey: 'box1eUmmAlQuwainAmount', vatKey: 'box1eUmmAlQuwainVat', adjKey: 'box1eUmmAlQuwainAdj' },
  { box: '1f', label: 'Standard rated supplies — Ras Al Khaimah', amountKey: 'box1fRasAlKhaimahAmount', vatKey: 'box1fRasAlKhaimahVat', adjKey: 'box1fRasAlKhaimahAdj' },
  { box: '1g', label: 'Standard rated supplies — Fujairah', amountKey: 'box1gFujairahAmount', vatKey: 'box1gFujairahVat', adjKey: 'box1gFujairahAdj' },
  { box: '2', label: 'Tax refunds provided to tourists', amountKey: 'box2TouristRefundAmount', vatKey: 'box2TouristRefundVat' },
  { box: '3', label: 'Supplies subject to the reverse charge', amountKey: 'box3ReverseChargeAmount', vatKey: 'box3ReverseChargeVat' },
  { box: '4', label: 'Zero rated supplies', amountKey: 'box4ZeroRatedAmount' },
  { box: '5', label: 'Exempt supplies', amountKey: 'box5ExemptAmount' },
  { box: '6', label: 'Goods imported into the UAE', amountKey: 'box6ImportsAmount', vatKey: 'box6ImportsVat' },
  { box: '7', label: 'Adjustments to goods imported', amountKey: 'box7ImportsAdjAmount', vatKey: 'box7ImportsAdjVat' },
  { box: '8', label: 'Totals — outputs', amountKey: 'box8TotalAmount', vatKey: 'box8TotalVat', adjKey: 'box8TotalAdj', derived: true },
  { section: 'VAT on expenses and all other inputs' },
  { box: '9', label: 'Standard rated expenses', amountKey: 'box9ExpensesAmount', vatKey: 'box9ExpensesVat', adjKey: 'box9ExpensesAdj' },
  { box: '10', label: 'Supplies subject to the reverse charge (input)', amountKey: 'box10ReverseChargeAmount', vatKey: 'box10ReverseChargeVat' },
  { box: '11', label: 'Totals — inputs', amountKey: 'box11TotalAmount', vatKey: 'box11TotalVat', adjKey: 'box11TotalAdj', derived: true },
  { section: 'Net VAT due' },
  { box: '12', label: 'Total value of due tax for the period', vatKey: 'box12TotalDueTax', derived: true },
  { box: '13', label: 'Total value of recoverable tax for the period', vatKey: 'box13RecoverableTax', derived: true },
  { box: '14', label: 'Payable tax for the period', vatKey: 'box14PayableTax', derived: true },
];

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E293B' } } };
  });
}

function addTitleBlock(
  sheet: ExcelJS.Worksheet,
  detail: WorkpaperDetail,
  subtitle: string,
  width: number,
): void {
  const { workpaper, company } = detail;

  const title = sheet.addRow([`Muhasib.ai — ${subtitle}`]);
  title.getCell(1).font = { name: 'Calibri', size: 15, bold: true };
  sheet.mergeCells(title.number, 1, title.number, width);

  const metaLines: string[][] = [
    ['Client', company?.name ?? '—', 'TRN', company?.trnVatNumber ?? '—'],
    ['Period', `${isoDate(workpaper.periodStart)} → ${isoDate(workpaper.periodEnd)}`, 'Due date', isoDate(workpaper.dueDate) || '—'],
    ['Status', String(workpaper.status).replace(/_/g, ' '), 'Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ];
  for (const line of metaLines) {
    const row = sheet.addRow(line);
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
    row.getCell(3).font = { name: 'Calibri', size: 10, bold: true };
    row.getCell(2).font = { name: 'Calibri', size: 10 };
    row.getCell(4).font = { name: 'Calibri', size: 10 };
  }
  sheet.addRow([]);
}

function addWorkpaperSheet(workbook: ExcelJS.Workbook, detail: WorkpaperDetail): void {
  const sheet = workbook.addWorksheet('VAT Workpaper', {
    properties: { defaultRowHeight: 18 },
  });

  sheet.columns = [
    { key: 'invoiceNumber', width: 18 },
    { key: 'documentDate', width: 12 },
    { key: 'counterpartyName', width: 30 },
    { key: 'counterpartyTrn', width: 18 },
    { key: 'emirate', width: 16 },
    { key: 'category', width: 26 },
    { key: 'taxableAmount', width: 16 },
    { key: 'vatAmount', width: 14 },
    { key: 'adjustmentAmount', width: 14 },
    { key: 'grossAmount', width: 16 },
    { key: 'status', width: 10 },
    { key: 'source', width: 10 },
    { key: 'notes', width: 32 },
  ];

  addTitleBlock(sheet, detail, 'VAT Workpaper', 13);

  const headerRow = sheet.addRow([
    'Invoice No.', 'Date', 'Customer / Vendor', 'TRN', 'Emirate', 'Category',
    'Taxable (AED)', 'VAT (AED)', 'Adjustment (AED)', 'Gross (AED)', 'Status', 'Source', 'Notes',
  ]);
  styleHeaderRow(headerRow);
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];

  // Group rows by category in FTA order so the sheet reads like the
  // accountant's familiar sectioned working paper.
  const categoryOrder = Object.keys(CATEGORY_LABELS);
  const sorted = [...detail.rows].sort((a: WorkpaperRow, b: WorkpaperRow) => {
    const byCategory = categoryOrder.indexOf(a.rowCategory) - categoryOrder.indexOf(b.rowCategory);
    if (byCategory !== 0) return byCategory;
    return isoDate(a.documentDate).localeCompare(isoDate(b.documentDate));
  });

  let currentCategory: string | null = null;
  let zebra = 0;
  for (const row of sorted) {
    if (row.rowCategory !== currentCategory) {
      const category: string = row.rowCategory;
      currentCategory = category;
      zebra = 0;
      const sectionRow = sheet.addRow([CATEGORY_LABELS[category] ?? category]);
      sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 13);
      sectionRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
      sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_COLOR } };
      sectionRow.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    }

    const excluded = row.status === 'excluded';
    const dataRow = sheet.addRow([
      row.invoiceNumber ?? '',
      isoDate(row.documentDate),
      row.counterpartyName ?? '',
      row.counterpartyTrn ?? '',
      EMIRATE_LABELS[row.emirate ?? ''] ?? (row.emirate ?? ''),
      CATEGORY_LABELS[row.rowCategory] ?? row.rowCategory,
      money(row.taxableAmount),
      money(row.vatAmount),
      money(row.adjustmentAmount),
      money(row.grossAmount),
      row.status,
      row.sourceMethod,
      row.notes ?? '',
    ]);

    const isZebra = zebra % 2 === 1;
    zebra += 1;
    dataRow.eachCell((cell, colNumber) => {
      cell.font = {
        name: 'Calibri',
        size: 11,
        ...(excluded ? { color: { argb: 'FF94A3B8' }, strike: true } : {}),
      };
      cell.alignment = { vertical: 'middle', indent: 1 };
      if (isZebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_COLOR } };
      }
      if (colNumber >= 7 && colNumber <= 10) {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      }
    });
  }

  // Totals from approved rows only — matches what flows into the VAT 201.
  const approved = detail.rows.filter((row: WorkpaperRow) => row.status === 'approved');
  const totalRow = sheet.addRow([
    '', '', '', '', '',
    'Totals (approved rows)',
    money(approved.reduce((sum: number, row: WorkpaperRow) => sum + money(row.taxableAmount), 0)),
    money(approved.reduce((sum: number, row: WorkpaperRow) => sum + money(row.vatAmount), 0)),
    money(approved.reduce((sum: number, row: WorkpaperRow) => sum + money(row.adjustmentAmount), 0)),
    money(approved.reduce((sum: number, row: WorkpaperRow) => sum + money(row.grossAmount), 0)),
    '', '', '',
  ]);
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FF1E293B' } } };
    if (colNumber >= 7 && colNumber <= 10) {
      cell.numFmt = AED_FMT;
      cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    }
  });

  sheet.pageSetup.orientation = 'landscape';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
}

function addVat201Sheet(workbook: ExcelJS.Workbook, detail: WorkpaperDetail): void {
  const sheet = workbook.addWorksheet('VAT 201', {
    properties: { defaultRowHeight: 18 },
  });

  sheet.columns = [
    { key: 'box', width: 8 },
    { key: 'label', width: 48 },
    { key: 'amount', width: 18 },
    { key: 'vat', width: 18 },
    { key: 'adj', width: 18 },
  ];

  addTitleBlock(sheet, detail, 'VAT 201 Return (copy-ready)', 5);

  const headerRow = sheet.addRow(['Box', 'Description', 'Amount (AED)', 'VAT (AED)', 'Adjustment (AED)']);
  styleHeaderRow(headerRow);

  const totals = detail.totals as Record<string, number>;
  for (const entry of VAT201_LAYOUT) {
    if ('section' in entry) {
      const sectionRow = sheet.addRow([entry.section]);
      sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 5);
      sectionRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
      sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_COLOR } };
      sectionRow.getCell(1).alignment = { vertical: 'middle', indent: 1 };
      continue;
    }

    const row = sheet.addRow([
      entry.box,
      entry.label,
      entry.amountKey ? money(totals[entry.amountKey]) : '',
      entry.vatKey ? money(totals[entry.vatKey]) : '',
      entry.adjKey ? money(totals[entry.adjKey]) : '',
    ]);
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11, bold: entry.derived === true };
      cell.alignment = { vertical: 'middle', indent: 1 };
      if (entry.derived) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_COLOR } };
      }
      if (colNumber >= 3 && typeof cell.value === 'number') {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      }
    });
  }

  sheet.pageSetup.orientation = 'portrait';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
}

/**
 * Builds the downloadable Excel copy of a VAT workpaper: the transaction
 * grid styled like the accountant's familiar working paper, plus a
 * copy-ready VAT 201 sheet — so the platform replaces the Excel file
 * rather than living alongside it.
 */
export async function buildVatWorkpaperWorkbook(detail: WorkpaperDetail): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Muhasib.ai';
  workbook.lastModifiedBy = 'Muhasib.ai';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = 'Muhasib VAT Workpaper';
  workbook.company = 'Muhasib.ai';

  addWorkpaperSheet(workbook, detail);
  addVat201Sheet(workbook, detail);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// Headers must stay in sync with parseVatPasteRows (client/src/lib/
// vat-workpaper-grid.ts) so a filled template pastes straight back into the
// workpaper grid with zero re-mapping.
const TEMPLATE_HEADERS = [
  'invoice number',
  'date',
  'customer/vendor',
  'TRN',
  'emirate',
  'category',
  'taxable amount',
  'VAT amount',
  'gross amount',
  'notes',
];

const TEMPLATE_EXAMPLES: string[][] = [
  ['INV-1001', '2026-05-18', 'Acme LLC', '100123456700003', 'dubai', 'standard sale', '1000.00', '50.00', '1050.00', 'May sale'],
  ['INV-1002', '2026-05-20', 'Export GmbH', '', 'dubai', 'zero rated sale', '2000.00', '0.00', '2000.00', 'Export shipment'],
  ['BILL-77', '2026-05-25', 'Office Supplies Co', '', 'dubai', 'standard expense', '400.00', '20.00', '420.00', 'Stationery'],
];

/**
 * Blank workpaper template for accountants who still prepare rows offline:
 * the header row matches the paste-importer exactly, with worked examples
 * and a category reference sheet.
 */
export async function buildVatWorkpaperTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Muhasib.ai';
  workbook.title = 'Muhasib VAT Workpaper Template';
  workbook.company = 'Muhasib.ai';

  const sheet = workbook.addWorksheet('VAT Rows', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 6),
  }));
  styleHeaderRow(sheet.getRow(1));
  for (const example of TEMPLATE_EXAMPLES) {
    const row = sheet.addRow(example);
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF64748B' } };
      cell.alignment = { vertical: 'middle', indent: 1 };
    });
  }

  const reference = workbook.addWorksheet('Categories');
  reference.columns = [
    { header: 'Category (paste either form)', key: 'value', width: 28 },
    { header: 'Meaning', key: 'label', width: 40 },
  ];
  styleHeaderRow(reference.getRow(1));
  for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
    reference.addRow([value, label]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

function workbookCellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return workbookCellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join('');
    }
    if ('text' in value) return String((value as { text: string }).text);
    return String(value);
  }
  return String(value);
}

/**
 * Reads an uploaded .xlsx workbook and runs its first sheet through the same
 * parser as the paste box — one set of header/category rules for both paths.
 */
export async function parseVatWorkbookRows(
  buffer: Buffer,
  defaultEmirate: string,
): Promise<ParsedVatPasteRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const lines: string[] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(workbookCellText(cell.value).replace(/\t/g, ' '));
    });
    lines.push(cells.join('\t'));
  });

  return parseVatPasteRows(lines.join('\n'), defaultEmirate);
}

export function vatWorkpaperExportFilename(detail: WorkpaperDetail): string {
  const company = (detail.company?.name ?? 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const period = isoDate(detail.workpaper.periodEnd) || 'period';
  return `vat-workpaper-${company}-${period}.xlsx`;
}

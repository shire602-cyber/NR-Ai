import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';

export type SpreadsheetCell = string | number | boolean | Date | null;
export type SpreadsheetRow = Record<string, SpreadsheetCell>;

export interface ParsedSpreadsheet {
  headers: string[];
  rows: SpreadsheetRow[];
  sheetName: string;
}

export interface SpreadsheetColumn {
  header: string;
  key: string;
  width?: number;
}

function normalizeHeader(value: unknown, fallback: string): string {
  const header = String(value ?? '').trim();
  return header || fallback;
}

function normalizeCell(value: ExcelJS.CellValue): SpreadsheetCell {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if ('text' in value && value.text !== undefined) return value.text;
  if ('result' in value && value.result !== undefined) return normalizeCell(value.result);
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  return String(value);
}

function parseCsvBuffer(buffer: Buffer): ParsedSpreadsheet {
  const rows = parseCsv(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as SpreadsheetRow[];

  return {
    headers: Object.keys(rows[0] ?? {}),
    rows,
    sheetName: 'CSV',
  };
}

async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [], sheetName: 'Sheet1' };
  }

  const headerRow = worksheet.getRow(1);
  const columnCount = Math.max(headerRow.cellCount, worksheet.actualColumnCount);
  const headers = Array.from({ length: columnCount }, (_unused, index) => {
    const col = index + 1;
    return normalizeHeader(normalizeCell(headerRow.getCell(col).value), `Column ${col}`);
  });

  const rows: SpreadsheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const item: SpreadsheetRow = {};
    headers.forEach((header, index) => {
      item[header] = normalizeCell(row.getCell(index + 1).value);
    });

    if (Object.values(item).some((value) => value !== '' && value !== null)) {
      rows.push(item);
    }
  });

  return {
    headers,
    rows,
    sheetName: worksheet.name,
  };
}

export async function parseSpreadsheet(
  buffer: Buffer,
  fileName = 'upload.xlsx',
): Promise<ParsedSpreadsheet> {
  if (/\.xls$/i.test(fileName)) {
    throw new Error('Legacy .xls files are not supported. Please save the file as .xlsx or .csv and try again.');
  }

  if (/\.csv$/i.test(fileName)) {
    return parseCsvBuffer(buffer);
  }

  return parseXlsxBuffer(buffer);
}

export async function createSpreadsheetBuffer(options: {
  sheetName: string;
  columns: SpreadsheetColumn[];
  rows: Record<string, SpreadsheetCell>[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(options.sheetName);

  worksheet.columns = options.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 15,
  }));
  worksheet.addRows(options.rows);
  worksheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

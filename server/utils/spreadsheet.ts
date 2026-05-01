import ExcelJS from 'exceljs';

export interface ParsedSpreadsheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
}

export function assertSupportedSpreadsheetName(fileName?: string | null): void {
  if (fileName && /\.xls$/i.test(fileName)) {
    throw new Error('Legacy .xls files are not supported. Please save the file as .xlsx or .csv and try again.');
  }
}

export async function parseSpreadsheetBuffer(
  buffer: Buffer,
  fileName?: string | null,
): Promise<ParsedSpreadsheet> {
  assertSupportedSpreadsheetName(fileName);

  if (fileName && /\.csv$/i.test(fileName)) {
    const rows = parseCsv(buffer.toString('utf8'));
    const headers = rows[0] ?? [];
    return {
      sheetName: 'CSV',
      headers,
      rows: rows.slice(1).map((row) => rowToObject(headers, row)),
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Workbook does not contain any sheets');
  }

  const headers = valuesFromRow(worksheet.getRow(1)).map((value, index) =>
    value ? String(value) : `Column ${index + 1}`,
  );

  const rows: Record<string, any>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = valuesFromRow(row);
    if (values.every((value) => value === '')) return;
    rows.push(rowToObject(headers, values));
  });

  return { sheetName: worksheet.name, headers, rows };
}

export async function buildXlsxBufferFromRows(
  rows: Record<string, any>[],
  sheetName: string,
  widths: number[] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.substring(0, 31) || 'Sheet1');
  const headers = Object.keys(rows[0] ?? {});

  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: widths[index] ?? Math.max(15, header.length + 2),
  }));

  for (const row of rows) {
    worksheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function valuesFromRow(row: ExcelJS.Row): any[] {
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  return values.map(normalizeCellValue);
}

function rowToObject(headers: string[], row: any[]): Record<string, any> {
  const obj: Record<string, any> = {};
  headers.forEach((header, index) => {
    obj[header] = normalizeCellValue(row[index]);
  });
  return obj;
}

function normalizeCellValue(value: any): any {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value) return value.text ?? '';
    if ('result' in value) return value.result ?? '';
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part: any) => part.text ?? '').join('');
    }
    if ('hyperlink' in value && 'text' in value) return value.text ?? value.hyperlink;
  }
  return value;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

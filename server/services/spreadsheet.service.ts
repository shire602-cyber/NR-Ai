import ExcelJS from "exceljs";

export interface ParsedSpreadsheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellToText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("hyperlink" in value && "text" in value && typeof value.text === "string") {
      return value.text;
    }
  }
  return String(value);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function rowsFromGrid(grid: string[][], sheetName = "CSV"): ParsedSpreadsheet {
  const headerRow = grid[0] ?? [];
  const headers = headerRow.map((header, index) => header.trim() || `Column ${index + 1}`);
  const rows = grid.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row;
  });

  return { sheetName, headers, rows };
}

function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export async function parseSpreadsheetBuffer(
  buffer: Buffer,
  options: { fileName?: string } = {}
): Promise<ParsedSpreadsheet> {
  const fileName = options.fileName ?? "";
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".xls")) {
    throw new Error("Legacy .xls files are not supported. Please save the file as .xlsx or CSV.");
  }

  if (lower.endsWith(".csv") || (!looksLikeXlsx(buffer) && !lower.endsWith(".xlsx"))) {
    return rowsFromGrid(parseCsv(buffer.toString("utf8")), fileName || "CSV");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Workbook has no worksheets");
  }

  const headerRow = worksheet.getRow(1);
  const columnCount = Math.max(headerRow.cellCount, worksheet.columnCount);
  const headers: string[] = [];
  for (let column = 1; column <= columnCount; column++) {
    headers.push(cellToText(headerRow.getCell(column).value).trim() || `Column ${column}`);
  }

  const rows: Record<string, string>[] = [];
  worksheet.eachRow({ includeEmpty: false }, (sheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = cellToText(sheetRow.getCell(index + 1).value).trim();
      if (value) hasValue = true;
      row[header] = value;
    });
    if (hasValue) rows.push(row);
  });

  return {
    sheetName: worksheet.name,
    headers,
    rows,
  };
}

export async function buildSpreadsheetBuffer(
  sheetName: string,
  rows: Record<string, string>[],
  columnWidths: number[] = []
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  const headers = Object.keys(rows[0] ?? {});

  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: columnWidths[index] ?? Math.max(15, header.length + 2),
  }));
  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

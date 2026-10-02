/**
 * Reading migration files: CSV (comma, semicolon or tab) and XLSX into rows of
 * plain values, plus the number and date parsers the importers share.
 */
import JSZip from "jszip";
import { parse as parseCsvSync } from "csv-parse/sync";
import { parseSpreadsheet } from "../spreadsheet.service";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
/** An .xlsx is a ZIP: a small file can unpack to gigabytes. Refuse before anything is inflated. */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;

/** Sum of the DECLARED uncompressed sizes of the sheet and string parts; reads only the ZIP directory. */
export async function xlsxUncompressedSize(buffer: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  let total = 0;
  zip.forEach((_path, entry) => {
    if (!entry.dir) total += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  return total;
}

const NUL = /\u0000/g;
/** NUL bytes cannot be stored in Postgres text or jsonb; they are removed on the way in. */
export const stripNul = (s: string): string => s.replace(NUL, "");

export type CellValue = string | number | boolean | Date | null;
export type RawRow = Record<string, CellValue>;

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
}

export class ImportFileError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** The delimiter that splits the header line into the most columns. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export async function parseImportFile(buffer: Buffer, filename: string): Promise<ParsedFile> {
  if (buffer.length === 0) throw new ImportFileError("FILE_EMPTY", "The file is empty");
  if (buffer.length > MAX_IMPORT_BYTES) throw new ImportFileError("FILE_TOO_LARGE", "The file is larger than 5 MB");
  let headers: string[];
  let rows: RawRow[];
  try {
    if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) {
      const text = buffer.toString("utf8");
      rows = parseCsvSync(text, {
        bom: true,
        columns: (h: string[]) => h.map((x, i) => String(x ?? "").trim() || `Column ${i + 1}`),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        delimiter: detectDelimiter(text),
      }) as RawRow[];
      headers = Object.keys(rows[0] ?? {});
      if (rows.length === 0) {
        const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
        headers = first.split(detectDelimiter(text)).map((h) => h.trim()).filter(Boolean);
      }
    } else if (/\.xlsx$/i.test(filename)) {
      let declared: number;
      try {
        declared = await xlsxUncompressedSize(buffer);
      } catch {
        throw new ImportFileError("FILE_UNREADABLE", "The file is not a valid .xlsx workbook");
      }
      if (declared > MAX_XLSX_UNCOMPRESSED_BYTES) {
        throw new ImportFileError("FILE_TOO_LARGE_UNCOMPRESSED", "The workbook is too large once unpacked (over 40 MB). Save the sheet as CSV or split it");
      }
      const parsed = await parseSpreadsheet(buffer, filename);
      headers = parsed.headers;
      rows = parsed.rows as RawRow[];
    } else {
      throw new ImportFileError("FILE_TYPE_UNSUPPORTED", "Only .csv and .xlsx files are supported");
    }
  } catch (err) {
    if (err instanceof ImportFileError) throw err;
    throw new ImportFileError("FILE_UNREADABLE", `The file could not be read: ${err instanceof Error ? err.message : "invalid format"}`);
  }
  // Strip NUL from every header and text cell.
  headers = headers.map(stripNul);
  rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [stripNul(k), typeof v === "string" ? stripNul(v) : v])));
  if (headers.length === 0) throw new ImportFileError("FILE_NO_HEADERS", "The first row must contain column headers");
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportFileError("FILE_TOO_MANY_ROWS", `The file has more than ${MAX_IMPORT_ROWS} rows; split it`);
  return { headers, rows };
}

// ───────────────────────── Headers ─────────────────────────

/** Lower-case, no spaces or punctuation, no leading "*" (Xero marks required columns with it). */
export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/^\*/, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

// ───────────────────────── Values ─────────────────────────

export const cellText = (v: CellValue | undefined): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return stripNul(String(v)).trim();
};

export type NumberFormat = "us" | "eu";

/**
 * "1,234.50", "AED 1 234.50", "(100.00)", "100.00-", "-100" and (eu) "1.234,50" to a number; null when it is not one.
 * Accounting negatives in parentheses or with a trailing minus are honoured.
 */
export function parseNumber(v: CellValue | undefined, format: NumberFormat = "us"): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v instanceof Date || typeof v === "boolean") return null;
  let s = String(v).trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[A-Za-z]{3}\s*/, "").replace(/\s*[A-Za-z]{3}$/, "").replace(/[\s ]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^[^\d.,\-+]+/, "");
  if (format === "eu") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export const DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "d MMM yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A calendar day as YYYY-MM-DD in the stated format; Excel dates and serial numbers are accepted too. null when it is not a real date. */
export function parseDate(v: CellValue | undefined, format: DateFormat = "yyyy-MM-dd"): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // exceljs hands back UTC midnight for date cells
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial day count (1900 system)
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return ymd(y, m, d);
  }
  let m: RegExpExecArray | null;
  switch (format) {
    case "dd/MM/yyyy":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return m ? ymd(+m[3], +m[2], +m[1]) : null;
    case "MM/dd/yyyy":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return m ? ymd(+m[3], +m[1], +m[2]) : null;
    case "dd-MM-yyyy":
      m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
      return m ? ymd(+m[3], +m[2], +m[1]) : null;
    case "dd.MM.yyyy":
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
      return m ? ymd(+m[3], +m[2], +m[1]) : null;
    case "d MMM yyyy":
      m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/.exec(s);
      return m && MONTHS.includes(m[2].toLowerCase()) ? ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]) : null;
    default:
      return null;
  }
}

export function parseBoolean(v: CellValue | undefined): boolean | null {
  if (typeof v === "boolean") return v;
  const s = cellText(v).toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(s)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(s)) return false;
  return null;
}

/** Round to fils so the books never see 0.1 + 0.2 style drift. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

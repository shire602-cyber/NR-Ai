/**
 * Bank statement parsing library (no DB, no network).
 *
 * Reads the statement files UAE banks actually export and turns them into one row shape:
 * CSV (comma / semicolon / tab / pipe, BOM, UTF-16, Windows-1256, preamble lines, quoted fields,
 * Arabic headers, Arabic-Indic digits), XLSX (exceljs), MT940, CAMT.053 and OFX.
 *
 * Rules the importer relies on:
 *  - Every output row carries its source `rowIndex`, the `raw` source line, parsed fields and
 *    `errors`. Invalid rows are reported, never dropped silently and never "fixed" by JS Date
 *    overflow.
 *  - Locale ambiguity (decimal comma vs thousands comma, DD/MM vs MM/DD) is surfaced as a warning
 *    with `requiresChoice` instead of a silent guess; callers can pass `decimalSeparator` /
 *    `dateOrder` explicitly.
 *  - `fileFingerprint` is the sha256 of the file bytes, used for idempotent re-imports together
 *    with `planBankImport` (multiset de-duplication that keeps genuinely identical rows).
 */
import { createHash } from "crypto";
import ExcelJS from "exceljs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BankFormatId =
  | "emiratesnbd"
  | "adcb"
  | "fab"
  | "mashreq"
  | "mashreqneo"
  | "rakbank"
  | "cbd"
  | "wio"
  | "generic"
  | "mt940"
  | "camt053"
  | "ofx";

export type BankFileKind = "csv" | "xlsx" | "mt940" | "camt053" | "ofx";
export type DateOrder = "DMY" | "MDY" | "YMD";
export type DecimalSeparator = "." | ",";

/** Zero-based column indexes; `null`/undefined = not mapped. */
export interface ColumnMapping {
  date?: number | null;
  description?: number | null;
  reference?: number | null;
  debit?: number | null;
  credit?: number | null;
  amount?: number | null;
  /** Dr/Cr, Type or indicator column used together with a single `amount` column. */
  direction?: number | null;
  balance?: number | null;
}

export const MAPPING_FIELDS = [
  "date",
  "description",
  "reference",
  "debit",
  "credit",
  "amount",
  "direction",
  "balance",
] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];

export interface ParseOptions {
  kind?: BankFileKind;
  delimiter?: string;
  decimalSeparator?: DecimalSeparator;
  dateOrder?: DateOrder;
  mapping?: ColumnMapping;
  /** Force the format label (bank profile); the mapping is still alias-driven. */
  format?: BankFormatId;
  /** 1-based source row of the header, overriding auto-detection. */
  headerRow?: number;
}

export type ParseWarningCode =
  | "AMBIGUOUS_DATE_ORDER"
  | "MIXED_DATE_ORDER"
  | "DATE_ORDER_DETECTED"
  | "AMBIGUOUS_DECIMAL"
  | "DECIMAL_SEPARATOR_INFERRED"
  | "HEADER_NOT_FOUND"
  | "MAPPING_INCOMPLETE"
  | "PREAMBLE_SKIPPED"
  | "NO_ROWS";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  /** True when the user must pick an option before an import should be trusted. */
  requiresChoice?: boolean;
  options?: string[];
}

export interface ParsedBankRow {
  /** 1-based source row (CSV line / XLSX row / statement entry number). */
  rowIndex: number;
  /** The raw source line (or joined fields) for audit and error display. */
  raw: string;
  date: Date | null;
  description: string;
  /** Absolute values; `amount` is signed (credit positive, debit negative). */
  debit: number;
  credit: number;
  amount: number;
  balance: number | null;
  reference: string | null;
  errors: string[];
}

export interface BankParseResult {
  kind: BankFileKind;
  format: BankFormatId;
  delimiter: string | null;
  decimalSeparator: DecimalSeparator;
  dateOrder: DateOrder | null;
  /** 1-based source row of the header, or null for non-tabular formats. */
  headerRowIndex: number | null;
  headers: string[];
  mapping: ColumnMapping;
  rows: ParsedBankRow[];
  /** Rows deliberately ignored (blank, summary, zero-value) with the reason. */
  ignored: Array<{ rowIndex: number; raw: string; reason: string }>;
  warnings: ParseWarning[];
  fileFingerprint: string;
  accountHint: string | null;
  currency: string | null;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

export function normalizeHeader(value: string): string {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[\ufeff\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[^a-z0-9؀-ۿ]/g, "");
}

export function fingerprintBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Decode statement bytes: UTF-8/16 BOMs, strict UTF-8, then Windows-1256 (Arabic), then latin1. */
export function decodeStatementBytes(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  // UTF-16LE without BOM: every second byte is NUL for Latin text.
  const sample = bytes.subarray(0, Math.min(bytes.length, 200));
  let nulOdd = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) nulOdd++;
  if (sample.length > 8 && nulOdd > sample.length / 4) return bytes.toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // not valid UTF-8
  }
  try {
    return new TextDecoder("windows-1256").decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  يناير: 1,
  فبراير: 2,
  مارس: 3,
  أبريل: 4,
  ابريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  أغسطس: 8,
  اغسطس: 8,
  سبتمبر: 9,
  أكتوبر: 10,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};

function expandYear(raw: string): number {
  const n = parseInt(raw, 10);
  if (raw.length <= 2) return 2000 + n;
  return n;
}

type DateParts =
  | { kind: "ymd"; y: number; m: number; d: number }
  | { kind: "named"; y: number; m: number; d: number }
  | { kind: "numeric"; a: number; b: number; y: number }
  | { kind: "invalid" };

/** Split a date cell into its parts without deciding day/month order for numeric dates. */
function splitDate(raw: string): DateParts {
  const cleaned = normalizeDigits(raw)
    .trim()
    .replace(/[‎‏]/g, "")
    // drop a time portion: "2026-06-01T10:30:00Z", "01/06/2026 14:22:10"
    .replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?\s*(AM|PM)?$/i, "")
    .trim();
  if (!cleaned) return { kind: "invalid" };

  let m = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return { kind: "ymd", y: +m[1], m: +m[2], d: +m[3] };
  m = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { kind: "ymd", y: +m[1], m: +m[2], d: +m[3] };

  m = cleaned.match(/^(\d{1,2})[-/.\s]+(\d{1,2})[-/.\s]+(\d{4}|\d{2})$/);
  if (m) return { kind: "numeric", a: +m[1], b: +m[2], y: expandYear(m[3]) };

  // 1 Jun 2026, 01-Jun-26, 1st June 2026
  m = cleaned.match(
    /^(\d{1,2})(?:st|nd|rd|th)?[-/.\s,]+([A-Za-z؀-ۿ]{3,})\.?[-/.\s,]+(\d{4}|\d{2})$/
  );
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return { kind: "named", y: expandYear(m[3]), m: month, d: +m[1] };
  }
  // Jun 1, 2026
  m = cleaned.match(
    /^([A-Za-z؀-ۿ]{3,})\.?[-/.\s,]+(\d{1,2})(?:st|nd|rd|th)?[-/.\s,]+(\d{4}|\d{2})$/
  );
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return { kind: "named", y: expandYear(m[3]), m: month, d: +m[2] };
  }
  return { kind: "invalid" };
}

/** Strict date parse. Impossible dates (e.g. 11/13/2026 under DD/MM) return an error. */
export function parseStatementDate(
  raw: string,
  order: DateOrder
): { date: Date | null; error?: string } {
  const parts = splitDate(raw);
  if (parts.kind === "invalid") return { date: null, error: `Unrecognised date '${raw.trim()}'` };
  let date: Date | null;
  if (parts.kind === "ymd" || parts.kind === "named") {
    date = utcDate(parts.y, parts.m, parts.d);
  } else if (order === "MDY") {
    date = utcDate(parts.y, parts.a, parts.b);
  } else {
    date = utcDate(parts.y, parts.b, parts.a);
  }
  if (!date) {
    const label = order === "MDY" ? "MM/DD/YYYY" : "DD/MM/YYYY";
    return { date: null, error: `Invalid date '${raw.trim()}' for ${label}` };
  }
  return { date };
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

const DEBIT_WORDS = /(^|[^a-z])(dr|debit|db)([^a-z]|$)|مدين|سحب|خصم/i;
const CREDIT_WORDS = /(^|[^a-z])(cr|credit)([^a-z]|$)|دائن|ايداع|إيداع/i;

export interface AmountCell {
  value: number;
  ok: boolean;
  /** Direction implied by the cell itself (parentheses, minus sign, Dr/Cr suffix). */
  direction: "debit" | "credit" | null;
  empty: boolean;
}

/** Digits-and-separators core of an amount cell, without sign, currency or Dr/Cr marks. */
function amountCore(raw: string): string {
  return normalizeDigits(raw)
    .replace(/[\u00a0\u202f\s']/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/(AED|USD|EUR|GBP|SAR|INR|د\.إ|درهم)/gi, "")
    .replace(/[()]/g, "")
    .replace(/(^|[^a-z])(dr|cr|debit|credit|db)([^a-z]|$)/gi, "$1$3")
    .replace(/[^0-9.,-]/g, "")
    .replace(/-/g, "");
}

export function parseAmountCell(raw: string, decimal: DecimalSeparator): AmountCell {
  const text = normalizeDigits(raw ?? "").trim();
  if (!text) return { value: 0, ok: true, direction: null, empty: true };
  let direction: "debit" | "credit" | null = null;
  const stripped = text.replace(/[\u00a0\u202f\s]/g, "");
  if (stripped.startsWith("(") || /^[-−–—]/.test(stripped) || /[-−–—]$/.test(stripped)) {
    direction = "debit";
  }
  if (DEBIT_WORDS.test(text)) direction = "debit";
  else if (CREDIT_WORDS.test(text)) direction = direction ?? "credit";

  let core = amountCore(text);
  if (!core) return { value: 0, ok: false, direction, empty: false };
  if (decimal === ",") {
    core = core.replace(/\./g, "").replace(",", ".");
  } else {
    core = core.replace(/,/g, "");
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(core)) return { value: 0, ok: false, direction, empty: false };
  return { value: parseFloat(core), ok: true, direction, empty: false };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

interface DecimalEvidence {
  comma: number;
  point: number;
  ambiguous: number;
}

function decimalEvidence(cells: string[]): DecimalEvidence {
  const ev: DecimalEvidence = { comma: 0, point: 0, ambiguous: 0 };
  for (const cell of cells) {
    const core = amountCore(cell);
    if (!core) continue;
    const hasDot = core.includes(".");
    const hasComma = core.includes(",");
    if (hasDot && hasComma) {
      if (core.lastIndexOf(",") > core.lastIndexOf(".")) ev.comma++;
      else ev.point++;
    } else if (hasComma) {
      const commas = core.split(",").length - 1;
      const after = core.length - core.lastIndexOf(",") - 1;
      if (commas > 1) ev.point++;
      else if (after === 3) ev.ambiguous++;
      else ev.comma++;
    } else if (hasDot) {
      const dots = core.split(".").length - 1;
      if (dots > 1) ev.comma++;
      else ev.point++;
    }
  }
  return ev;
}

// ─── Header aliases and bank profiles ────────────────────────────────────────

const ALIASES: Record<MappingField, string[]> = {
  date: [
    "transactiondate",
    "txndate",
    "transdate",
    "postingdate",
    "bookingdate",
    "date",
    "valuedate",
    "valdate",
    "تاريخالعملية",
    "تاريخالمعاملة",
    "تاريخالقيد",
    "تاريخ",
    "تاريخالقيمة",
  ],
  description: [
    "description",
    "transactiondetails",
    "transactiondescription",
    "particulars",
    "narration",
    "narrative",
    "details",
    "remarks",
    "memo",
    "counterparty",
    "payee",
    "merchant",
    "البيان",
    "الوصف",
    "التفاصيل",
    "تفاصيل",
    "شرح",
  ],
  debit: [
    "debit",
    "withdrawal",
    "withdrawals",
    "paidout",
    "moneyout",
    "outflow",
    "dr",
    "مدين",
    "سحب",
    "خصم",
  ],
  credit: [
    "credit",
    "deposit",
    "deposits",
    "paidin",
    "moneyin",
    "inflow",
    "cr",
    "دائن",
    "ايداع",
    "إيداع",
  ],
  amount: ["transactionamount", "amountaed", "amount", "amt", "المبلغ", "مبلغ"],
  direction: [
    "drcr",
    "crdr",
    "debitcredit",
    "creditdebit",
    "creditdebitindicator",
    "cdindicator",
    "transactiontype",
    "type",
    "indicator",
    "sign",
    "نوعالعملية",
    "النوع",
    "مديندائن",
    "دائنمدين",
  ],
  balance: [
    "runningbalance",
    "closingbalance",
    "availablebalance",
    "ledgerbalance",
    "balance",
    "الرصيد",
    "رصيد",
  ],
  reference: [
    "referenceno",
    "referencenumber",
    "customerreference",
    "transactionreference",
    "txnreference",
    "txnref",
    "chequeno",
    "chequenumber",
    "checkno",
    "refno",
    "reference",
    "ref",
    "رقمالمرجع",
    "رقمالشيك",
    "مرجع",
  ],
};

interface BankProfile {
  id: BankFormatId;
  label: string;
  /** Normalised header tokens that identify the profile (any match). */
  headerHints: string[];
  /** Lower-case text found in preamble lines (account/bank name rows). */
  preambleHints: string[];
}

/**
 * Detection order matters: the first profile whose hints match wins. ADCB is checked before
 * Emirates NBD because ADCB exports carry both `Txn Date` and `Value Date` (R06-07).
 */
const BANK_PROFILES: BankProfile[] = [
  {
    id: "adcb",
    label: "ADCB",
    headerHints: ["txndate", "particulars"],
    preambleHints: ["adcb", "abu dhabi commercial"],
  },
  {
    id: "mashreqneo",
    label: "Mashreq Neo",
    headerHints: [],
    preambleHints: ["mashreq neo", "neo account"],
  },
  {
    id: "mashreq",
    label: "Mashreq",
    headerHints: ["postingdate", "transactiondetails"],
    preambleHints: ["mashreq"],
  },
  {
    id: "rakbank",
    label: "RAKBANK",
    headerHints: ["narrative"],
    preambleHints: ["rakbank", "rak bank"],
  },
  {
    id: "cbd",
    label: "Commercial Bank of Dubai",
    headerHints: ["bookingdate"],
    preambleHints: ["commercial bank of dubai", "cbd"],
  },
  {
    id: "wio",
    label: "Wio",
    headerHints: ["counterparty"],
    preambleHints: ["wio bank", "wio business", "wio"],
  },
  {
    id: "emiratesnbd",
    label: "Emirates NBD",
    headerHints: ["narration"],
    preambleHints: ["emirates nbd", "enbd"],
  },
  {
    id: "fab",
    label: "FAB",
    headerHints: ["transdate", "chequeno"],
    preambleHints: ["first abu dhabi", "fab"],
  },
];

function detectProfile(headersNorm: string[], preamble: string): BankFormatId {
  const joined = headersNorm.join(",");
  const text = preamble.toLowerCase();
  for (const profile of BANK_PROFILES) {
    if (profile.headerHints.some((h) => headersNorm.includes(h) || joined.includes(h))) {
      return profile.id;
    }
  }
  for (const profile of BANK_PROFILES) {
    if (profile.preambleHints.some((h) => new RegExp(`(^|[^a-z])${h}([^a-z]|$)`).test(text))) {
      return profile.id;
    }
  }
  // Emirates NBD exports with Value Date but no other bank-specific column.
  if (headersNorm.includes("valuedate") && !headersNorm.some((h) => h.includes("txn"))) {
    return "emiratesnbd";
  }
  // Mashreq Neo style: category + single amount column, no debit/credit pair.
  if (
    headersNorm.includes("category") &&
    headersNorm.includes("amount") &&
    !headersNorm.includes("debit")
  ) {
    return "mashreqneo";
  }
  return "generic";
}

function headerFieldMatches(headerNorm: string, field: MappingField): boolean {
  if (!headerNorm) return false;
  const aliases = ALIASES[field];
  if (aliases.includes(headerNorm)) return true;
  return aliases.some((a) => a.length >= 5 && headerNorm.includes(a));
}

/** Header row: the first row matching at least two distinct header categories. */
function headerCategoryCount(cells: string[]): number {
  const found = new Set<MappingField>();
  for (const cell of cells) {
    const norm = normalizeHeader(cell);
    if (!norm || norm.length > 40) continue;
    for (const field of MAPPING_FIELDS) {
      if (headerFieldMatches(norm, field)) {
        found.add(field);
        break;
      }
    }
  }
  return found.size;
}

/** Map header cells to columns using the alias table (exact alias match beats substring). */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const norm = headers.map(normalizeHeader);
  const claimed = new Set<number>();
  const mapping: ColumnMapping = {};

  const pick = (field: MappingField, accept?: (idx: number, h: string) => boolean) => {
    const aliases = ALIASES[field];
    // exact matches in alias priority order, then substring matches
    for (const alias of aliases) {
      const idx = norm.findIndex(
        (h, i) => !claimed.has(i) && h === alias && (!accept || accept(i, h))
      );
      if (idx >= 0) {
        claimed.add(idx);
        mapping[field] = idx;
        return;
      }
    }
    for (const alias of aliases) {
      if (alias.length < 5) continue;
      const idx = norm.findIndex(
        (h, i) => !claimed.has(i) && h.includes(alias) && (!accept || accept(i, h))
      );
      if (idx >= 0) {
        claimed.add(idx);
        mapping[field] = idx;
        return;
      }
    }
  };

  const isCombined = (h: string) =>
    (h.includes("debit") && h.includes("credit")) ||
    h === "drcr" ||
    h === "crdr" ||
    h === "مديندائن" ||
    h === "دائنمدين";

  pick("direction");
  pick("date");
  pick("debit", (_i, h) => !isCombined(h));
  pick("credit", (_i, h) => !isCombined(h));
  pick("amount");
  pick("balance");
  pick("reference");
  pick("description");
  // A "Type" column is a direction column only if we also have a single amount column.
  if (mapping.direction != null && (mapping.debit != null || mapping.credit != null)) {
    delete mapping.direction;
  }
  return mapping;
}

// ─── CSV tokenizer ────────────────────────────────────────────────────────────

interface RawRecord {
  fields: string[];
  raw: string;
  /** 1-based physical line the record starts on. */
  line: number;
}

function tokenizeDelimited(text: string, delimiter: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let wasQuoted = false;
  let recStart = 0;
  let recLine = 1;
  let line = 1;

  const pushField = () => {
    fields.push(wasQuoted ? current : current.trim());
    current = "";
    wasQuoted = false;
  };
  const pushRecord = (end: number) => {
    pushField();
    const raw = text.slice(recStart, end).replace(/\r$/, "");
    records.push({ fields, raw, line: recLine });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        current += ch;
      }
      continue;
    }
    if (ch === '"' && current.trim() === "") {
      inQuotes = true;
      wasQuoted = true;
      current = "";
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRecord(i);
      line++;
      recStart = i + 1;
      recLine = line;
    } else {
      current += ch;
    }
  }
  if (recStart < text.length || current !== "" || fields.length > 0) pushRecord(text.length);
  return records.map((r) => ({ ...r, fields: r.fields.map((f) => f.replace(/\u00a0/g, " ")) }));
}

function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    const recs = tokenizeDelimited(text, candidate).filter((r) => r.fields.some((f) => f !== ""));
    const histogram = new Map<number, number>();
    for (const r of recs) {
      const n = r.fields.length;
      if (n >= 2) histogram.set(n, (histogram.get(n) ?? 0) + 1);
    }
    let score = 0;
    for (const [n, count] of histogram) {
      score = Math.max(score, count * (n >= 3 ? 1 : 0.5));
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

// ─── Table parsing (CSV and XLSX share this) ─────────────────────────────────

interface TableInput {
  /** Records in source order, with source row numbers. */
  records: Array<{ fields: string[]; raw: string; line: number }>;
  delimiter: string | null;
  kind: BankFileKind;
}

function isBlank(fields: string[]): boolean {
  return fields.every((f) => f.trim() === "");
}

function parseTable(
  input: TableInput,
  options: ParseOptions,
  fingerprint: string
): BankParseResult {
  const warnings: ParseWarning[] = [];
  const records = input.records;
  const empty = (): BankParseResult => ({
    kind: input.kind,
    format: options.format ?? "generic",
    delimiter: input.delimiter,
    decimalSeparator: options.decimalSeparator ?? ".",
    dateOrder: options.dateOrder ?? null,
    headerRowIndex: null,
    headers: [],
    mapping: options.mapping ?? {},
    rows: [],
    ignored: [],
    warnings,
    fileFingerprint: fingerprint,
    accountHint: null,
    currency: null,
  });

  const nonBlank = records.filter((r) => !isBlank(r.fields));
  if (nonBlank.length === 0) {
    warnings.push({ code: "NO_ROWS", message: "The file has no data rows." });
    return empty();
  }

  // Header: explicit row, else first row (within 40) matching >= 2 header categories.
  let headerPos = -1;
  if (options.headerRow) {
    headerPos = records.findIndex((r) => r.line === options.headerRow);
  }
  if (headerPos < 0) {
    for (let i = 0; i < Math.min(records.length, 40); i++) {
      if (isBlank(records[i].fields)) continue;
      if (headerCategoryCount(records[i].fields) >= 2) {
        headerPos = i;
        break;
      }
    }
  }
  let headerGuessed = false;
  if (headerPos < 0) {
    // No recognisable header: use the first row that has the modal column count (>= 2) so the
    // user can map columns manually.
    const counts = new Map<number, number>();
    for (const r of nonBlank) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
    let modal = 0;
    let modalCount = 0;
    for (const [n, c] of counts) {
      if (n >= 2 && c > modalCount) {
        modal = n;
        modalCount = c;
      }
    }
    headerPos = records.findIndex((r) => !isBlank(r.fields) && r.fields.length === modal);
    headerGuessed = true;
    if (headerPos < 0) {
      warnings.push({ code: "HEADER_NOT_FOUND", message: "Could not find a header row." });
      return empty();
    }
    warnings.push({
      code: "HEADER_NOT_FOUND",
      message: "No recognisable header row; the first row was used. Map the columns manually.",
      requiresChoice: true,
    });
  }

  const headerRecord = records[headerPos];
  const headers = headerRecord.fields;
  const preamble = records
    .slice(0, headerPos)
    .map((r) => r.fields.join(" "))
    .join("\n");
  if (headerPos > 0 && records.slice(0, headerPos).some((r) => !isBlank(r.fields))) {
    warnings.push({
      code: "PREAMBLE_SKIPPED",
      message: `Skipped ${records.slice(0, headerPos).filter((r) => !isBlank(r.fields)).length} line(s) above the header row.`,
    });
  }

  const headersNorm = headers.map(normalizeHeader);
  const format = options.format ?? detectProfile(headersNorm, preamble);
  const mapping: ColumnMapping = { ...(options.mapping ?? autoMapColumns(headers)) };
  const hasMoney = mapping.amount != null || mapping.debit != null || mapping.credit != null;
  if (mapping.date == null || !hasMoney) {
    warnings.push({
      code: "MAPPING_INCOMPLETE",
      message: `Could not map ${mapping.date == null ? "a date column" : "an amount/debit/credit column"}. Choose the columns manually.`,
      requiresChoice: true,
    });
  }

  const dataRecords = records
    .slice(headerPos + 1)
    .filter((r) => !isBlank(r.fields))
    .filter((r) => !(headerCategoryCount(r.fields) >= 2 && !headerGuessed)); // repeated headers

  const cell = (r: RawRecord, idx: number | null | undefined): string =>
    idx == null || idx < 0 ? "" : (r.fields[idx] ?? "").trim();

  // ── decimal separator
  const moneyCells: string[] = [];
  for (const r of dataRecords) {
    for (const f of ["amount", "debit", "credit", "balance"] as const) {
      const v = cell(r, mapping[f]);
      if (v) moneyCells.push(v);
    }
  }
  let decimal: DecimalSeparator = options.decimalSeparator ?? ".";
  if (!options.decimalSeparator) {
    const ev = decimalEvidence(moneyCells);
    if (ev.comma > 0 && ev.point === 0) {
      decimal = ",";
      warnings.push({
        code: "DECIMAL_SEPARATOR_INFERRED",
        message: `Amounts use a decimal comma (e.g. '10,50' = 10.50). Confirm if this looks wrong.`,
        options: [".", ","],
      });
    } else if (ev.comma > 0 && ev.point > 0) {
      decimal = ".";
      warnings.push({
        code: "AMBIGUOUS_DECIMAL",
        message:
          "Amounts mix decimal comma and decimal point styles. Choose the decimal separator.",
        requiresChoice: true,
        options: [".", ","],
      });
    } else if (ev.ambiguous > 0 && ev.point === 0) {
      decimal = ".";
      warnings.push({
        code: "AMBIGUOUS_DECIMAL",
        message:
          "Amounts such as '1,234' could be 1234 (thousands comma) or 1.234 (decimal comma). Choose the decimal separator.",
        requiresChoice: true,
        options: [".", ","],
      });
    }
  }

  // ── date order
  const dateCells = dataRecords.map((r) => cell(r, mapping.date)).filter(Boolean);
  let order: DateOrder | null = options.dateOrder ?? null;
  if (!order) {
    let dmyEvidence = 0;
    let mdyEvidence = 0;
    let numeric = 0;
    let ambiguous = 0;
    let ymd = 0;
    for (const c of dateCells) {
      const p = splitDate(c);
      if (p.kind === "ymd") ymd++;
      if (p.kind !== "numeric") continue;
      numeric++;
      if (p.a > 12 && p.b <= 12) dmyEvidence++;
      else if (p.b > 12 && p.a <= 12) mdyEvidence++;
      else if (p.a <= 12 && p.b <= 12) ambiguous++;
    }
    if (numeric === 0) {
      order = "YMD";
    } else if (dmyEvidence > 0 && mdyEvidence === 0) {
      order = "DMY";
    } else if (mdyEvidence > 0 && dmyEvidence === 0) {
      order = "MDY";
      warnings.push({
        code: "DATE_ORDER_DETECTED",
        message: "Dates are in MM/DD/YYYY order (detected from the data).",
        options: ["DMY", "MDY"],
      });
    } else if (dmyEvidence > 0 && mdyEvidence > 0) {
      order = dmyEvidence >= mdyEvidence ? "DMY" : "MDY";
      warnings.push({
        code: "MIXED_DATE_ORDER",
        message:
          "The file mixes DD/MM/YYYY and MM/DD/YYYY dates. Rows that do not fit the chosen order are reported as errors.",
        requiresChoice: true,
        options: ["DMY", "MDY"],
      });
    } else {
      order = "DMY";
      warnings.push({
        code: "AMBIGUOUS_DATE_ORDER",
        message: `Every date could be read as DD/MM/YYYY or MM/DD/YYYY (${ambiguous} dates). DD/MM/YYYY was assumed; choose the date order to confirm.`,
        requiresChoice: true,
        options: ["DMY", "MDY"],
      });
    }
    void ymd;
  }

  // ── rows
  const rows: ParsedBankRow[] = [];
  const ignored: BankParseResult["ignored"] = [];
  const parseOrder: DateOrder = order === "YMD" ? "DMY" : order;

  for (const r of dataRecords) {
    const errors: string[] = [];
    const dateRaw = cell(r, mapping.date);
    const descRaw = cell(r, mapping.description).replace(/\s+/g, " ").trim();
    const refRaw = cell(r, mapping.reference);
    const balRaw = cell(r, mapping.balance);

    let debit = 0;
    let credit = 0;
    let hasAmountText = false;

    const readMoney = (raw: string, label: string): AmountCell => {
      const parsed = parseAmountCell(raw, decimal);
      if (!parsed.empty) hasAmountText = true;
      if (!parsed.ok) errors.push(`Invalid ${label} '${raw}'`);
      return parsed;
    };

    if (mapping.debit != null || mapping.credit != null) {
      const d = readMoney(cell(r, mapping.debit), "debit amount");
      const c = readMoney(cell(r, mapping.credit), "credit amount");
      debit = Math.abs(d.value);
      credit = Math.abs(c.value);
      // A lone amount column with Dr/Cr marks alongside debit/credit is rare; ignore.
    } else if (mapping.amount != null) {
      const a = readMoney(cell(r, mapping.amount), "amount");
      const dirText = cell(r, mapping.direction);
      let dir = dirText ? directionFromText(dirText) : null;
      if (dirText && !dir) errors.push(`Unrecognised Dr/Cr value '${dirText}'`);
      if (!dir) dir = a.direction;
      const abs = Math.abs(a.value);
      if (dir === "debit") debit = abs;
      else credit = abs;
    }

    let date: Date | null = null;
    if (!dateRaw) {
      if (hasAmountText) errors.push("Missing date");
    } else {
      const parsed = parseStatementDate(dateRaw, parseOrder);
      date = parsed.date;
      if (parsed.error) errors.push(parsed.error);
    }

    let balance: number | null = null;
    if (balRaw) {
      const b = parseAmountCell(balRaw, decimal);
      if (!b.ok) errors.push(`Invalid balance '${balRaw}'`);
      else {
        const signed = b.direction === "debit" ? -b.value : b.value;
        balance = signed !== 0 ? roundMoney(signed) : null;
      }
    }

    // Summary/footer rows: no date and no amount text -> not a transaction.
    if (!dateRaw && !hasAmountText) {
      ignored.push({ rowIndex: r.line, raw: r.raw, reason: "no date or amount" });
      continue;
    }
    if (dateRaw && !hasAmountText && errors.length === 0) {
      errors.push("Missing amount");
    }
    if (hasAmountText && errors.length === 0 && debit === 0 && credit === 0) {
      ignored.push({ rowIndex: r.line, raw: r.raw, reason: "zero amount" });
      continue;
    }

    debit = roundMoney(debit);
    credit = roundMoney(credit);
    rows.push({
      rowIndex: r.line,
      raw: r.raw,
      date,
      description: descRaw || refRaw || "(no description)",
      debit,
      credit,
      amount: roundMoney(credit - debit),
      balance,
      reference: refRaw || null,
      errors,
    });
  }

  if (rows.length === 0 && ignored.length === 0) {
    warnings.push({ code: "NO_ROWS", message: "No transaction rows were found below the header." });
  }

  return {
    kind: input.kind,
    format,
    delimiter: input.delimiter,
    decimalSeparator: decimal,
    dateOrder: order,
    headerRowIndex: headerRecord.line,
    headers,
    mapping,
    rows,
    ignored,
    warnings,
    fileFingerprint: fingerprint,
    accountHint: null,
    currency: null,
  };
}

export function directionFromText(raw: string): "debit" | "credit" | null {
  const normalized = normalizeHeader(raw);
  if (!normalized) return null;
  if (["d", "dr", "db", "dbit"].includes(normalized)) return "debit";
  if (["c", "cr", "crdt"].includes(normalized)) return "credit";
  const debitTokens = ["debit", "withdrawal", "outflow", "paid", "مدين", "سحب", "خصم"];
  const creditTokens = ["credit", "deposit", "inflow", "received", "دائن", "ايداع", "إيداع"];
  if (debitTokens.some((t) => normalized.includes(normalizeHeader(t)))) return "debit";
  if (creditTokens.some((t) => normalized.includes(normalizeHeader(t)))) return "credit";
  return null;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function parseBankCsvText(
  text: string,
  options: ParseOptions = {},
  fingerprint = fingerprintBytes(Buffer.from(text, "utf8"))
): BankParseResult {
  const clean = stripBom(text);
  const delimiter = options.delimiter ?? detectDelimiter(clean);
  const records = tokenizeDelimited(clean, delimiter);
  return parseTable({ records, delimiter, kind: "csv" }, options, fingerprint);
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

function xlsxCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join("");
    }
    if ("result" in v) return xlsxCellText(v.result as ExcelJS.CellValue);
    if (typeof v.text === "string") return v.text;
    if (typeof v.hyperlink === "string") return String(v.text ?? v.hyperlink);
  }
  return String(value);
}

export async function parseBankXlsx(
  bytes: Buffer,
  options: ParseOptions = {},
  fingerprint = fingerprintBytes(bytes)
): Promise<BankParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  // The statement is the sheet with the most rows.
  let sheet: ExcelJS.Worksheet | undefined;
  workbook.eachSheet((ws) => {
    if (!sheet || ws.rowCount > sheet.rowCount) sheet = ws;
  });
  const records: RawRecord[] = [];
  if (sheet) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const fields: string[] = [];
      const cellCount = Math.max(row.cellCount, row.actualCellCount);
      for (let c = 1; c <= cellCount; c++) fields.push(xlsxCellText(row.getCell(c).value).trim());
      records.push({ fields, raw: fields.join(" | "), line: rowNumber });
    });
  }
  return parseTable({ records, delimiter: null, kind: "xlsx" }, options, fingerprint);
}

// ─── MT940 ────────────────────────────────────────────────────────────────────

function yymmdd(value: string): Date | null {
  const m = value.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return utcDate(2000 + +m[1], +m[2], +m[3]);
}

function mt940Description(lines: string[]): string {
  const joined = lines.join("\n").trim();
  if (!joined) return "";
  if (/\?\d{2}/.test(joined)) {
    // Structured German-style :86: ?20..?29 purpose lines, ?32/?33 counterparty name.
    const parts: string[] = [];
    for (const m of joined.replace(/\n/g, "").matchAll(/\?(\d{2})([^?]*)/g)) {
      const code = +m[1];
      if ((code >= 20 && code <= 29) || code === 32 || code === 33) parts.push(m[2].trim());
    }
    if (parts.length > 0) return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  return joined
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBankMt940(
  text: string,
  options: ParseOptions = {},
  fingerprint = fingerprintBytes(Buffer.from(text, "utf8"))
): BankParseResult {
  const warnings: ParseWarning[] = [];
  const lines = stripBom(text).replace(/\r\n?/g, "\n").split("\n");
  type Tag = { tag: string; lines: string[] };
  const tags: Tag[] = [];
  for (const line of lines) {
    const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) tags.push({ tag: m[1], lines: [m[2]] });
    else if (line.startsWith("-}") || line.startsWith("{") || line.trim() === "-") continue;
    else if (tags.length > 0) tags[tags.length - 1].lines.push(line);
  }
  const rows: ParsedBankRow[] = [];
  let account: string | null = null;
  let currency: string | null = null;
  let seq = 0;
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.tag === "25") account = t.lines[0].trim() || account;
    if (t.tag === "60F" || t.tag === "60M") {
      const m = t.lines[0].match(/^[CD]\d{6}([A-Z]{3})/);
      if (m) currency = m[1];
    }
    if (t.tag !== "61") continue;
    seq++;
    const errors: string[] = [];
    const first = t.lines[0];
    const m = first.match(/^(\d{6})(\d{4})?(R?[CD])([A-Z])?(\d+(?:,\d*)?)N([A-Z0-9]{3})(.*)$/);
    const next = tags[i + 1];
    const info = next && next.tag === "86" ? next : null;
    const raw = [`:61:${t.lines.join("\n")}`, info ? `:86:${info.lines.join("\n")}` : ""]
      .filter(Boolean)
      .join("\n");
    if (!m) {
      rows.push({
        rowIndex: seq,
        raw,
        date: null,
        description: "",
        debit: 0,
        credit: 0,
        amount: 0,
        balance: null,
        reference: null,
        errors: [`Unreadable :61: statement line '${first}'`],
      });
      continue;
    }
    const date = yymmdd(m[1]);
    if (!date) errors.push(`Invalid date '${m[1]}'`);
    const mark = m[3];
    const amount = parseAmountCell(m[5], ",");
    if (!amount.ok) errors.push(`Invalid amount '${m[5]}'`);
    const reversal = mark.startsWith("R");
    // C = credit, D = debit; reversal flips the sign.
    const isCredit = mark.endsWith("C") !== reversal;
    const rest = m[7] ?? "";
    const [custRaw, bankRaw] = rest.split("//");
    const cust = (custRaw ?? "").trim();
    const reference = cust && cust !== "NONREF" ? cust : (bankRaw ?? "").trim() || null;
    const abs = roundMoney(amount.value);
    rows.push({
      rowIndex: seq,
      raw,
      date,
      description:
        mt940Description(info ? info.lines : t.lines.slice(1)) || reference || "(no description)",
      debit: isCredit ? 0 : abs,
      credit: isCredit ? abs : 0,
      amount: isCredit ? abs : -abs,
      balance: null,
      reference,
      errors,
    });
  }
  if (rows.length === 0)
    warnings.push({ code: "NO_ROWS", message: "No :61: statement lines found." });
  void options;
  return {
    kind: "mt940",
    format: "mt940",
    delimiter: null,
    decimalSeparator: ",",
    dateOrder: null,
    headerRowIndex: null,
    headers: [],
    mapping: {},
    rows,
    ignored: [],
    warnings,
    fileFingerprint: fingerprint,
    accountHint: account,
    currency,
  };
}

// ─── CAMT.053 ─────────────────────────────────────────────────────────────────

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
}

function xmlFirst(block: string, tag: string): string | null {
  const m = block.match(
    new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)
  );
  return m ? xmlUnescape(m[1].trim()) : null;
}

function xmlAll(block: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  for (const m of block.matchAll(re)) out.push(xmlUnescape(m[1].trim()));
  return out;
}

export function parseBankCamt053(
  text: string,
  options: ParseOptions = {},
  fingerprint = fingerprintBytes(Buffer.from(text, "utf8"))
): BankParseResult {
  const warnings: ParseWarning[] = [];
  const xml = stripBom(text);
  const rows: ParsedBankRow[] = [];
  let seq = 0;
  const iban =
    xmlFirst(xml, "IBAN") ?? xmlFirst(xml.slice(xml.search(/<(?:\w+:)?Acct[\s>]/)), "Id");
  let currency: string | null = null;
  const entryRe = /<(?:\w+:)?Ntry(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Ntry>/g;
  for (const match of xml.matchAll(entryRe)) {
    seq++;
    const block = match[1];
    const errors: string[] = [];
    const amtMatch = block.match(
      /<(?:\w+:)?Amt(?:\s+Ccy="([A-Z]{3})")?[^>]*>([^<]+)<\/(?:\w+:)?Amt>/
    );
    const indicator = xmlFirst(block, "CdtDbtInd");
    const reversal = (xmlFirst(block, "RvslInd") ?? "").toLowerCase() === "true";
    const bookingBlock = xmlFirst(block, "BookgDt") ?? xmlFirst(block, "ValDt") ?? "";
    const dateText = (
      xmlFirst(bookingBlock, "Dt") ??
      xmlFirst(bookingBlock, "DtTm") ??
      bookingBlock
    )
      .trim()
      .slice(0, 10);
    const parsedDate = parseStatementDate(dateText, "YMD");
    if (parsedDate.error) errors.push(parsedDate.error);
    if (!amtMatch) errors.push("Missing <Amt>");
    if (!indicator || !["CRDT", "DBIT"].includes(indicator))
      errors.push(`Invalid CdtDbtInd '${indicator ?? ""}'`);
    const amount = amtMatch ? parseAmountCell(amtMatch[2], ".") : { value: 0, ok: false };
    if (amtMatch && !amount.ok) errors.push(`Invalid amount '${amtMatch[2]}'`);
    if (amtMatch?.[1]) currency = currency ?? amtMatch[1];
    const isCredit = (indicator === "CRDT") !== reversal;
    const abs = roundMoney(amount.value);
    const remittance = xmlAll(block, "Ustrd").join(" ").trim();
    const refs = [
      xmlFirst(block, "AcctSvcrRef"),
      xmlFirst(block, "NtryRef"),
      xmlFirst(block, "EndToEndId"),
    ].filter((r): r is string => !!r && r !== "NOTPROVIDED");
    const description = (
      xmlFirst(block, "AddtlNtryInf") ||
      remittance ||
      xmlFirst(block, "Nm") ||
      refs[0] ||
      ""
    ).trim();
    rows.push({
      rowIndex: seq,
      raw: block.replace(/\s+/g, " ").trim().slice(0, 500),
      date: parsedDate.date,
      description: description || "(no description)",
      debit: isCredit ? 0 : abs,
      credit: isCredit ? abs : 0,
      amount: isCredit ? abs : -abs,
      balance: null,
      reference: refs[0] ?? null,
      errors,
    });
  }
  if (rows.length === 0) warnings.push({ code: "NO_ROWS", message: "No <Ntry> entries found." });
  void options;
  return {
    kind: "camt053",
    format: "camt053",
    delimiter: null,
    decimalSeparator: ".",
    dateOrder: "YMD",
    headerRowIndex: null,
    headers: [],
    mapping: {},
    rows,
    ignored: [],
    warnings,
    fileFingerprint: fingerprint,
    accountHint: iban,
    currency,
  };
}

// ─── OFX / QFX ────────────────────────────────────────────────────────────────

function ofxField(block: string, field: string): string | null {
  const m = block.match(new RegExp(`<${field}>\\s*([^<\\r\\n]*)`, "i"));
  return m ? xmlUnescape(m[1].trim()) : null;
}

export function parseBankOfx(
  text: string,
  options: ParseOptions = {},
  fingerprint = fingerprintBytes(Buffer.from(text, "utf8"))
): BankParseResult {
  const warnings: ParseWarning[] = [];
  const body = stripBom(text);
  const rows: ParsedBankRow[] = [];
  let seq = 0;
  for (const match of body.matchAll(
    /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi
  )) {
    seq++;
    const block = match[1];
    const errors: string[] = [];
    const posted = ofxField(block, "DTPOSTED") ?? "";
    const dm = posted.match(/^(\d{4})(\d{2})(\d{2})/);
    const date = dm ? utcDate(+dm[1], +dm[2], +dm[3]) : null;
    if (!date) errors.push(`Invalid date '${posted}'`);
    const amtRaw = (ofxField(block, "TRNAMT") ?? "").replace(/\s/g, "");
    const normalized =
      amtRaw.includes(",") && !amtRaw.includes(".")
        ? amtRaw.replace(",", ".")
        : amtRaw.replace(/,/g, "");
    const parsed = parseAmountCell(normalized.replace(/^\+/, ""), ".");
    if (!amtRaw || !parsed.ok) errors.push(`Invalid amount '${amtRaw}'`);
    const negative = /^-/.test(normalized);
    const abs = roundMoney(Math.abs(parsed.value));
    const name = ofxField(block, "NAME");
    const memo = ofxField(block, "MEMO");
    const description =
      [name, memo && memo !== name ? memo : null].filter(Boolean).join(" - ") || "(no description)";
    rows.push({
      rowIndex: seq,
      raw: block.replace(/\s+/g, " ").trim().slice(0, 500),
      date,
      description,
      debit: negative ? abs : 0,
      credit: negative ? 0 : abs,
      amount: negative ? -abs : abs,
      balance: null,
      reference: ofxField(block, "FITID") || ofxField(block, "CHECKNUM") || null,
      errors,
    });
  }
  if (rows.length === 0) warnings.push({ code: "NO_ROWS", message: "No <STMTTRN> entries found." });
  void options;
  return {
    kind: "ofx",
    format: "ofx",
    delimiter: null,
    decimalSeparator: ".",
    dateOrder: "YMD",
    headerRowIndex: null,
    headers: [],
    mapping: {},
    rows,
    ignored: [],
    warnings,
    fileFingerprint: fingerprint,
    accountHint: ofxField(body, "ACCTID"),
    currency: ofxField(body, "CURDEF"),
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function detectBankFileKind(bytes: Buffer, text: string | null): BankFileKind {
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03)
    return "xlsx";
  const t = (text ?? "").slice(0, 4000);
  if (/OFXHEADER|<OFX[>\s]/i.test(t)) return "ofx";
  if (/<(?:\w+:)?(?:Document|BkToCstmrStmt)[\s>]/.test(t) || /camt\.053/i.test(t)) return "camt053";
  if (/^\s*(\{1:[^}]*\}[\s\S]*)?:20:/m.test(t) && /:6[0-2][FM]?:|:61:/.test(text ?? ""))
    return "mt940";
  return "csv";
}

/**
 * Parse any supported statement. `input` is the raw file bytes (preferred, so the fingerprint is
 * of the real file) or already-decoded text.
 */
export async function parseBankStatement(
  input: Buffer | string,
  options: ParseOptions = {}
): Promise<BankParseResult> {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const fingerprint = fingerprintBytes(bytes);
  let kind = options.kind;
  let text: string | null = null;
  if (!kind) {
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    text = isZip ? null : Buffer.isBuffer(input) ? decodeStatementBytes(bytes) : input;
    kind = detectBankFileKind(bytes, text);
  }
  if (kind === "xlsx") return parseBankXlsx(bytes, options, fingerprint);
  if (text === null) text = Buffer.isBuffer(input) ? decodeStatementBytes(bytes) : input;
  if (kind === "mt940") return parseBankMt940(text, options, fingerprint);
  if (kind === "camt053") return parseBankCamt053(text, options, fingerprint);
  if (kind === "ofx") return parseBankOfx(text, options, fingerprint);
  return parseBankCsvText(text, options, fingerprint);
}

// ─── De-duplication / import planning ────────────────────────────────────────

export function normalizeDescription(value: string): string {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

export interface DedupeRowShape {
  date: Date | string;
  amount: number;
  description: string;
  reference: string | null;
}

/** (date, amount, normalised description, reference) — the account scope is applied by the caller. */
export function bankRowKey(row: DedupeRowShape): string {
  const d = row.date instanceof Date ? row.date : new Date(row.date);
  return [
    d.toISOString().slice(0, 10),
    Number(row.amount).toFixed(2),
    normalizeDescription(row.description),
    (row.reference ?? "").trim().toLowerCase(),
  ].join("|");
}

/** importSource value that records the file fingerprint without a schema change. */
export function importSourceFor(kind: BankFileKind, fingerprint: string): string {
  return `${kind}:${fingerprint.slice(0, 16)}`;
}

export interface ExistingBankRow extends DedupeRowShape {
  importSource?: string | null;
}

export type SkipReason = "already_imported" | "file_already_imported" | "invalid_row";

export interface SkippedRow {
  rowIndex: number;
  reason: SkipReason;
  detail: string;
  raw: string;
}

export interface ImportPlan {
  toInsert: ParsedBankRow[];
  skipped: SkippedRow[];
  fileAlreadyImported: boolean;
}

/**
 * Decide which parsed rows to insert (R06-06).
 *
 * Existing rows are counted per key and consumed one-for-one by the incoming rows, so:
 *  - two genuine identical rows in one statement both import (nothing existing to consume);
 *  - re-importing the same file is idempotent (every row consumes its earlier copy);
 *  - an overlapping statement only adds the rows the account does not have yet.
 * `allowDuplicates` bypasses the check entirely (user override).
 */
export function planBankImport(
  rows: ParsedBankRow[],
  existing: ExistingBankRow[],
  options: { fileFingerprint: string; kind: BankFileKind; allowDuplicates?: boolean }
): ImportPlan {
  const valid = rows.filter((r) => r.errors.length === 0 && r.date);
  const skipped: SkippedRow[] = rows
    .filter((r) => r.errors.length > 0 || !r.date)
    .map((r) => ({
      rowIndex: r.rowIndex,
      reason: "invalid_row" as const,
      detail: r.errors.join("; ") || "Invalid row",
      raw: r.raw,
    }));
  const marker = importSourceFor(options.kind, options.fileFingerprint);
  const fileAlreadyImported = existing.some((e) => e.importSource === marker);

  if (options.allowDuplicates) {
    return { toInsert: valid, skipped, fileAlreadyImported };
  }

  const counts = new Map<string, number>();
  for (const e of existing) {
    const key = bankRowKey(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const toInsert: ParsedBankRow[] = [];
  for (const row of valid) {
    const key = bankRowKey({
      date: row.date as Date,
      amount: row.amount,
      description: row.description,
      reference: row.reference,
    });
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      counts.set(key, remaining - 1);
      skipped.push({
        rowIndex: row.rowIndex,
        reason: fileAlreadyImported ? "file_already_imported" : "already_imported",
        detail: fileAlreadyImported
          ? "This file was already imported for the account"
          : "Matches a transaction already imported for the account",
        raw: row.raw,
      });
    } else {
      toInsert.push(row);
    }
  }
  return { toInsert, skipped, fileAlreadyImported };
}

/** Legacy summary view used by the CSV compatibility wrapper and old callers. */
export interface LegacyParsedTransaction {
  date: Date;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  reference: string | null;
}

export function toLegacyTransactions(result: BankParseResult): {
  transactions: LegacyParsedTransaction[];
  format: BankFormatId;
  errors: string[];
} {
  const transactions: LegacyParsedTransaction[] = [];
  const errors: string[] = [];
  for (const row of result.rows) {
    if (row.errors.length > 0 || !row.date) {
      errors.push(`Row ${row.rowIndex}: ${row.errors.join("; ") || "invalid row"}`);
      continue;
    }
    transactions.push({
      date: row.date,
      description: row.description,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
      reference: row.reference,
    });
  }
  return { transactions, format: result.format, errors };
}

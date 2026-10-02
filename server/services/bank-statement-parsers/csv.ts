// CSV statements: UAE bank header presets (Emirates NBD, ADCB, FAB, Mashreq) and a generic column mapper.
// Moved from the bank-statements route so every format goes through one import path.

import { parseDecimal, round2, utcDay } from "./numbers";
import type { ParsedStatement, ParsedStatementLine } from "./types";

// ─── UAE Bank CSV Format Detection ─────────────────────────────────────────

export interface ParsedTransaction {
  date: Date;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  reference: string | null;
}

export type BankFormat = "emiratesnbd" | "adcb" | "fab" | "mashreq" | "generic";

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\ufeff/g, "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]/g, "");
}

function detectBankFormat(headers: string[]): BankFormat {
  const h = headers.map(normalizeHeader);
  const joined = h.join(",");

  if (joined.includes("valuedate") || joined.includes("narration")) return "emiratesnbd";
  if (joined.includes("txndate") || joined.includes("particulars")) return "adcb";
  if (joined.includes("transdate") || joined.includes("chequeno")) return "fab";
  if (joined.includes("postingdate") || joined.includes("transactiondetails")) return "mashreq";
  return "generic";
}

/**
 * Parse a raw CSV string into normalized transaction rows.
 * Handles quoted fields and various line endings.
 */
function parseCsvRow(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalizeNumberGlyphs(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - "۰".charCodeAt(0)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const cleaned = normalizeNumberGlyphs(raw).trim().replace(/\//g, "-").replace(/\./g, "-");

  // YYYY-MM-DD (any time part is ignored: the bank's calendar day)
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return utcDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // DD-MM-YYYY, DD-MMM-YYYY, DD MMM YY
  const parts = cleaned.split(/[-\s]/).filter(Boolean);
  if (parts.length >= 3) {
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const day = parseInt(parts[0], 10);
    const month = Number.isNaN(parseInt(parts[1], 10)) ? months[parts[1].toLowerCase().slice(0, 3)] : parseInt(parts[1], 10);
    const yearRaw = parts[2].slice(0, 4);
    const year = parseInt(yearRaw.length <= 2 ? "20" + yearRaw : yearRaw, 10);
    if (!month) return null;
    return utcDay(year, month, day);
  }

  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const normalizedDigits = normalizeNumberGlyphs(raw);
  // Remove currency symbols, commas, spaces; handle parentheses as negative
  const negative =
    normalizedDigits.trim().startsWith("(") ||
    normalizedDigits.trim().startsWith("-") ||
    /\bdr\b/i.test(normalizedDigits) ||
    /مدين|سحب|خصم/.test(normalizedDigits);
  const val = parseDecimal(normalizedDigits.replace(/[^0-9.,]/g, "")) ?? 0;
  return negative ? -val : val;
}

function debitCreditDirection(raw: string): "debit" | "credit" | null {
  const normalized = normalizeHeader(raw);
  if (!normalized) return null;

  if (["d", "dr"].includes(normalized)) return "debit";
  if (["c", "cr"].includes(normalized)) return "credit";

  if (
    ["debit", "withdrawal", "outflow", "paid", "مدين", "سحب", "خصم"].some((token) =>
      normalized.includes(normalizeHeader(token))
    )
  ) {
    return "debit";
  }

  if (
    ["credit", "deposit", "inflow", "received", "دائن", "ايداع", "إيداع"].some((token) =>
      normalized.includes(normalizeHeader(token))
    )
  ) {
    return "credit";
  }

  return null;
}

function mapRow(fields: string[], headers: string[], format: BankFormat): ParsedTransaction | null {
  const normalizedHeaders = headers.map(normalizeHeader);
  const get = (...keys: string[]): string => {
    const normalizedKeys = keys.map(normalizeHeader).filter(Boolean);
    const idx = normalizedHeaders.findIndex(
      (header) =>
        Boolean(header) &&
        normalizedKeys.some(
          (key) =>
            header === key ||
            (key.length > 2 && header.includes(key)) ||
            (key.length > 2 && header.length > 2 && key.includes(header))
        )
    );
    return idx >= 0 ? (fields[idx] || "").trim() : "";
  };

  let dateStr = "";
  let description = "";
  let debitStr = "";
  let creditStr = "";
  let balanceStr = "";
  let reference = "";

  if (format === "emiratesnbd") {
    dateStr = get("ValueDate", "Date", "TransactionDate", "تاريخ", "تاريخالقيمة");
    description = get("Narration", "Description", "Details", "البيان", "الوصف", "تفاصيل");
    debitStr = get("Debit", "Withdrawal", "Dr", "مدين", "سحب", "خصم");
    creditStr = get("Credit", "Deposit", "Cr", "دائن", "ايداع", "إيداع");
    balanceStr = get("Balance", "RunningBalance", "الرصيد", "رصيد");
    reference = get("ChequeNo", "Reference", "Ref", "مرجع", "رقمالمرجع");
  } else if (format === "adcb") {
    dateStr = get("TxnDate", "Date", "TransactionDate", "تاريخ", "تاريخالعملية");
    description = get("Particulars", "Description", "Details", "البيان", "الوصف", "تفاصيل");
    debitStr = get("Debit", "Withdrawal", "Dr", "مدين", "سحب", "خصم");
    creditStr = get("Credit", "Deposit", "Cr", "دائن", "ايداع", "إيداع");
    balanceStr = get("Balance", "ClosingBalance", "الرصيد", "رصيد");
    reference = get("Reference", "Ref", "ChequeNo", "مرجع", "رقمالمرجع");
  } else if (format === "fab") {
    dateStr = get("TransDate", "Date", "ValueDate", "تاريخ", "تاريخالعملية");
    description = get("Description", "Details", "Narration", "البيان", "الوصف", "تفاصيل");
    debitStr = get("Debit", "Withdrawal", "Dr", "مدين", "سحب", "خصم");
    creditStr = get("Credit", "Deposit", "Cr", "دائن", "ايداع", "إيداع");
    balanceStr = get("Balance", "RunningBalance", "الرصيد", "رصيد");
    reference = get("ChequeNo", "Reference", "TxnRef", "مرجع", "رقمالمرجع");
  } else if (format === "mashreq") {
    dateStr = get("PostingDate", "Date", "ValueDate", "تاريخ", "تاريخالقيد");
    description = get(
      "TransactionDetails",
      "Description",
      "Narration",
      "البيان",
      "الوصف",
      "تفاصيل"
    );
    debitStr = get("Debit", "Withdrawal", "Dr", "مدين", "سحب", "خصم");
    creditStr = get("Credit", "Deposit", "Cr", "دائن", "ايداع", "إيداع");
    balanceStr = get("Balance", "AvailableBalance", "الرصيد", "رصيد");
    reference = get("Reference", "Ref", "ChequeNo", "مرجع", "رقمالمرجع");
  } else {
    // Generic: try common column names
    dateStr = get("Date", "TransactionDate", "ValueDate", "TxnDate", "تاريخ", "تاريخالعملية");
    description = get(
      "Description",
      "Details",
      "Narration",
      "Particulars",
      "البيان",
      "الوصف",
      "تفاصيل"
    );
    debitStr = get("Debit", "Withdrawal", "Dr", "مدين", "سحب", "خصم");
    creditStr = get("Credit", "Deposit", "Cr", "دائن", "ايداع", "إيداع");
    balanceStr = get("Balance", "RunningBalance", "ClosingBalance", "الرصيد", "رصيد");
    reference = get("Reference", "Ref", "ChequeNo", "TxnRef", "مرجع", "رقمالمرجع");

    // If there's a single amount column, respect a paired Dr/Cr or type column when present.
    if (!debitStr && !creditStr) {
      const amtStr = get("Amount", "TransactionAmount", "Debit/Credit", "المبلغ", "مبلغ");
      const direction = debitCreditDirection(
        get(
          "Type",
          "TransactionType",
          "DrCr",
          "DebitCredit",
          "Debit/CreditType",
          "النوع",
          "نوعالعملية",
          "مديندائن",
          "دائنمدين"
        )
      );
      const amt = parseAmount(amtStr);
      if (direction === "debit") debitStr = String(Math.abs(amt));
      else if (direction === "credit") creditStr = String(Math.abs(amt));
      else if (amt < 0) debitStr = String(Math.abs(amt));
      else creditStr = String(amt);
    }
  }

  const txnDate = parseDate(dateStr);
  if (!txnDate) return null;

  const debit = Math.abs(parseAmount(debitStr));
  const credit = Math.abs(parseAmount(creditStr));
  const balance = balanceStr ? parseAmount(balanceStr) : null;

  // Skip rows with no monetary value
  if (debit === 0 && credit === 0) return null;

  const cleanedDesc = description.replace(/\s+/g, " ").trim();
  if (!cleanedDesc) return null;

  return {
    date: txnDate,
    description: cleanedDesc,
    debit,
    credit,
    balance: balance !== 0 ? balance : null,
    reference: reference || null,
  };
}

/**
 * Parse CSV content and return normalized transactions.
 * Skips header-only detection rows and blank lines.
 */
export function parseBankCsv(csvContent: string): {
  transactions: ParsedTransaction[];
  format: BankFormat;
  errors: string[];
} {
  const lines = csvContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return { transactions: [], format: "generic", errors: ["CSV has no data rows"] };
  }

  const delimiters = [",", ";", "\t"];
  let delimiter = ",";
  let headerIdx = 0;
  let headerFieldCount = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    for (const candidate of delimiters) {
      const fields = parseCsvRow(lines[i], candidate);
      if (fields.length > headerFieldCount) {
        headerIdx = i;
        delimiter = candidate;
        headerFieldCount = fields.length;
      }
    }
    if (headerFieldCount >= 3) {
      break;
    }
  }

  const headers = parseCsvRow(lines[headerIdx], delimiter);
  const format = detectBankFormat(headers);
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseCsvRow(lines[i], delimiter);
    if (fields.every((f) => !f)) continue; // blank row

    try {
      const txn = mapRow(fields, headers, format);
      if (txn) {
        transactions.push(txn);
      }
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return { transactions, format, errors };
}

/** The CSV as a statement: closing balance from the latest line that carries a running balance. */
export function parseCsv(content: string): ParsedStatement {
  const { transactions, format, errors } = parseBankCsv(content);
  const lines: ParsedStatementLine[] = transactions.map((t) => ({
    date: t.date,
    valueDate: null,
    amount: round2(t.credit > 0 ? t.credit : -t.debit),
    description: t.description,
    reference: t.reference,
    externalId: null,
    balance: t.balance,
  }));
  const warnings = errors.slice(0, 20);
  if (format !== "generic") warnings.unshift(`Detected the ${format} column layout.`);

  let closing: number | null = null;
  let opening: number | null = null;
  if (lines.length > 0) {
    const times = lines.map((l) => l.date.getTime());
    const descending = times.length > 1 && times[0] > times[times.length - 1];
    const maxT = Math.max(...times);
    const minT = Math.min(...times);
    const onMax = lines.filter((l) => l.date.getTime() === maxT && l.balance !== null);
    if (onMax.length) closing = (descending ? onMax[0] : onMax[onMax.length - 1]).balance;
    const onMin = lines.filter((l) => l.date.getTime() === minT && l.balance !== null);
    if (onMin.length) {
      const first = descending ? onMin[onMin.length - 1] : onMin[0];
      if (first.balance !== null) opening = round2(first.balance - first.amount);
    }
  }
  const dates = lines.map((l) => l.date.getTime());
  return {
    format: "csv",
    lines,
    accountId: null,
    currency: null,
    openingBalance: opening,
    closingBalance: closing,
    statementFrom: dates.length ? new Date(Math.min(...dates)) : null,
    statementTo: dates.length ? new Date(Math.max(...dates)) : null,
    warnings,
  };
}


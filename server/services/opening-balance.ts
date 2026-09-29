/**
 * Pure logic of opening balances: date and grid validation, the balancing
 * journal lines, the tie-out of open invoices / bills to receivables and
 * payables, and CSV parsing. No I/O.
 */

import { fromFils, toFils } from "./tax-filing-core";

export interface OpeningAccount {
  id: string;
  code: string;
  nameEn: string;
  type: string;
}

export interface OpeningRowInput {
  accountCode: string;
  debit: number;
  credit: number;
}

export interface OpeningRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface OpeningIssue {
  code: string;
  message: string;
  /** 1-based grid row (or CSV line) when the issue belongs to one. */
  row?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isRealDate = (ymd: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
};

/** Day before a YYYY-MM-DD date. */
export function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export type OpeningDateResult =
  | { ok: true; date: string }
  | { ok: false; code: string; message: string };

/**
 * The opening date is the day before the first transaction. It must be a real past (or
 * today's) date and, when the company already has transactions, strictly before the first.
 */
export function validateOpeningDate(
  date: unknown,
  firstTransactionYmd: string | null,
  todayYmd: string
): OpeningDateResult {
  if (typeof date !== "string" || !isRealDate(date)) {
    return { ok: false, code: "OPENING_DATE_INVALID", message: "The opening balance date must be a real date in YYYY-MM-DD format." };
  }
  if (date > todayYmd) {
    return { ok: false, code: "OPENING_DATE_IN_FUTURE", message: "The opening balance date cannot be in the future." };
  }
  if (firstTransactionYmd && date >= firstTransactionYmd) {
    return {
      ok: false,
      code: "OPENING_DATE_NOT_BEFORE_FIRST_TRANSACTION",
      message: `The opening balance date must be before your first transaction (${firstTransactionYmd}). Use ${dayBefore(firstTransactionYmd)}.`,
    };
  }
  return { ok: true, date };
}

export type GridResult =
  | { ok: true; rows: OpeningRow[]; totalDebit: number; totalCredit: number }
  | { ok: false; errors: OpeningIssue[] };

const BALANCE_SHEET_TYPES = new Set(["asset", "liability", "equity"]);

export function validateOpeningGrid(input: OpeningRowInput[], accounts: OpeningAccount[]): GridResult {
  const errors: OpeningIssue[] = [];
  const byCode = new Map(accounts.map((a) => [String(a.code).trim(), a]));
  const seen = new Set<string>();
  const rows: OpeningRow[] = [];

  input.forEach((raw, index) => {
    const rowNo = index + 1;
    const code = String(raw.accountCode ?? "").trim();
    const debit = Number(raw.debit ?? 0);
    const credit = Number(raw.credit ?? 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      errors.push({ code: "AMOUNT_INVALID", row: rowNo, message: `Row ${rowNo} (${code || "no account"}): debit and credit must be numbers of zero or more.` });
      return;
    }
    if (toFils(debit) === 0 && toFils(credit) === 0) return; // an empty grid row
    const account = byCode.get(code);
    if (!account) {
      errors.push({ code: "ACCOUNT_UNKNOWN", row: rowNo, message: `Row ${rowNo}: there is no account with code "${code}" in your chart of accounts.` });
      return;
    }
    if (!BALANCE_SHEET_TYPES.has(account.type)) {
      errors.push({
        code: "ACCOUNT_NOT_BALANCE_SHEET",
        row: rowNo,
        message: `Row ${rowNo}: ${account.code} ${account.nameEn} is an ${account.type} account. Opening balances are for assets, liabilities and equity; put prior profit in retained earnings.`,
      });
      return;
    }
    if (toFils(debit) !== 0 && toFils(credit) !== 0) {
      errors.push({ code: "BOTH_SIDES", row: rowNo, message: `Row ${rowNo}: ${account.code} has both a debit and a credit. Enter the net balance on one side.` });
      return;
    }
    if (seen.has(code)) {
      errors.push({ code: "ACCOUNT_DUPLICATE", row: rowNo, message: `Row ${rowNo}: account ${code} appears more than once.` });
      return;
    }
    seen.add(code);
    rows.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.nameEn,
      debit: fromFils(toFils(debit)),
      credit: fromFils(toFils(credit)),
    });
  });

  if (errors.length === 0 && rows.length === 0) {
    errors.push({ code: "GRID_EMPTY", message: "Enter at least one opening balance." });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    rows,
    totalDebit: fromFils(rows.reduce((s, r) => s + toFils(r.debit), 0)),
    totalCredit: fromFils(rows.reduce((s, r) => s + toFils(r.credit), 0)),
  };
}

export interface OpeningLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

/** The journal lines: every grid row, plus the difference to Opening Balance Equity. */
export function buildOpeningBalanceLines(rows: OpeningRow[], equityAccountId: string): OpeningLine[] {
  const lines: OpeningLine[] = rows.map((r) => ({
    accountId: r.accountId,
    debit: r.debit,
    credit: r.credit,
    description: `Opening balance - ${r.accountCode} ${r.accountName}`,
  }));
  const debit = rows.reduce((s, r) => s + toFils(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toFils(r.credit), 0);
  const diff = debit - credit;
  if (diff !== 0) {
    lines.push({
      accountId: equityAccountId,
      debit: diff < 0 ? fromFils(-diff) : 0,
      credit: diff > 0 ? fromFils(diff) : 0,
      description: "Opening balance - balancing amount to Opening Balance Equity",
    });
  }
  return lines;
}

export type ReconcileResult = { ok: true } | { ok: false; errors: OpeningIssue[] };

/**
 * Open invoices must equal the receivables opening balance, open bills the payables one,
 * to the fils. When no documents are entered at all the grid figures stand alone.
 */
export function reconcileSubledgers(input: {
  arBalance: number;
  apBalance: number;
  openInvoicesTotal: number;
  openBillsTotal: number;
  documentsEntered?: boolean;
}): ReconcileResult {
  const entered = input.documentsEntered ?? (toFils(input.openInvoicesTotal) !== 0 || toFils(input.openBillsTotal) !== 0);
  if (!entered) return { ok: true };
  const errors: OpeningIssue[] = [];
  const f = (n: number) => fromFils(toFils(n)).toFixed(2);
  if (toFils(input.arBalance) !== toFils(input.openInvoicesTotal)) {
    errors.push({
      code: "AR_DOES_NOT_TIE",
      message: `Open customer invoices total ${f(input.openInvoicesTotal)} but the Accounts Receivable opening balance is ${f(input.arBalance)}. They must be equal.`,
    });
  }
  if (toFils(input.apBalance) !== toFils(input.openBillsTotal)) {
    errors.push({
      code: "AP_DOES_NOT_TIE",
      message: `Open vendor bills total ${f(input.openBillsTotal)} but the Accounts Payable opening balance is ${f(input.apBalance)}. They must be equal.`,
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const HEADER_ALIASES: Record<string, "code" | "debit" | "credit"> = {
  "account code": "code",
  accountcode: "code",
  code: "code",
  account: "code",
  debit: "debit",
  credit: "credit",
};

/** Parse a CSV grid (account code, debit, credit; header row required, any column order). */
export function parseOpeningCsv(text: string): { rows: OpeningRowInput[]; errors: Array<{ line: number; message: string }> } {
  const errors: Array<{ line: number; message: string }> = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };

  const header = splitCsvLine(lines[firstIdx]).map((h) => HEADER_ALIASES[h.toLowerCase()]);
  const col = { code: header.indexOf("code"), debit: header.indexOf("debit"), credit: header.indexOf("credit") };
  if (col.code === -1 || col.debit === -1 || col.credit === -1) {
    return { rows: [], errors: [{ line: firstIdx + 1, message: 'The first row must name the columns: "account code", "debit" and "credit".' }] };
  }

  const num = (raw: string | undefined): number | null => {
    const t = (raw ?? "").replace(/,/g, "").trim();
    if (t === "") return 0;
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };

  const rows: OpeningRowInput[] = [];
  for (let i = firstIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const cells = splitCsvLine(lines[i]);
    const code = (cells[col.code] ?? "").trim();
    const debit = num(cells[col.debit]);
    const credit = num(cells[col.credit]);
    if (!code) {
      errors.push({ line: i + 1, message: "The account code is missing." });
      continue;
    }
    if (debit === null || credit === null) {
      errors.push({ line: i + 1, message: `Debit and credit must be plain numbers (line for account ${code}).` });
      continue;
    }
    rows.push({ accountCode: code, debit, credit });
  }
  return { rows, errors };
}

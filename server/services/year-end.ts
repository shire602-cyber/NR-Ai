/**
 * Pure logic of the financial-year close: fiscal-year date arithmetic and the
 * closing-entry lines. No I/O; the DB service resolves balances and accounts.
 */

import { fromFils, monthEndsInRange, toFils } from "./tax-filing-core";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export interface FiscalYearRange {
  yearStart: string;
  yearEnd: string;
}

/**
 * The fiscal year that STARTS in `startYear` for a company whose year starts in
 * `startMonth` (1-12): calendar 2026 for January, April 2026 - March 2027 for April.
 */
export function fiscalYearRange(startMonth: number, startYear: number): FiscalYearRange {
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  return {
    yearStart: `${startYear}-${pad(startMonth)}-01`,
    yearEnd: `${endYear}-${pad(endMonth)}-${pad(lastDayOfMonth(endYear, endMonth))}`,
  };
}

/** The fiscal year a calendar day (YYYY-MM-DD) falls in. */
export function fiscalYearContaining(startMonth: number, ymd: string): FiscalYearRange {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return fiscalYearRange(startMonth, month >= startMonth ? year : year - 1);
}

/** Last day of each month of the fiscal year: what the close locks. */
export function monthEndsOfFiscalYear(yearStart: string, yearEnd: string): string[] {
  return monthEndsInRange(yearStart, yearEnd);
}

export interface ClosingLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

export interface YearEndBalances {
  /** Net credit balance of each income account over the year (negative = debit balance). */
  income: Array<{ accountId: string; balance: number }>;
  /** Net debit balance of each expense account over the year (negative = credit balance). */
  expense: Array<{ accountId: string; balance: number }>;
}

/**
 * One entry that zeroes every income and expense account and books the result in
 * retained earnings: income balances are debited, expense balances credited, and
 * the difference (net profit) is credited to retained earnings (a loss debits it).
 */
export function buildYearEndClosingLines(
  balances: YearEndBalances,
  accts: { retainedId: string },
  label = "Year-end close"
): { lines: ClosingLine[]; netIncome: number } {
  const lines: ClosingLine[] = [];
  let debitFils = 0;
  let creditFils = 0;

  const push = (accountId: string, debitSide: boolean, fils: number, what: string) => {
    if (fils === 0) return;
    lines.push({
      accountId,
      debit: debitSide ? fromFils(fils) : 0,
      credit: debitSide ? 0 : fromFils(fils),
      description: `${label} - ${what}`,
    });
    if (debitSide) debitFils += fils;
    else creditFils += fils;
  };

  for (const { accountId, balance } of balances.income) {
    const fils = toFils(balance);
    // credit balance -> debit it to close; debit balance (contra) -> credit it
    push(accountId, fils > 0, Math.abs(fils), "close income");
  }
  for (const { accountId, balance } of balances.expense) {
    const fils = toFils(balance);
    // debit balance -> credit it to close; credit balance -> debit it
    push(accountId, fils < 0, Math.abs(fils), "close expense");
  }

  const netFils = debitFils - creditFils; // >0: credit retained earnings (profit)
  if (netFils !== 0) push(accts.retainedId, netFils < 0, Math.abs(netFils), "net result to retained earnings");
  return { lines, netIncome: fromFils(netFils) };
}

// Rows from the text layer of a PDF statement. The browser extracts the text (pdf.js, or OCR for scanned pages) and
// sends it per page; this reads it into rows a person then reviews and corrects. Nothing here is trusted: every row
// carries `issues`, and the review grid checks opening balance + sum of rows = closing balance before commit.
// A row starts at a date, ends at the next date, and carries one or two amounts (amount, then running balance).

import { collapse, parseDecimal, round2, utcDay } from "./numbers";

export interface PdfStatementRow {
  date: string; // YYYY-MM-DD
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: number; // signed, credit positive
  balance: number | null;
  issues: string[];
}

export interface PdfStatementResult {
  rows: PdfStatementRow[];
  openingBalance: number | null;
  closingBalance: number | null;
  statementFrom: string | null;
  statementTo: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DATE_RE =
  /(?<![\d/.-])(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})|(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*\.?[\s,-]+(\d{4}|\d{2}))(?![\d])/g;

const AMOUNT_RE = /(?<![\d.,])(\()?(-)?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(\))?(?:\s?(CR|DR|Cr|Dr|cr|dr))?(-)?(?![\d.])/g;

const OUTFLOW_WORDS = /\b(withdrawal|purchase|pos|atm|fee|fees|charge|charges|vat|payment to|transfer to|cheque|chq|debit|dr|salary payment|direct debit|standing order)\b/i;
const INFLOW_WORDS = /\b(deposit|salary|credit|cr|received|transfer from|refund|interest|inward|cash deposit|collection)\b/i;

function normalizeGlyphs(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - "۰".charCodeAt(0)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

interface DateToken {
  start: number;
  end: number;
  date: Date;
}

function findDates(text: string): DateToken[] {
  const out: DateToken[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let date: Date | null = null;
    if (m[1]) date = utcDay(Number(m[1]), Number(m[2]), Number(m[3]));
    else if (m[4]) date = utcDay(m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6]), Number(m[5]), Number(m[4]));
    else if (m[7]) {
      const month = MONTHS[m[8].toLowerCase()];
      if (month) date = utcDay(m[9].length === 2 ? 2000 + Number(m[9]) : Number(m[9]), month, Number(m[7]));
    }
    if (date) out.push({ start: m.index!, end: m.index! + m[0].length, date });
  }
  return out;
}

interface AmountToken {
  start: number;
  end: number;
  value: number; // absolute
  sign: 1 | -1 | 0; // 0 = no cue
}

function findAmounts(text: string): AmountToken[] {
  const out: AmountToken[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const value = parseDecimal(`${m[3]}.${m[4]}`);
    if (value === null) continue;
    let sign: 1 | -1 | 0 = 0;
    const suffix = m[6]?.toLowerCase();
    if (m[1] && m[5]) sign = -1;
    else if (m[2] || m[7]) sign = -1;
    else if (suffix === "dr") sign = -1;
    else if (suffix === "cr") sign = 1;
    out.push({ start: m.index!, end: m.index! + m[0].length, value, sign });
  }
  return out;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

function pullBalance(text: string, label: RegExp): { value: number | null; text: string } {
  // a date written right before the phrase ("01/09/2026 Opening balance 1,000.00") belongs to the balance line, not to a row
  const re = new RegExp(`(?:(?:${DATE_RE.source})[ \\t]*)?(?:${label.source})[^\\d(\\-]{0,20}${AMOUNT_RE.source}`, "i");
  const m = text.match(re);
  if (!m) return { value: null, text };
  const amounts = findAmounts(m[0]);
  const last = amounts[amounts.length - 1];
  const value = last ? round2((last.sign === -1 ? -1 : 1) * last.value) : null;
  return { value, text: text.replace(m[0], " ") };
}

export function parsePdfStatementText(pages: string[]): PdfStatementResult {
  let text = normalizeGlyphs(pages.map((p) => p ?? "").join("\n")).replace(/[ \t\u00a0]+/g, " ");

  // "Statement period 01/06/2026 to 30/06/2026" is not a transaction
  let periodFrom: Date | null = null;
  let periodTo: Date | null = null;
  const period = text.match(/(?:statement\s+)?period[^\d]{0,15}([\d/.A-Za-z -]{6,20}?)\s+(?:to|-|–|until)\s+([\d/.A-Za-z -]{6,20}?)(?=\s|$)/i);
  if (period) {
    const a = findDates(period[1]);
    const b = findDates(period[2]);
    if (a.length && b.length) {
      periodFrom = a[0].date;
      periodTo = b[0].date;
      text = text.replace(period[0], " ");
    }
  }

  const open = pullBalance(text, /opening\s+balance|balance\s+brought\s+forward|previous\s+balance|b\/f/);
  text = open.text;
  const close = pullBalance(text, /closing\s+balance|balance\s+carried\s+forward|ending\s+balance|c\/f/);
  text = close.text;

  const dates = findDates(text);
  const rows: PdfStatementRow[] = [];
  let prevBalance = open.value;

  for (let i = 0; i < dates.length; i++) {
    let valueDate: Date | null = null;
    let endOfDates = dates[i].end;
    let next = i + 1;
    // two dates side by side: booking date then value date
    const gap = next < dates.length ? text.slice(endOfDates, dates[next].start) : "";
    if (next < dates.length && !gap.includes("\n") && gap.trim().length <= 2) {
      valueDate = dates[next].date;
      endOfDates = dates[next].end;
      next++;
    }
    const segmentEnd = next < dates.length ? dates[next].start : text.length;
    const segment = text.slice(endOfDates, segmentEnd);
    const amounts = findAmounts(segment);
    if (amounts.length === 0) {
      i = next - 1;
      continue;
    }

    const issues: string[] = [];
    const balanceToken = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const amountToken = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const balance = balanceToken ? round2((balanceToken.sign === -1 ? -1 : 1) * balanceToken.value) : null;

    let description = segment;
    for (const t of [...amounts].sort((a, b) => b.start - a.start)) description = description.slice(0, t.start) + " " + description.slice(t.end);
    description = collapse(description.replace(/\b(AED|USD|EUR|GBP)\b/g, " "));
    const ref = description.match(/\b([A-Z]{2,6}[-/]?\d{3,}|\d{8,})\b/);
    if (!description) {
      description = "Bank transaction";
      issues.push("no_description");
    }

    let sign: 1 | -1 | 0 = amountToken.sign;
    let amount = amountToken.value;
    if (prevBalance !== null && balance !== null) {
      const delta = round2(balance - prevBalance);
      if (Math.abs(Math.abs(delta) - amount) <= 0.01) {
        sign = delta < 0 ? -1 : 1;
      } else {
        issues.push("balance_gap");
        if (sign === 0) sign = delta < 0 ? -1 : 1;
      }
    }
    if (sign === 0) {
      if (OUTFLOW_WORDS.test(description) && !INFLOW_WORDS.test(description)) sign = -1;
      else if (INFLOW_WORDS.test(description) && !OUTFLOW_WORDS.test(description)) sign = 1;
      else {
        sign = -1;
        issues.push("sign_unknown");
      }
    }
    amount = round2(sign * amount);
    if (balance !== null) prevBalance = balance;

    rows.push({
      date: iso(dates[i].date),
      valueDate: valueDate ? iso(valueDate) : null,
      description,
      reference: ref ? ref[1] : null,
      amount,
      balance,
      issues,
    });
    i = next - 1;
  }

  const times = rows.map((r) => Date.parse(r.date));
  const from = periodFrom ?? (times.length ? new Date(Math.min(...times)) : null);
  const to = periodTo ?? (times.length ? new Date(Math.max(...times)) : null);
  const firstWithBalance = rows.find((r) => r.balance !== null);
  const lastWithBalance = [...rows].reverse().find((r) => r.balance !== null);
  return {
    rows,
    openingBalance: open.value ?? (firstWithBalance && firstWithBalance.balance !== null ? round2(firstWithBalance.balance - firstWithBalance.amount) : null),
    closingBalance: close.value ?? (lastWithBalance ? lastWithBalance.balance : null),
    statementFrom: from ? iso(from) : null,
    statementTo: to ? iso(to) : null,
  };
}

// The review grid for a staged PDF statement: row validation, the opening + rows = closing check and the rows
// sent to the commit route. Pure functions over text the person edits; no React, no fetching.

import type { StagedStatementRow } from "./banking-api-types";

export type RowIssueCode = "DATE_INVALID" | "AMOUNT_INVALID" | "AMOUNT_ZERO" | "DESCRIPTION_EMPTY" | "BALANCE_INVALID";

export interface ReviewRow {
  /** Stable client key for React. */
  key: string;
  date: string;
  valueDate?: string | null;
  description: string;
  reference: string | null;
  /** Editable text; signed (money out is negative). */
  amount: string;
  /** Editable text; empty when the statement line has no running balance. */
  balance: string;
  excluded: boolean;
  /** Issues the parser reported (`no_description`, `balance_gap`, `sign_unknown`). */
  serverIssues: string[];
}

export interface CommitRow {
  date: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
}

const toCents = (n: number): number => Math.round(n * 100);

/** "1,260.50", "(42.00)", "-19 425" -> number; null when the text is not one plain number. */
export function parseAmountText(text: string): number | null {
  let t = (text ?? "").trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/[\s,]/g, "");
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** A real calendar day written YYYY-MM-DD. */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** What is wrong with a row. An excluded row is not checked: it is not sent. */
export function rowIssues(row: ReviewRow): RowIssueCode[] {
  if (row.excluded) return [];
  const out: RowIssueCode[] = [];
  if (!isIsoDay(row.date)) out.push("DATE_INVALID");
  const amount = parseAmountText(row.amount);
  if (amount === null) out.push("AMOUNT_INVALID");
  else if (Math.abs(amount) < 0.005) out.push("AMOUNT_ZERO");
  if (!row.description.trim()) out.push("DESCRIPTION_EMPTY");
  if (row.balance.trim() && parseAmountText(row.balance) === null) out.push("BALANCE_INVALID");
  return out;
}

export interface BalanceCheck {
  status: "ok" | "mismatch" | "unknown";
  expectedClosing: number | null;
  difference: number | null;
}

/** Opening + the included rows = closing, in whole cents so 0.1 + 0.2 is 0.3. */
export function balanceCheck(args: { opening: number | null; closing: number | null; rows: ReviewRow[] }): BalanceCheck {
  if (args.opening === null || args.closing === null) return { status: "unknown", expectedClosing: null, difference: null };
  let cents = toCents(args.opening);
  for (const r of args.rows) {
    if (r.excluded) continue;
    const a = parseAmountText(r.amount);
    if (a !== null) cents += toCents(a);
  }
  const diff = toCents(args.closing) - cents;
  return { status: diff === 0 ? "ok" : "mismatch", expectedClosing: cents / 100, difference: diff / 100 };
}

let keySeq = 0;

export function fromStagedRows(rows: StagedStatementRow[]): ReviewRow[] {
  return rows.map((r) => ({
    key: `row-${++keySeq}`,
    date: r.date,
    valueDate: r.valueDate ?? null,
    description: r.description,
    reference: r.reference,
    amount: r.amount.toFixed(2),
    balance: typeof r.balance === "number" ? r.balance.toFixed(2) : "",
    excluded: false,
    serverIssues: r.issues ?? [],
  }));
}

export interface ReviewSummary {
  included: number;
  excluded: number;
  withIssues: number;
  canCommit: boolean;
}

export function summariseReview(rows: ReviewRow[]): ReviewSummary {
  const excluded = rows.filter((r) => r.excluded).length;
  const included = rows.length - excluded;
  const withIssues = rows.filter((r) => rowIssues(r).length > 0).length;
  return { included, excluded, withIssues, canCommit: included > 0 && withIssues === 0 };
}

/** The rows for POST .../imports/:id/commit; throws when a row still has an issue (the button is disabled before that). */
export function buildCommitRows(rows: ReviewRow[]): CommitRow[] {
  const out: CommitRow[] = [];
  for (const r of rows) {
    if (r.excluded) continue;
    if (rowIssues(r).length > 0) throw new Error("A row still has a problem; fix or exclude it before importing.");
    const balance = r.balance.trim() ? parseAmountText(r.balance) : null;
    out.push({
      date: r.date,
      valueDate: r.valueDate && isIsoDay(r.valueDate) ? r.valueDate : null,
      description: r.description.trim(),
      reference: r.reference?.trim() ? r.reference.trim() : null,
      amount: parseAmountText(r.amount) as number,
      balance,
    });
  }
  return out;
}

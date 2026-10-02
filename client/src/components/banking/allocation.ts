// One bank receipt over several invoices, and one bank line over several accounts: the arithmetic the match dialog
// shows before anything is posted. Whole cents throughout; the server re-checks every figure.

export interface OpenInvoice {
  id: string;
  number: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  outstanding: number;
}

export interface Allocation {
  invoiceId: string;
  /** The amount of the bank line that settles this invoice. */
  amount: number;
}

const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/** Fill the invoices in the order given until the bank line is used up; the last one may be partly paid. */
export function allocateInOrder(lineAmount: number, invoices: Array<Pick<OpenInvoice, "id" | "outstanding">>): { allocations: Allocation[]; remaining: number } {
  let left = cents(Math.abs(lineAmount));
  const allocations: Allocation[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, cents(inv.outstanding));
    if (take <= 0) continue;
    allocations.push({ invoiceId: inv.id, amount: fromCents(take) });
    left -= take;
  }
  return { allocations, remaining: fromCents(left) };
}

export type AllocationIssue = "NONE_SELECTED" | "OVER_LINE" | "OVER_OUTSTANDING" | "AMOUNT_INVALID";

export interface AllocationState {
  total: number;
  remaining: number;
  issues: AllocationIssue[];
  /** Money left after every listed invoice is paid in full: it needs the "keep as customer credit" choice. */
  excess: number;
  /** The excess can only be kept as credit when the last listed invoice is paid in full. */
  canKeepExcess: boolean;
}

export function allocationState(lineAmount: number, allocations: Allocation[], outstandingById: Record<string, number>): AllocationState {
  const line = cents(Math.abs(lineAmount));
  const total = allocations.reduce((s, a) => s + cents(a.amount), 0);
  const issues: AllocationIssue[] = [];
  if (allocations.length === 0) issues.push("NONE_SELECTED");
  if (allocations.some((a) => !Number.isFinite(a.amount) || cents(a.amount) <= 0)) issues.push("AMOUNT_INVALID");
  if (allocations.some((a) => cents(a.amount) > cents(outstandingById[a.invoiceId] ?? 0))) issues.push("OVER_OUTSTANDING");
  if (total > line) issues.push("OVER_LINE");
  const last = allocations[allocations.length - 1];
  const lastFull = !!last && cents(last.amount) === cents(outstandingById[last.invoiceId] ?? 0);
  const remaining = line - total;
  return { total: fromCents(total), remaining: fromCents(Math.max(0, remaining)), issues, excess: fromCents(Math.max(0, remaining)), canKeepExcess: remaining > 0 && lastFull };
}

// ─── split ─────────────────────────────────────────────────────────────────

export interface SplitAmountLine {
  accountId: string;
  amount: number;
  description?: string;
}

export type SplitIssue = "NO_LINES" | "TOO_MANY" | "ACCOUNT_MISSING" | "AMOUNT_INVALID" | "TOTAL_MISMATCH";

export function splitState(lineAmount: number, lines: SplitAmountLine[]): { total: number; remaining: number; issues: SplitIssue[] } {
  const line = cents(Math.abs(lineAmount));
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? cents(l.amount) : 0), 0);
  const issues: SplitIssue[] = [];
  if (lines.length === 0) issues.push("NO_LINES");
  if (lines.length > 10) issues.push("TOO_MANY");
  if (lines.some((l) => !l.accountId)) issues.push("ACCOUNT_MISSING");
  if (lines.some((l) => !Number.isFinite(l.amount) || cents(l.amount) <= 0)) issues.push("AMOUNT_INVALID");
  if (lines.length > 0 && total !== line) issues.push("TOTAL_MISMATCH");
  return { total: fromCents(total), remaining: fromCents(line - total), issues };
}

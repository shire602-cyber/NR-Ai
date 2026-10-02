// Split lines of a bank rule: validation, an even split and the example posting shown while the rule is edited.
// The arithmetic mirrors the server (largest remainder in cents, VAT carved out of the gross) so the example is what
// the rule will post; the server re-validates everything.

import type { BankAccount, LedgerAccount, RuleSplitLine } from "@/lib/banking-api-types";

export const MAX_SPLIT_LINES = 10;

export type SplitIssue = "LINES_COUNT" | "ACCOUNT_MISSING" | "PERCENT_RANGE" | "TOTAL_NOT_100";

/** Percents are held in basis points (two decimals) so 33.33 + 33.33 + 33.34 is exactly 100. */
const bp = (percent: number): number => Math.round(percent * 100);

export function splitTotal(lines: RuleSplitLine[]): number {
  return lines.reduce((s, l) => s + bp(Number(l.percent) || 0), 0) / 100;
}

export function splitIssues(lines: RuleSplitLine[]): SplitIssue[] {
  const out: SplitIssue[] = [];
  if (lines.length < 1 || lines.length > MAX_SPLIT_LINES) out.push("LINES_COUNT");
  if (lines.some((l) => !l.accountId)) out.push("ACCOUNT_MISSING");
  if (lines.some((l) => !Number.isFinite(Number(l.percent)) || Number(l.percent) <= 0 || Number(l.percent) > 100)) out.push("PERCENT_RANGE");
  if (lines.length > 0 && splitTotal(lines) !== 100) out.push("TOTAL_NOT_100");
  return out;
}

/** Equal percents for the given accounts; the first lines take the extra hundredths so the total is exactly 100. */
export function evenSplit(accountIds: string[]): RuleSplitLine[] {
  const n = accountIds.length;
  if (n === 0) return [];
  const base = Math.floor(10000 / n);
  let extra = 10000 - base * n;
  return accountIds.map((accountId) => {
    const units = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return { accountId, percent: units / 100 };
  });
}

const toCents = (n: number): number => Math.round(n * 100);

/** Largest-remainder split of whole cents by percent (ties go to the earlier line). */
function allocate(totalCents: number, percents: number[]): number[] {
  const scaled = percents.map((p) => totalCents * bp(p));
  const floors = scaled.map((x) => Math.floor(x / 10000));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = scaled.map((x, i) => ({ i, frac: x % 10000 })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

export interface PostingPreview {
  gross: number;
  vat: number;
  net: number;
  shares: Array<{ accountId: string; amount: number }>;
}

export function previewPosting(args: { gross: number; vatRate: number; lines: RuleSplitLine[] }): PostingPreview {
  const grossCents = toCents(args.gross);
  const vatCents = args.vatRate > 0 ? Math.round((grossCents * args.vatRate) / (100 + args.vatRate)) : 0;
  const netCents = grossCents - vatCents;
  const shares = allocate(netCents, args.lines.map((l) => Number(l.percent)));
  return {
    gross: grossCents / 100,
    vat: vatCents / 100,
    net: netCents / 100,
    shares: args.lines.map((l, i) => ({ accountId: l.accountId, amount: shares[i] / 100 })),
  };
}

const DOCUMENT_ONLY_CODES = new Set(["1040", "2010", "1050", "2020"]);
const BANK_OR_CASH_CODES = new Set(["1010", "1020", "1025"]);

/**
 * Accounts a rule's split lines may post to: active, not receivables, payables or VAT (documents move those), and
 * not a bank or cash account. The server applies the same rule when the rule is saved.
 */
export function ruleAccountOptions(accounts: LedgerAccount[], bankAccounts: Pick<BankAccount, "glAccountId">[]): LedgerAccount[] {
  const managed = new Set(bankAccounts.map((b) => b.glAccountId).filter((v): v is string => !!v));
  return accounts
    .filter((a) => {
      if (a.isActive === false || a.isArchived === true) return false;
      if (DOCUMENT_ONLY_CODES.has(a.code)) return false;
      if (a.type === "asset" && (managed.has(a.id) || BANK_OR_CASH_CODES.has(a.code) || /\b(bank|cash)\b/i.test(a.nameEn))) return false;
      return true;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

// Bank rules, pure parts: split lines, VAT, safe regular expressions, and whether a rule fits a bank line.
//
// A rule posts the whole bank line: outflow Dr split accounts (net) [+ Dr 1050 VAT] / Cr bank (gross);
// inflow Dr bank / Cr split accounts. The gross is split by percent with largest-remainder rounding in cents, so the
// lines always add up to the net to the cent (33.33 / 33.33 / 33.34 of 100.01 posts 33.33 / 33.33 / 33.35).

import Decimal from "decimal.js";

export interface SplitLine {
  accountId: string;
  percent: number;
  description?: string;
}

export const MAX_SPLIT_LINES = 10;
export const MAX_REGEX_LENGTH = 64;
export const MAX_MATCH_TEXT = 500;
export const RULE_VAT_RATES = [0, 5] as const;

/** null when the shape is valid; else a message. Account ownership is checked against the database elsewhere. */
export function validateSplitShape(lines: SplitLine[]): string | null {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_SPLIT_LINES) {
    return `A rule needs 1 to ${MAX_SPLIT_LINES} split lines.`;
  }
  let total = new Decimal(0);
  for (const l of lines) {
    if (!l || typeof l.accountId !== "string" || !l.accountId) return "Every split line needs an account.";
    const p = Number(l.percent);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return "Every split percent must be above 0 and at most 100.";
    total = total.plus(p);
  }
  if (total.minus(100).abs().greaterThan("0.001")) return `The split percents add up to ${total.toFixed(2)}, not 100.`;
  return null;
}

export interface RulePosting {
  gross: number;
  vat: number;
  net: number;
  shares: Array<{ accountId: string; amount: number; description?: string }>;
}

const toCents = (n: number): number => new Decimal(n).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

/** Largest-remainder split of `totalCents` by percent (ties go to the earlier line). */
export function allocateByPercent(totalCents: number, percents: number[]): number[] {
  const exact = percents.map((p) => new Decimal(totalCents).times(p).dividedBy(100));
  const floors = exact.map((e) => e.floor().toNumber());
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(e.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

/** gross = the bank amount (positive). VAT is carved out of the gross: round2(gross x rate / (100 + rate)). */
export function computeRulePosting(args: { gross: number; vatRate: number; splitLines: SplitLine[] }): RulePosting {
  const grossCents = toCents(args.gross);
  const vatCents =
    args.vatRate > 0 ? new Decimal(grossCents).times(args.vatRate).dividedBy(100 + args.vatRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() : 0;
  const netCents = grossCents - vatCents;
  const alloc = allocateByPercent(netCents, args.splitLines.map((l) => Number(l.percent)));
  return {
    gross: grossCents / 100,
    vat: vatCents / 100,
    net: netCents / 100,
    shares: args.splitLines.map((l, i) => ({ accountId: l.accountId, amount: alloc[i] / 100, description: l.description })),
  };
}

/**
 * A regular expression typed by a user runs against bank text, so it must not be able to backtrack catastrophically.
 * Refused: long patterns, back-references, lookarounds, a quantified group that contains a quantifier or an
 * alternation (the shapes behind (a+)+ and (a|aa)+).
 */
export function isRegexSafe(pattern: string): boolean {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > MAX_REGEX_LENGTH) return false;
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }
  if (/\\[1-9]|\\k</.test(pattern)) return false;
  if (/\(\?<?[=!]/.test(pattern)) return false;
  // walk the groups: a group that closes into a quantifier must hold no quantifier and no alternation inside
  const stack: Array<{ start: number; hasInner: boolean }> = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") {
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "(") stack.push({ start: i, hasInner: false });
    else if (ch === ")") {
      const g = stack.pop();
      if (!g) return false;
      const next = pattern[i + 1];
      if (g.hasInner && (next === "+" || next === "*" || next === "{")) return false;
      if (stack.length && g.hasInner) stack[stack.length - 1].hasInner = true;
    } else if (stack.length && (ch === "+" || ch === "*" || ch === "|" || ch === "{")) {
      for (const g of stack) g.hasInner = true;
    }
  }
  return stack.length === 0;
}

export interface RuleLike {
  matchField: string;
  matchType: string;
  matchValue: string;
  direction?: string | null;
  bankAccountId?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  vatRate?: number | null;
}

export interface RuleTxn {
  description: string;
  reference: string | null;
  amount: number;
  bankStatementAccountId?: string | null;
}

function fieldValue(txn: RuleTxn, field: string): string | null {
  if (field === "description") return txn.description;
  if (field === "reference") return txn.reference;
  if (field === "amount") return Math.abs(txn.amount).toFixed(2);
  return null;
}

/** Does this rule apply to this bank line? Pure; regexes are re-checked for safety every time. */
export function ruleMatches(rule: RuleLike, txn: RuleTxn): boolean {
  const inflow = txn.amount > 0;
  const dir = rule.direction ?? "any";
  if (dir === "inflow" && !inflow) return false;
  if (dir === "outflow" && inflow) return false;
  if (inflow && Number(rule.vatRate ?? 0) > 0) return false; // VAT is only carved out of outflows
  if (rule.bankAccountId && rule.bankAccountId !== txn.bankStatementAccountId) return false;
  const abs = Math.abs(txn.amount);
  if (rule.amountMin != null && abs < Number(rule.amountMin) - 0.005) return false;
  if (rule.amountMax != null && abs > Number(rule.amountMax) + 0.005) return false;

  const raw = fieldValue(txn, rule.matchField);
  if (raw == null) return false;
  const text = raw.slice(0, MAX_MATCH_TEXT);
  const lower = text.toLowerCase();
  const needle = rule.matchValue.toLowerCase();
  switch (rule.matchType) {
    case "contains":
      return lower.includes(needle);
    case "equals":
    case "exact":
      return lower === needle;
    case "starts_with":
      return lower.startsWith(needle);
    case "regex":
      if (!isRegexSafe(rule.matchValue)) return false;
      try {
        return new RegExp(rule.matchValue, "i").test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

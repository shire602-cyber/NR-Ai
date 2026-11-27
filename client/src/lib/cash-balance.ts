/**
 * P2 negative cash wording: one rule for how a cash or bank balance below zero is worded.
 *
 * - The figure keeps its sign (true minus, from `formatMoneyParts`), never `Math.abs` with only
 *   a red tint: a bare "AED 1,234.00" in red reads as money in the bank to anyone who cannot
 *   see the colour.
 * - Next to it sits a text label, "Overdrawn" / "مكشوف" for an actual balance and
 *   "Negative balance" / "رصيد سالب" for a projected one, so the meaning never rests on colour.
 * - A balance that rounds to zero (−0.004) is zero, not overdrawn.
 *
 * `<CashBalance>` (client/src/components/ui/cash-balance.tsx) renders this; `cashBalanceText`
 * is the plain-string form for aria labels, tooltips and toasts.
 */

import { formatMoneyParts, formatMoneyText, type MoneyLocale } from "./format-money";

export type CashBalanceState = "overdrawn" | "zero" | "positive";

/** "actual": a booked or bank balance. "projected": a forecast figure. */
export type CashBalanceKind = "actual" | "projected";

export const CASH_BALANCE_LABEL_KEYS: Record<CashBalanceKind, string> = {
  actual: "components.cashBalance.overdrawn",
  projected: "components.cashBalance.negative",
};

/** Sign of a balance at money precision: −0.004 is zero, −0.005 is overdrawn. */
export function cashBalanceState(
  amount: number | string | null | undefined,
  fractionDigits = 2
): CashBalanceState | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const parts = formatMoneyParts(value, "AED", "en", { fractionDigits });
  if (parts.isZero) return "zero";
  return parts.isNegative ? "overdrawn" : "positive";
}

export interface CashAccountLike {
  type?: string | null;
  subType?: string | null;
  code?: string | null;
  nameEn?: string | null;
}

/**
 * Cash, bank or petty cash asset account. Mirrors server/reporting/classify.ts `isCashAccount`
 * (the rule the balance sheet uses for its "overdrawn cash" warning).
 */
export function isCashOrBankAccount(a: CashAccountLike | null | undefined): boolean {
  if (!a || a.type !== "asset") return false;
  if (a.subType === "cash" || a.subType === "bank") return true;
  const code = a.code ?? "";
  if (code >= "1010" && code <= "1039") return true;
  const name = (a.nameEn ?? "").toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

/** The label for a negative balance in `t`'s locale, or "" when the balance is not negative. */
export function cashBalanceLabel(
  amount: number | string | null | undefined,
  t: Record<string, string>,
  kind: CashBalanceKind = "actual"
): string {
  if (cashBalanceState(amount) !== "overdrawn") return "";
  const key = CASH_BALANCE_LABEL_KEYS[kind];
  return t[key] ?? key;
}

/** Plain-string balance: "AED −1,234.00 (Overdrawn)" / "−1,234.00 د.إ (مكشوف)" (isolated). */
export function cashBalanceText(
  amount: number,
  currency: string | null | undefined,
  locale: MoneyLocale,
  t: Record<string, string>,
  kind: CashBalanceKind = "actual"
): string {
  const money = formatMoneyText(amount, currency, locale);
  const label = cashBalanceLabel(amount, t, kind);
  return label ? `${money} (${label})` : money;
}

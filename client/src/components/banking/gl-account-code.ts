// Suggesting the next free code for a new ledger account, from the numbering the chart of accounts already uses.

export type AccountKind = "asset" | "liability" | "equity" | "income" | "expense";

/** The thousand each kind of account lives in (1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx expenses). */
export const KIND_BASE: Record<AccountKind, number> = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 };

/** The next unused four-digit code in the kind's range (after the highest, or from `from`); "" when the range is full or the kind is unknown. */
export function nextAccountCode(codes: string[], kind: AccountKind, from?: number): string {
  const base = KIND_BASE[kind];
  if (!base) return "";
  const used = new Set(codes.map((c) => c.trim()));
  const inRange = codes.map((c) => Number(c)).filter((n) => Number.isInteger(n) && n >= base && n < base + 1000);
  // `from` starts the search inside the range (bank accounts live at 1021 and up, not after the fixed assets)
  let candidate = from !== undefined && from >= base && from < base + 1000 ? from : inRange.length ? Math.max(...inRange) + 1 : base + 1;
  while (used.has(String(candidate)) && candidate < base + 1000) candidate += 1;
  return candidate < base + 1000 && !used.has(String(candidate)) ? String(candidate) : "";
}

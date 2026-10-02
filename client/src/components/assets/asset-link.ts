// Linking a fixed asset to the document that bought it, and creating an asset from a bill line.
// Pure helpers over the lists the screens already load.

export interface BillLine {
  id: string;
  description: string;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  amount?: number | string | null;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The net cost of a bill line: its amount, else quantity x unit price. */
export function billLineCost(line: BillLine): number {
  const amount = Number(line.amount);
  if (Number.isFinite(amount) && amount > 0) return r2(amount);
  const q = Number(line.quantity ?? 1);
  const p = Number(line.unit_price ?? 0);
  return Number.isFinite(q) && Number.isFinite(p) ? r2(q * p) : 0;
}

export interface JournalLike {
  id: string;
  entryNumber: string;
  date: string;
  memo?: string | null;
  status?: string;
  lines?: Array<{ debit: number | string; credit: number | string; account?: { code?: string | null } | null }>;
}

export interface JournalCandidate {
  id: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  /** What the entry debits to the fixed-asset cost account. */
  cost: number;
}

/** Posted entries that debit fixed assets at cost (1290): the journals an asset's purchase can be linked to. */
export function journalCostCandidates(entries: JournalLike[], costCode = "1290"): JournalCandidate[] {
  return entries
    .filter((e) => (e.status ?? "posted") === "posted")
    .map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      date: e.date,
      memo: e.memo ?? null,
      cost: r2((e.lines ?? []).filter((l) => l.account?.code === costCode).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0)),
    }))
    .filter((c) => c.cost > 0.004)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** True when a document's amount is the asset's cost (to the fils): the likely match, shown first. */
export function matchesCost(amount: number, cost: number): boolean {
  return Math.abs(amount - cost) < 0.005;
}

/** Candidates that match the cost first, newest first within each group. */
export function sortByCostMatch<T extends { date: string }>(items: T[], amountOf: (i: T) => number, cost: number): T[] {
  return [...items].sort((a, b) => Number(matchesCost(amountOf(b), cost)) - Number(matchesCost(amountOf(a), cost)) || b.date.localeCompare(a.date));
}

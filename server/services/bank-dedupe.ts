// Which incoming bank lines are already in the books?
//
// Key = bank account + Dubai calendar day + signed amount. The description is NOT in the key: an OFX NAME, a CSV
// narrative and a Lean description of one movement all differ. Because two genuine lines can share a day and an
// amount (two AED 5.00 parking fees), duplicates are counted as a multiset: of N incoming lines with a key where M
// already exist, N - M are new. A re-upload therefore adds nothing and identical same-day lines survive.
// A bank-supplied external id (FITID, AcctSvcrRef, Lean id) is checked first.

import { uaeYmdParts } from "../utils/date";

export interface DedupeLine {
  date: Date;
  amount: number;
  externalId: string | null;
}

export interface ExistingBankLine {
  dedupeKey: string | null;
  externalId: string | null;
}

export function dedupeKey(date: Date, amount: number): string {
  const { year, month, day } = uaeYmdParts(date);
  const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const rounded = Math.round(amount * 100) / 100;
  return `${ymd}|${(Object.is(rounded, -0) ? 0 : rounded).toFixed(2)}`;
}

export interface DedupePlan {
  /** Indexes into `incoming` to insert. */
  insert: number[];
  /** Indexes into `incoming` that are already present (or repeat an id inside the batch). */
  duplicates: number[];
}

export function planBankInsert(existing: ExistingBankLine[], incoming: DedupeLine[]): DedupePlan {
  const existingIds = new Set(existing.map((e) => e.externalId).filter((v): v is string => !!v));
  const existingByKey = new Map<string, number>();
  for (const e of existing) {
    if (e.dedupeKey) existingByKey.set(e.dedupeKey, (existingByKey.get(e.dedupeKey) ?? 0) + 1);
  }

  const duplicates = new Set<number>();
  const batchIds = new Set<string>();
  const groups = new Map<string, { all: number[]; fresh: number[] }>();

  incoming.forEach((line, i) => {
    const key = dedupeKey(line.date, line.amount);
    const group = groups.get(key) ?? { all: [], fresh: [] };
    groups.set(key, group);
    group.all.push(i);
    if (line.externalId) {
      if (existingIds.has(line.externalId) || batchIds.has(line.externalId)) {
        duplicates.add(i);
        return;
      }
      batchIds.add(line.externalId);
    }
    group.fresh.push(i);
  });

  const insert: number[] = [];
  for (const [key, group] of groups) {
    const needed = Math.max(0, group.all.length - (existingByKey.get(key) ?? 0));
    const take = group.fresh.slice(0, needed);
    insert.push(...take);
    for (const i of group.fresh.slice(needed)) duplicates.add(i);
  }
  insert.sort((a, b) => a - b);
  return { insert, duplicates: Array.from(duplicates).sort((a, b) => a - b) };
}

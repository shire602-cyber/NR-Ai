// Firm consolidation (Phase 8 D4): a consolidated P&L or balance sheet across several companies with intercompany
// eliminations. Pure given the per-entity account totals, so it is unit tested.
//
// An account may name the group company on the other side (accounts.intercompany_company_id, migration 0116). For every
// pair of entities, the debit-minus-credit of the accounts that name each other must net to zero (A's receivable from B
// against B's payable to A; A's sales to B against B's purchases from A), separately for balance-sheet and P&L
// accounts. A pair that does not net to zero is UNMATCHED_INTERCOMPANY: the books of the two companies disagree and
// eliminating a one-sided balance would hide it, so that pair is NOT eliminated and is reported with its difference (a
// warning row); with `strict` it is refused (422) instead. Matching pairs have each intercompany account eliminated in
// full, so the consolidated column = sum of the entities + eliminations, and eliminations net to zero on the debit side.

import { AppError } from "../errors";
import { round2 } from "../services/financial-statements";
import type { AccountTotal } from "./ledger";

export type StatementKind = "pl" | "bs";

export interface ConsolidationEntity {
  id: string;
  name: string;
  accounts: AccountTotal[];
}

export interface ConsolidatedAccountRow {
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  /** Natural-side amount per entity (same order as the input), AED. */
  amounts: number[];
  /** Elimination (usually negative), AED. */
  elimination: number;
  consolidated: number;
}

export interface Consolidation {
  statement: StatementKind;
  rows: ConsolidatedAccountRow[];
  /** Per entity: earnings not yet closed into equity (balance sheet only). */
  earnings: { amounts: number[]; consolidated: number } | null;
  /** Debit-minus-credit of everything eliminated; 0 when the pairs match. */
  eliminationNet: number;
  /** Intercompany pairs whose two sides disagree: left in the statement (not eliminated), with the difference. */
  unmatched: Array<{ pair: string; difference: number }>;
}

const isPl = (type: string) => type === "income" || type === "expense";
const natural = (a: AccountTotal): number =>
  a.type === "asset" || a.type === "expense" ? round2(a.debit - a.credit) : round2(a.credit - a.debit);

function unmatched(pair: string, group: "balance sheet" | "P&L", difference: number): AppError {
  return new AppError({
    message: `Intercompany balances do not match (${group}): the companies' books differ by ${difference.toFixed(2)}. Correct them before consolidating.`,
    statusCode: 422,
    code: "UNMATCHED_INTERCOMPANY",
    details: { difference, pair, group },
  });
}

export function consolidate(entities: ConsolidationEntity[], statement: StatementKind, opts: { strict?: boolean } = {}): Consolidation {
  const ids = new Set(entities.map((e) => e.id));

  // 1. Intercompany pairs must net to zero, per statement group.
  const pairNet = new Map<string, number>();
  for (const e of entities) {
    for (const a of e.accounts) {
      const other = a.intercompanyCompanyId;
      if (!other || other === e.id || !ids.has(other)) continue;
      if (statement === "pl" ? !isPl(a.type) : isPl(a.type)) continue;
      const pair = [e.id, other].sort().join("|");
      pairNet.set(pair, round2((pairNet.get(pair) ?? 0) + (a.debit - a.credit)));
    }
  }
  const mismatched = new Map<string, number>();
  for (const [pair, net] of pairNet) {
    if (Math.abs(net) < 0.005) continue;
    if (opts.strict) throw unmatched(pair, statement === "pl" ? "P&L" : "balance sheet", Math.abs(net));
    mismatched.set(pair, round2(Math.abs(net)));
  }

  // 2. Rows by account code: natural amount per entity, elimination of the intercompany ones.
  const byCode = new Map<string, ConsolidatedAccountRow>();
  let eliminationNet = 0;
  const earningsAmounts = entities.map(() => 0);
  entities.forEach((e, index) => {
    for (const a of e.accounts) {
      if (statement === "pl" ? !isPl(a.type) : false) continue;
      if (statement === "bs" && isPl(a.type)) {
        earningsAmounts[index] = round2(earningsAmounts[index] + (a.credit - a.debit));
        continue;
      }
      const row =
        byCode.get(a.code) ??
        ({ code: a.code, name: a.nameEn, nameAr: a.nameAr, type: a.type, amounts: entities.map(() => 0), elimination: 0, consolidated: 0 } as ConsolidatedAccountRow);
      row.amounts[index] = round2(row.amounts[index] + natural(a));
      const other = a.intercompanyCompanyId;
      if (other && other !== e.id && ids.has(other) && !mismatched.has([e.id, other].sort().join("|"))) {
        row.elimination = round2(row.elimination - natural(a));
        eliminationNet = round2(eliminationNet + (a.debit - a.credit));
      }
      byCode.set(a.code, row);
    }
  });
  const rows = [...byCode.values()]
    .map((r) => ({ ...r, consolidated: round2(r.amounts.reduce((s, v) => s + v, 0) + r.elimination) }))
    .filter((r) => r.amounts.some((v) => v !== 0) || r.elimination !== 0)
    .sort((x, y) => x.code.localeCompare(y.code));
  const earnings =
    statement === "bs" ? { amounts: earningsAmounts, consolidated: round2(earningsAmounts.reduce((s, v) => s + v, 0)) } : null;
  return { statement, rows, earnings, eliminationNet, unmatched: [...mismatched].map(([pair, difference]) => ({ pair, difference })) };
}

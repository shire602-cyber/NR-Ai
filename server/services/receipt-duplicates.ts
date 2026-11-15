// Duplicate detection for receipt uploads (R05-18).
//   exact : identical stored content (content_sha256) -> upload is blocked with 409
//   fuzzy : similar merchant + same amount + nearby date -> warning, upload proceeds
// Merchant comparison is Arabic-aware (shared normaliser).

import { normalizeMerchantKey } from "../../shared/arabic-text";

export interface ReceiptLike {
  id: string;
  merchant?: string | null;
  amount?: number | null;
  vatAmount?: number | null;
  date?: Date | string | null;
  category?: string | null;
}

export interface DuplicateProbe {
  merchant?: string | null;
  amount?: number | null;
  vatAmount?: number | null;
  date?: Date | string | null;
}

export interface DuplicateMatch {
  id: string;
  merchant: string | null;
  amount: number | null;
  date: string | null;
  category: string | null;
  reasons: string[];
  similarity: number;
}

const DAY_MS = 86_400_000;

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams of the normalised merchant keys, 0..1. */
export function merchantSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const x = normalizeMerchantKey(a);
  const y = normalizeMerchantKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  const total =
    [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function gross(r: { amount?: number | null; vatAmount?: number | null }): number {
  return (Number(r.amount) || 0) + (Number(r.vatAmount) || 0);
}

/**
 * Fuzzy duplicates: merchant similarity >= 0.7 AND gross amount equal within 0.5% (min 0.05)
 * AND dates within `windowDays` (when both dates are known).
 */
export function findFuzzyDuplicates(
  probe: DuplicateProbe,
  existing: ReceiptLike[],
  opts: { windowDays?: number; minSimilarity?: number } = {}
): DuplicateMatch[] {
  const windowDays = opts.windowDays ?? 3;
  const minSimilarity = opts.minSimilarity ?? 0.7;
  const probeAmount = gross(probe);
  const probeMs = toMs(probe.date);
  if (!probe.merchant || probeAmount <= 0) return [];

  const matches: DuplicateMatch[] = [];
  for (const r of existing) {
    const similarity = merchantSimilarity(probe.merchant, r.merchant);
    if (similarity < minSimilarity) continue;
    const amount = gross(r);
    if (Math.abs(amount - probeAmount) > Math.max(0.05, probeAmount * 0.005)) continue;
    const rMs = toMs(r.date);
    if (probeMs !== null && rMs !== null && Math.abs(probeMs - rMs) > windowDays * DAY_MS) continue;
    matches.push({
      id: r.id,
      merchant: r.merchant ?? null,
      amount: r.amount ?? null,
      date: rMs === null ? null : new Date(rMs).toISOString(),
      category: r.category ?? null,
      reasons: [
        `Merchant ${(similarity * 100).toFixed(0)}% similar`,
        "Same amount",
        ...(probeMs !== null && rMs !== null ? [`Within ${windowDays} days`] : []),
      ],
      similarity: Math.round(similarity * 100) / 100,
    });
  }
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

/**
 * Crash-safe version of the manual "check similar" rule: at least two of
 * merchant similarity, amount within 10% and date within 7 days.
 */
export function checkSimilar(probe: DuplicateProbe, existing: ReceiptLike[]): ReceiptLike[] {
  const probeAmount = Number(probe.amount) || 0;
  const probeMs = toMs(probe.date);
  return existing.filter((r) => {
    const merchantMatch = probe.merchant
      ? merchantSimilarity(probe.merchant, r.merchant) >= 0.7
      : false;
    const amountMatch =
      probeAmount > 0 &&
      Number(r.amount) > 0 &&
      Math.abs(Number(r.amount) - probeAmount) / probeAmount < 0.1;
    const rMs = toMs(r.date);
    const dateMatch = probeMs !== null && rMs !== null && Math.abs(probeMs - rMs) <= 7 * DAY_MS;
    return [merchantMatch, amountMatch, dateMatch].filter(Boolean).length >= 2;
  });
}

// ---- database lookups (set-based) -------------------------------------------------

async function query(sql: string, params: unknown[]): Promise<Array<Record<string, any>>> {
  const { pool } = await import("../db");
  return (await (pool as any).query(sql, params)).rows;
}

function mapRow(r: Record<string, any>): ReceiptLike {
  return {
    id: r.id,
    merchant: r.merchant,
    amount: r.amount === null ? null : Number(r.amount),
    vatAmount: r.vat_amount === null ? null : Number(r.vat_amount),
    date: r.date,
    category: r.category,
  };
}

/** Receipt in the same company with identical stored content, if any. */
export async function findReceiptByContentHash(
  companyId: string,
  sha256: string
): Promise<ReceiptLike | null> {
  const rows = await query(
    `SELECT id, merchant, amount, vat_amount, date, category FROM receipts
      WHERE company_id = $1 AND content_sha256 = $2 ORDER BY created_at DESC LIMIT 1`,
    [companyId, sha256]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Candidate receipts within the date window around the probe (bounded, indexed by company/date). */
export async function findFuzzyDuplicatesInDb(
  companyId: string,
  probe: DuplicateProbe,
  windowDays = 3
): Promise<DuplicateMatch[]> {
  const ms = toMs(probe.date);
  if (ms === null) return [];
  const rows = await query(
    `SELECT id, merchant, amount, vat_amount, date, category FROM receipts
      WHERE company_id = $1 AND date >= $2 AND date <= $3 LIMIT 500`,
    [companyId, new Date(ms - windowDays * DAY_MS), new Date(ms + windowDays * DAY_MS)]
  );
  return findFuzzyDuplicates(probe, rows.map(mapRow), { windowDays });
}

// F02 — effective VAT return version selection.
//
// A company/period can hold several VAT return rows: the original, one or more
// amendments, and drafts of an amendment that has not taken effect yet. The
// "effective" version for a company + period is the most recently submitted
// row. Candidates are rows with status submitted, filed or amended (an amended
// row was submitted once), ranked by submittedAt (createdAt as fallback); the
// latest wins. amendVatReturn marks the original "amended" as soon as the
// amendment DRAFT is created, so an amended original stays effective until a
// later version is submitted or filed. Draft / pending_review / ready rows never
// count. Amendment history is preserved — this selects, it never deletes.
//
// Summary cards and their drilldowns must use the same selection so a card
// total always equals the sum of the rows it links to.
//
// The card measures NET VAT DECLARED (Box 14: payable positive, refundable
// negative) on effective returns. It is not outstanding cash — payment status
// needs separate payment evidence.

export interface VatReturnVersionLike {
  id: string;
  companyId: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  status: string;
  submittedAt?: string | Date | null;
  createdAt?: string | Date | null;
  box14PayableTax?: number | string | null;
}

const EFFECTIVE_STATUSES = new Set(["submitted", "filed", "amended"]);

function dayKey(d: string | Date): string {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? String(d) : date.toISOString().slice(0, 10);
}

function ts(d: string | Date | null | undefined): number {
  if (!d) return 0;
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function vatReturnPeriodKey(r: VatReturnVersionLike): string {
  return `${r.companyId}|${dayKey(r.periodStart)}|${dayKey(r.periodEnd)}`;
}

/** One effective return per company + period (never drafts). */
export function selectEffectiveVatReturns<T extends VatReturnVersionLike>(
  returns: readonly T[]
): T[] {
  const best = new Map<string, T>();
  for (const r of returns) {
    if (!EFFECTIVE_STATUSES.has(r.status)) continue;
    const key = vatReturnPeriodKey(r);
    const current = best.get(key);
    const rank = (x: T) => [ts(x.submittedAt) || ts(x.createdAt), ts(x.createdAt)] as const;
    if (!current) {
      best.set(key, r);
      continue;
    }
    const [a1, a2] = rank(r);
    const [b1, b2] = rank(current);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best.set(key, r);
  }
  return Array.from(best.values());
}

/** Net Box 14 across effective returns (payable +, refundable −), in fils-safe sum. */
export function effectiveNetVatDeclared(returns: readonly VatReturnVersionLike[]): number {
  const fils = selectEffectiveVatReturns(returns).reduce(
    (sum, r) => sum + Math.round((Number(r.box14PayableTax) || 0) * 100),
    0
  );
  return fils / 100;
}

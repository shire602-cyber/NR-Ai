// F02 — effective VAT return version selection.
//
// A company/period can hold several VAT return rows: the original, one or more
// amendments, and drafts of an amendment that has not taken effect yet. The
// "effective" version for a company + period is selected from submitted, filed
// and amended rows. An effective amendment supersedes its amendsReturnId even
// when its recorded filing date is earlier. Among the remaining candidates,
// the latest submittedAt wins (createdAt as fallback and tie-breaker).
// amendVatReturn marks the original "amended" when it creates the amendment
// draft, so the original stays effective until the amendment is submitted or filed.
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
  amendsReturnId?: string | null;
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
  const periods = new Map<string, { candidates: T[]; superseded: Set<string> }>();
  for (const r of returns) {
    if (!EFFECTIVE_STATUSES.has(r.status)) continue;
    const key = vatReturnPeriodKey(r);
    let period = periods.get(key);
    if (!period) {
      period = { candidates: [], superseded: new Set() };
      periods.set(key, period);
    }
    period.candidates.push(r);
    if (r.amendsReturnId && r.amendsReturnId !== r.id) period.superseded.add(r.amendsReturnId);
  }

  const effective: T[] = [];
  const rank = (r: T) => [ts(r.submittedAt) || ts(r.createdAt), ts(r.createdAt)] as const;
  for (const { candidates, superseded } of periods.values()) {
    let best: T | undefined;
    for (const candidate of candidates) {
      if (superseded.has(candidate.id)) continue;
      if (!best) {
        best = candidate;
        continue;
      }
      const [submitted, created] = rank(candidate);
      const [bestSubmitted, bestCreated] = rank(best);
      if (submitted > bestSubmitted || (submitted === bestSubmitted && created > bestCreated)) {
        best = candidate;
      }
    }
    if (best) effective.push(best);
  }
  return effective;
}

/** Net Box 14 across effective returns (payable +, refundable −), in fils-safe sum. */
export function effectiveNetVatDeclared(returns: readonly VatReturnVersionLike[]): number {
  const fils = selectEffectiveVatReturns(returns).reduce(
    (sum, r) => sum + Math.round((Number(r.box14PayableTax) || 0) * 100),
    0
  );
  return fils / 100;
}

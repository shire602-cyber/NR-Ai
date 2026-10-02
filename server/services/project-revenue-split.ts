// Split the revenue legs of an invoice journal by project (Phase 8 D2). Pure: no database.
//
// allocateRevenueCredits groups an invoice's net amounts per revenue ACCOUNT (and several callers key on the
// account alone), so it is left untouched. This runs on the legs it produced: a leg whose account is fed by
// lines that carry a project is replaced by one leg per project, in proportion to those lines' net amounts, the
// last piece taking the rounding remainder so the legs still add up to the original leg exactly. An invoice with
// no project line gets back exactly the legs it was given.

export interface SplitLine {
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
  revenueAccountId?: string | null;
  projectId?: string | null;
}

export interface RevenueLeg {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  projectId?: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function splitRevenueLegsByProject<L extends RevenueLeg>(
  legs: L[],
  lines: SplitLine[],
  ctx: { defaultAccountId: string; zeroRatedAccountId?: string | null }
): L[] {
  if (!lines.some((l) => l.projectId)) return legs;

  // The account each line feeds, by the same rule as allocateRevenueCredits.
  const accountOf = (l: SplitLine): string =>
    l.revenueAccountId || (Number(l.vatRate) === 0 && ctx.zeroRatedAccountId ? ctx.zeroRatedAccountId : ctx.defaultAccountId);

  const out: L[] = [];
  for (const leg of legs) {
    const fed = lines.filter((l) => accountOf(l) === leg.accountId);
    if (!fed.some((l) => l.projectId)) {
      out.push(leg);
      continue;
    }
    const netByProject = new Map<string, number>();
    for (const l of fed) {
      const key = l.projectId ?? "";
      netByProject.set(key, (netByProject.get(key) ?? 0) + Number(l.quantity) * Number(l.unitPrice));
    }
    const total = [...netByProject.values()].reduce((s, v) => s + v, 0);
    if (Math.abs(total) < 0.005) {
      out.push(leg);
      continue;
    }
    const amount = leg.credit > 0 ? leg.credit : leg.debit;
    const keys = [...netByProject.keys()];
    let allocated = 0;
    keys.forEach((key, index) => {
      const isLast = index === keys.length - 1;
      const piece = isLast ? round2(amount - allocated) : round2((amount * (netByProject.get(key) ?? 0)) / total);
      allocated = round2(allocated + piece);
      if (piece === 0) return;
      out.push({
        ...leg,
        debit: leg.credit > 0 ? 0 : piece,
        credit: leg.credit > 0 ? piece : 0,
        ...(key ? { projectId: key } : {}),
      });
    });
  }
  return out;
}

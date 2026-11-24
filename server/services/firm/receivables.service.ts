/**
 * Firm receivables in AED. The open and overdue balances come from the settlement rule
 * (`server/reporting/firm-receivables.ts`) in each company's base currency; a company whose
 * base currency is not AED is converted with `fx.convert` using that company's own rates.
 */
import { resolve } from "../../platform/service-registry";
import { receivablesByCompany, type CompanyReceivables } from "../../reporting/firm-receivables";
import type { FxConvert } from "../fx";

export interface CompanyReceivablesAed {
  companyId: string;
  /** AED, 2 dp. */
  open: number;
  overdue: number;
  openCount: number;
  overdueCount: number;
}

async function toAedFils(r: CompanyReceivables, fils: number): Promise<number> {
  if (fils === 0 || r.baseCurrency === "AED") return fils;
  try {
    const c = await resolve<FxConvert>("fx.convert")(r.companyId, fils, r.baseCurrency, "AED");
    return c.convertedFils;
  } catch {
    // No rate for this company: leave it out of the AED total rather than add a foreign amount.
    return 0;
  }
}

export async function firmReceivablesAed(
  companyIds: string[]
): Promise<Map<string, CompanyReceivablesAed>> {
  const raw = await receivablesByCompany(companyIds);
  const out = new Map<string, CompanyReceivablesAed>();
  for (const r of raw.values()) {
    const [open, overdue] = await Promise.all([
      toAedFils(r, r.openFils),
      toAedFils(r, r.overdueFils),
    ]);
    out.set(r.companyId, {
      companyId: r.companyId,
      open: open / 100,
      overdue: overdue / 100,
      openCount: r.openCount,
      overdueCount: r.overdueCount,
    });
  }
  return out;
}

export function sumReceivables(map: Map<string, CompanyReceivablesAed>) {
  let open = 0;
  let overdue = 0;
  for (const r of map.values()) {
    open += Math.round(r.open * 100);
    overdue += Math.round(r.overdue * 100);
  }
  return { open: open / 100, overdue: overdue / 100 };
}

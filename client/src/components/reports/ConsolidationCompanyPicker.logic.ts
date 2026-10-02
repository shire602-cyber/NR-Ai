// Pure choices of the consolidation picker (Phase 8 D4): which companies are picked, and whether they can be combined.
import type { ReportViewState } from "@/lib/report-query";

export const MAX_CONSOLIDATED_COMPANIES = 25;

export interface PickableCompany {
  id: string;
  name: string;
  baseCurrency?: string | null;
}

/** The ids chosen in the viewer state; the current company when none were chosen yet. */
export function selectedCompanyIds(
  state: ReportViewState,
  currentCompanyId: string | undefined
): string[] {
  const raw = state.filters.companyIds;
  const ids = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return ids.length > 0 ? ids : currentCompanyId ? [currentCompanyId] : [];
}

/** Companies chosen with more than one base currency: the server refuses these (no currency translation). */
export function hasMixedCurrencies(companies: PickableCompany[], selected: string[]): boolean {
  const currencies = new Set(
    companies.filter((c) => selected.includes(c.id)).map((c) => c.baseCurrency || "AED")
  );
  return currencies.size > 1;
}

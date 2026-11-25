// Pure view helpers for the cost centers screen (search, display name, period label).

export interface CostCenterLike {
  code: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
}

/** Arabic name in Arabic mode when present, otherwise the English name. */
export function costCenterDisplayName(
  cc: Pick<CostCenterLike, "name" | "nameAr">,
  locale: string
): string {
  return locale === "ar" && cc.nameAr?.trim() ? cc.nameAr : cc.name;
}

/** Matches code, English name, Arabic name and description; blank query keeps everything. */
export function filterCostCenters<T extends CostCenterLike>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.nameAr?.toLowerCase().includes(q) ?? false) ||
      (r.description?.toLowerCase().includes(q) ?? false)
  );
}

/** Localised "<start> to <end>" label; open ends use the supplied words. */
export function costCenterPeriodLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  copy: { beginning: string; today: string; range: string; allPeriods: string }
): string {
  if (!start && !end) return copy.allPeriods;
  return copy.range.replace("{start}", start ?? copy.beginning).replace("{end}", end ?? copy.today);
}

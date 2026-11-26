// Pure view helpers for the cost centers screen (load state, search, display name, period label).

/**
 * What a screen section should say about one query. Whether there are rows to show is a separate
 * question (`data !== undefined`): `paused`, `pausedRetry`, `retrying` and `refreshError` apply
 * with or without cached data, `pending` and `error` only without it.
 */
export type LoadState =
  | "ready"
  | "pending"
  | "paused"
  | "retrying"
  | "pausedRetry"
  | "error"
  | "refreshError";

export interface LoadSnapshot {
  data: unknown;
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  failureCount: number;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export function costCenterLoadState(query: LoadSnapshot): LoadState {
  const hasData = query.data !== undefined && query.data !== null;
  // A new fetch resets failureCount (and, without data, the error status), so a user or scheduled
  // retry is recognised by the last settled outcome having been a failure.
  const isRetry =
    query.failureCount > 0 ||
    query.status === "error" ||
    query.errorUpdatedAt > query.dataUpdatedAt;

  if (query.fetchStatus === "paused") return isRetry ? "pausedRetry" : "paused";
  if (query.fetchStatus === "fetching") {
    if (isRetry) return "retrying";
    return hasData ? "ready" : "pending";
  }
  if (query.status === "error") return hasData ? "refreshError" : "error";
  if (hasData) return "ready";
  return query.status === "pending" ? "pending" : "error";
}

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

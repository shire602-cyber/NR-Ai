/**
 * Copy / new-version of a budget plan clears a cost-centre reference that no longer exists
 * (the source plan is left as it is). The new draft's actuals then use a different scope (the
 * plan's cost centre, or all cost centres), so the screen must say which plan and lines changed
 * instead of reporting plain success.
 */

export type BudgetScopeAction = "copy" | "newVersion";

export interface BudgetScopeLine {
  category: string;
  description: string | null;
  costCenterId: string;
  /** What the line's actuals filter by in the new draft; absent if the server did not say. */
  fallback?: "plan" | "all";
}

export interface BudgetScopeChange {
  action: BudgetScopeAction;
  /** Id and name of the draft the action created. */
  planId: string;
  planName: string;
  planCostCenterCleared: boolean;
  lines: BudgetScopeLine[];
}

interface CopyOrVersionResult {
  id?: unknown;
  name?: unknown;
  clearedPlanCostCenterIds?: unknown;
  clearedLineCostCenterIds?: unknown;
  clearedLines?: unknown;
}

/** The changed scope of a copy / new-version response, or null when nothing was cleared. */
export function budgetScopeChange(
  action: BudgetScopeAction,
  result: unknown
): BudgetScopeChange | null {
  const r = (result ?? {}) as CopyOrVersionResult;
  const planCleared =
    Array.isArray(r.clearedPlanCostCenterIds) && r.clearedPlanCostCenterIds.length > 0;
  const lines: BudgetScopeLine[] = Array.isArray(r.clearedLines)
    ? (r.clearedLines as Array<Partial<BudgetScopeLine>>).map((l) => ({
        category: String(l.category ?? ""),
        description: l.description ?? null,
        costCenterId: String(l.costCenterId ?? ""),
        ...(l.fallback === "plan" || l.fallback === "all" ? { fallback: l.fallback } : {}),
      }))
    : [];
  // Older servers send only the ids: still surface the change, with a count and no names.
  const idOnly =
    Array.isArray(r.clearedLineCostCenterIds) &&
    r.clearedLineCostCenterIds.length > 0 &&
    !lines.length;
  if (!planCleared && !lines.length && !idOnly) return null;
  return {
    action,
    planId: String(r.id ?? ""),
    planName: String(r.name ?? ""),
    planCostCenterCleared: planCleared,
    lines:
      lines.length || !idOnly
        ? lines
        : (r.clearedLineCostCenterIds as string[]).map((id) => ({
            category: "",
            description: null,
            costCenterId: id,
          })),
  };
}

/** Pure state helpers for the Corporate Tax screen (empty / error / draft handling). */

import type { FetchStatus, QueryStatus } from "@tanstack/react-query";

export type ReturnsListState = "loading" | "paused" | "error" | "empty" | "ready" | "idle";

interface QuerySnapshot {
  status: QueryStatus;
  data: readonly unknown[] | undefined;
}

/**
 * "initial": the load failed and there is nothing to show. "refresh": a later fetch failed but
 * the last successful response (an empty array included) is still cached.
 */
export function loadFailure(q: QuerySnapshot): "initial" | "refresh" | null {
  if (q.status !== "error") return null;
  return q.data === undefined ? "initial" : "refresh";
}

export function returnsListState(
  q: QuerySnapshot & { fetchStatus: FetchStatus }
): ReturnsListState {
  if (q.data?.length) return "ready";
  if (q.fetchStatus === "paused") return "paused";
  // A failed refresh of an empty list is not a confirmed empty list: only the warning shows.
  if (q.status === "error") return loadFailure(q) === "initial" ? "error" : "idle";
  if (q.status === "success" && q.data?.length === 0) return "empty";
  return q.fetchStatus === "fetching" ? "loading" : "idle";
}

/**
 * A calculation that processed no journal entries (and no manual workpaper figures were
 * entered) is an empty period, not a genuine nil return.
 */
export function isEmptyCalculation(
  calculation: { journalEntriesProcessed: number } | null,
  hasManualWorkpaper: boolean
): boolean {
  return !!calculation && calculation.journalEntriesProcessed === 0 && !hasManualWorkpaper;
}

interface Totals {
  totalRevenue: number;
  totalExpenses: number;
}

/**
 * The POST body for "Save as Draft", or null when there is nothing that may be saved. Ledger
 * figures come only from `calculation` (which the caller ties to the selected period); typed
 * workpaper rows (`manual`) can be saved without a calculation.
 */
export function buildDraftBody<R extends { amount: number; notes?: string }>(input: {
  periodStart: string;
  periodEnd: string;
  calculation: Totals | null;
  manual: Totals | null;
  deductions: number;
  rows: readonly R[];
  notes: string;
}) {
  const figures = input.manual ?? input.calculation;
  if (!figures || !input.periodStart || !input.periodEnd) return null;
  // R08-09: the server computes taxable income, rate and liability.
  return {
    taxPeriodStart: input.periodStart,
    taxPeriodEnd: input.periodEnd,
    totalRevenue: figures.totalRevenue,
    totalExpenses: figures.totalExpenses,
    totalDeductions: input.deductions,
    workpaper: {
      source: input.manual ? ("manual_workpaper" as const) : ("journal_calculation" as const),
      rows: input.rows.filter((row) => row.amount > 0 || row.notes?.trim()),
    },
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

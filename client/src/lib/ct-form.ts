// Corporate tax form logic (Phase 9): the add-back / deduction rows, the Small Business Relief election and the
// computation the screen shows. Pure, so it is unit tested; the arithmetic is the server's own (shared/ct-workpaper.ts),
// the server recomputes and stores the result when a draft is saved.

import {
  CT_ADJUSTMENT_CATEGORIES,
  CT_ENTERTAINMENT_DISALLOWED_SHARE,
  CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  CT_ZERO_RATE_BAND,
  computeCtComputation,
  ctSmallBusinessReliefAvailability,
  normalizeCtAdjustments,
  type CtAdjustmentCategory,
  type CtAdjustmentDirection,
  type CtBridgeAdjustment,
  type CtComputationResult,
  type CtSbrUnavailableReason,
} from "@shared/ct-workpaper";

export {
  CT_ENTERTAINMENT_DISALLOWED_SHARE,
  CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  CT_ZERO_RATE_BAND,
};
export type {
  CtAdjustmentCategory,
  CtAdjustmentDirection,
  CtBridgeAdjustment,
  CtComputationResult,
  CtSbrUnavailableReason,
};

/** Categories that need a written reason (the server refuses them without one). */
const NEEDS_REASON: ReadonlySet<CtAdjustmentCategory> = new Set<CtAdjustmentCategory>([
  "other_addback",
  "other_deduction",
  "related_party_excess",
  "unrealized_gains",
]);
export const MIN_REASON_LENGTH = 5;
export const MAX_ADJUSTMENTS = 200;

export const CT_CATEGORIES = Object.keys(CT_ADJUSTMENT_CATEGORIES) as CtAdjustmentCategory[];
export const categoryDirection = (c: CtAdjustmentCategory): CtAdjustmentDirection =>
  CT_ADJUSTMENT_CATEGORIES[c].direction;
export const categoryLabel = (c: CtAdjustmentCategory, locale: string): string =>
  locale === "ar" ? CT_ADJUSTMENT_CATEGORIES[c].labelAr : CT_ADJUSTMENT_CATEGORIES[c].label;
export const categoryNeedsReason = (c: CtAdjustmentCategory): boolean => NEEDS_REASON.has(c);

/** A row as the form holds it: text inputs, not numbers, so a half-typed amount is not lost. */
export interface AdjustmentRow {
  id: string;
  category: CtAdjustmentCategory;
  /** Amount in AED; for entertainment the expense in the books (50% is the add-back). */
  amountText: string;
  notes: string;
}

let rowSeq = 0;
export const newRowId = (): string => `adj-${Date.now().toString(36)}-${(rowSeq++).toString(36)}`;

export function emptyRow(category: CtAdjustmentCategory = "other_addback"): AdjustmentRow {
  return { id: newRowId(), category, amountText: "", notes: "" };
}

const toAmount = (text: string): number => {
  const n = Number(text.replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export type RowProblem = "amount" | "reason";

/** What is wrong with a row, if anything (an empty row is left out, not an error). */
export function rowProblem(row: AdjustmentRow): RowProblem | null {
  if (isBlankRow(row)) return null;
  const amount = toAmount(row.amountText);
  if (!Number.isFinite(amount) || amount < 0 || row.amountText.trim() === "") return "amount";
  if (categoryNeedsReason(row.category) && row.notes.trim().length < MIN_REASON_LENGTH)
    return "reason";
  return null;
}

export const isBlankRow = (row: AdjustmentRow): boolean =>
  row.amountText.trim() === "" && row.notes.trim() === "";

/** The add-back an entertainment row produces (50% of the expense), or the plain amount for every other category. */
export function rowAmount(row: AdjustmentRow): number {
  const base = toAmount(row.amountText);
  if (!Number.isFinite(base)) return 0;
  return row.category === "entertainment_50"
    ? Math.round(base * CT_ENTERTAINMENT_DISALLOWED_SHARE * 100) / 100
    : base;
}

/** Rows to the adjustments the server takes. Entertainment sends baseAmount (the server derives 50%); blank rows are dropped. */
export function rowsToAdjustments(rows: AdjustmentRow[]): CtBridgeAdjustment[] {
  return rows
    .filter((r) => !isBlankRow(r) && rowProblem(r) === null)
    .map((r) => {
      const value = toAmount(r.amountText);
      const notes = r.notes.trim();
      return {
        id: r.id,
        category: r.category,
        amount:
          r.category === "entertainment_50"
            ? Math.round(value * CT_ENTERTAINMENT_DISALLOWED_SHARE * 100) / 100
            : value,
        ...(r.category === "entertainment_50" ? { baseAmount: value } : {}),
        direction: categoryDirection(r.category),
        ...(notes ? { notes } : {}),
      };
    });
}

/** Saved adjustments back to form rows (entertainment shows the expense, not its 50%). */
export function adjustmentsToRows(
  adjustments: CtBridgeAdjustment[] | null | undefined
): AdjustmentRow[] {
  return (adjustments ?? []).map((a) => ({
    id: a.id,
    category: a.category,
    amountText: String(
      a.category === "entertainment_50" && a.baseAmount !== undefined ? a.baseAmount : a.amount
    ),
    notes: a.notes ?? "",
  }));
}

export interface Suggestion {
  category: CtAdjustmentCategory;
  baseAmount: number;
  amount: number;
  documents: number;
  note: string;
}

/** A suggestion becomes a row only when the same category is not already there (it never adds twice). */
export function suggestionAlreadyAdded(rows: AdjustmentRow[], s: Suggestion): boolean {
  return rows.some((r) => r.category === s.category && !isBlankRow(r));
}

export function suggestionToRow(s: Suggestion): AdjustmentRow {
  return {
    id: newRowId(),
    category: s.category,
    amountText: String(s.category === "entertainment_50" ? s.baseAmount : s.amount),
    notes: "",
  };
}

/** Does the add-back list pass the server's own validation? (Used to enable Save.) */
export function adjustmentsAreValid(rows: AdjustmentRow[]): boolean {
  if (rows.some((r) => rowProblem(r) !== null)) return false;
  return normalizeCtAdjustments(rowsToAdjustments(rows)).ok;
}

export interface ReliefOffer {
  available: boolean;
  reason?: CtSbrUnavailableReason;
}

/** The pre-save offer (a prior-period breach is only known to the server, which re-checks it when the draft is computed). */
export function localReliefOffer(
  totalRevenue: number,
  taxPeriodEnd: string | null | undefined
): ReliefOffer {
  return ctSmallBusinessReliefAvailability({ totalRevenue, taxPeriodEnd: taxPeriodEnd ?? null });
}

export interface LocalComputationInput {
  totalRevenue: number;
  totalExpenses: number;
  rows: AdjustmentRow[];
  elected: boolean;
  taxPeriodEnd: string | null | undefined;
  lossBroughtForward?: number;
  priorPeriodsExceededRevenueCap?: boolean;
}

export function localComputation(input: LocalComputationInput): CtComputationResult {
  return computeCtComputation({
    totalRevenue: input.totalRevenue,
    totalExpenses: input.totalExpenses,
    adjustments: rowsToAdjustments(input.rows),
    lossBroughtForward: input.lossBroughtForward ?? 0,
    smallBusinessReliefElected: input.elected,
    priorPeriodsExceededRevenueCap: input.priorPeriodsExceededRevenueCap ?? false,
    taxPeriodEnd: input.taxPeriodEnd ?? null,
  });
}

export type ReliefOutcome =
  | { kind: "not_elected" }
  | { kind: "applied" }
  | { kind: "refused"; reason: CtSbrUnavailableReason };

/** "Elected and applied" / "Elected, refused: reason" / "Not elected", from a computation. */
export function reliefOutcome(
  c: Pick<CtComputationResult, "smallBusinessRelief"> | null | undefined
): ReliefOutcome {
  const r = c?.smallBusinessRelief;
  if (!r || !r.elected) return { kind: "not_elected" };
  if (r.applied) return { kind: "applied" };
  return { kind: "refused", reason: r.ineligibleReason ?? "revenue_cap" };
}

/** Bridge line keys that have a fixed meaning; "adj_<category>_<id>" lines take the category label. */
export function bridgeAdjustmentCategory(key: string): CtAdjustmentCategory | null {
  if (!key.startsWith("adj_")) return null;
  for (const c of CT_CATEGORIES) if (key.startsWith(`adj_${c}_`)) return c;
  return null;
}

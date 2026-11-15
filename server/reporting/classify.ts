/**
 * Account classification for statements. Driven by account sub_type first,
 * then by the default UAE chart codes, so custom charts that set sub_type get
 * the right sections without code conventions.
 */
import type { ReportAccount } from "./ledger-query";

export type PlSection =
  | "revenue"
  | "cost_of_sales"
  | "operating_expenses"
  | "other_income"
  | "other_expenses";

/** Other income in the default chart: 4030 other income, 4040 interest, 4080 disposal gain, 4090 FX gain. */
export const OTHER_INCOME_CODES = new Set(["4030", "4040", "4080", "4090"]);
/** Other expenses in the default chart: 5130 disposal loss, 5140 FX loss. */
export const OTHER_EXPENSE_CODES = new Set(["5130", "5140"]);

const COST_OF_SALES_SUBTYPES = new Set([
  "cost_of_sales",
  "cogs",
  "direct_cost",
  "cost_of_goods_sold",
]);
const OTHER_INCOME_SUBTYPES = new Set(["other_income", "non_operating_income", "fx_gain"]);
const OTHER_EXPENSE_SUBTYPES = new Set(["other_expense", "non_operating_expense", "fx_loss"]);

export function plSection(
  a: Pick<ReportAccount, "type" | "subType" | "code" | "nameEn">
): PlSection | null {
  const sub = (a.subType ?? "").toLowerCase();
  if (a.type === "income") {
    if (OTHER_INCOME_SUBTYPES.has(sub) || OTHER_INCOME_CODES.has(a.code)) return "other_income";
    return "revenue";
  }
  if (a.type === "expense") {
    if (COST_OF_SALES_SUBTYPES.has(sub) || /cost of (goods|sales|revenue)/i.test(a.nameEn))
      return "cost_of_sales";
    if (OTHER_EXPENSE_SUBTYPES.has(sub) || OTHER_EXPENSE_CODES.has(a.code)) return "other_expenses";
    return "operating_expenses";
  }
  return null;
}

/** Current vs non-current for balance-sheet accounts. */
export function isNonCurrent(a: Pick<ReportAccount, "type" | "subType" | "code">): boolean {
  const sub = (a.subType ?? "").toLowerCase();
  if (a.type === "asset") {
    if (sub === "fixed_asset" || sub.startsWith("non_current")) return true;
    if (sub === "current_asset" || sub === "cash" || sub === "bank") return false;
    return a.code.startsWith("12") || a.code.startsWith("13") || a.code.startsWith("14");
  }
  if (a.type === "liability") {
    if (sub === "long_term_liability" || sub.startsWith("non_current")) return true;
    if (sub === "current_liability") return false;
    return a.code.startsWith("22") || a.code.startsWith("23");
  }
  return false;
}

/** Retained-earnings account(s): 3020 in the default chart, or an equity account named "retained". */
export function isRetainedEarningsAccount(
  a: Pick<ReportAccount, "type" | "code" | "nameEn">
): boolean {
  if (a.type !== "equity") return false;
  return a.code === "3020" || /retained/i.test(a.nameEn);
}

/** Cash / bank / petty cash (mirrors services/financial-statements isCashOrBankAccount). */
export function isCashAccount(
  a: Pick<ReportAccount, "type" | "subType" | "code" | "nameEn">
): boolean {
  if (a.type !== "asset") return false;
  if (a.subType === "cash" || a.subType === "bank") return true;
  if (a.code >= "1010" && a.code <= "1039") return true;
  const name = a.nameEn.toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

/** Contra-asset codes that normally carry a credit balance (accumulated depreciation). */
export const CONTRA_ASSET_CODES = new Set(["1240"]);

export function isContraAsset(a: Pick<ReportAccount, "type" | "code" | "nameEn">): boolean {
  return (
    a.type === "asset" &&
    (CONTRA_ASSET_CODES.has(a.code) || /accumulated (depreciation|amortis|amortiz)/i.test(a.nameEn))
  );
}

export type CashFlowActivity = "operating" | "investing" | "financing";

/** Activity for the indirect method's balance-change adjustments. */
export function indirectActivity(a: ReportAccount): CashFlowActivity {
  if (a.type === "equity") return "financing";
  if (a.type === "liability") return isNonCurrent(a) ? "financing" : "operating";
  if (a.type === "asset") {
    if (isContraAsset(a)) return "operating"; // depreciation add-back
    return isNonCurrent(a) ? "investing" : "operating";
  }
  return "operating";
}

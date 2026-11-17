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
  | "other_expenses"
  | "income_tax";

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
/**
 * Income-tax expense (A3, H3): 5200 Corporate Tax Expense in the default chart, or a custom
 * account with an income-tax sub_type. Presented after profit before tax (IAS 1.82(d), IAS 12.77),
 * never inside operating expenses.
 */
export const INCOME_TAX_CODES = new Set(["5200", "5210"]);
const INCOME_TAX_SUBTYPES = new Set([
  "income_tax",
  "corporate_tax",
  "tax_expense",
  "current_tax",
  "deferred_tax",
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
    if (isIncomeTaxAccount(a)) return "income_tax";
    if (COST_OF_SALES_SUBTYPES.has(sub) || /cost of (goods|sales|revenue)/i.test(a.nameEn))
      return "cost_of_sales";
    if (OTHER_EXPENSE_SUBTYPES.has(sub) || OTHER_EXPENSE_CODES.has(a.code)) return "other_expenses";
    return "operating_expenses";
  }
  return null;
}

/** Income-tax (corporate tax) expense account: presented below profit before tax. */
export function isIncomeTaxAccount(a: Pick<ReportAccount, "type" | "subType" | "code">): boolean {
  if (a.type !== "expense") return false;
  const sub = (a.subType ?? "").toLowerCase();
  return INCOME_TAX_SUBTYPES.has(sub) || INCOME_TAX_CODES.has(a.code);
}

/**
 * Revaluation / OCI reserve (A3, H11): 3050 Revaluation Surplus in the default chart, an equity
 * account with a reserve sub_type, or one named "revaluation". Its movements (other than
 * transfers to retained earnings) are other comprehensive income (IAS 1.81A, IAS 16.39) and it
 * is a separate component of equity, never share capital (IAS 1.106(d)).
 */
export const REVALUATION_RESERVE_CODES = new Set(["3050"]);
const RESERVE_SUBTYPES = new Set([
  "revaluation_reserve",
  "revaluation_surplus",
  "oci_reserve",
  "other_comprehensive_income",
]);

export function isRevaluationReserveAccount(
  a: Pick<ReportAccount, "type" | "subType" | "code" | "nameEn">
): boolean {
  if (a.type !== "equity") return false;
  const sub = (a.subType ?? "").toLowerCase();
  return (
    RESERVE_SUBTYPES.has(sub) ||
    REVALUATION_RESERVE_CODES.has(a.code) ||
    /revaluation/i.test(a.nameEn)
  );
}

/** End-of-service gratuity provision (A3, H10): 2036 in the default chart. */
export function isGratuityProvisionAccount(
  a: Pick<ReportAccount, "type" | "code" | "nameEn">
): boolean {
  return (
    a.type === "liability" && (a.code === "2036" || /gratuity|end[- ]of[- ]service/i.test(a.nameEn))
  );
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

/**
 * Contra-asset codes that normally carry a credit balance: accumulated depreciation (1240) and
 * the allowance for doubtful debts (1045, A3: IFRS 9 simplified-approach loss allowance).
 */
export const CONTRA_ASSET_CODES = new Set(["1240", "1045"]);

export function isContraAsset(a: Pick<ReportAccount, "type" | "code" | "nameEn">): boolean {
  return (
    a.type === "asset" &&
    (CONTRA_ASSET_CODES.has(a.code) ||
      /accumulated (depreciation|amortis|amortiz|impairment)/i.test(a.nameEn) ||
      /allowance for (doubtful|bad|expected credit)/i.test(a.nameEn))
  );
}

export type CashFlowActivity = "operating" | "investing" | "financing";

/**
 * Non-current balances whose movement is a non-cash part of operating profit, not an investing
 * or financing flow: deferred tax assets / liabilities (1270 / 2260, the deferred part of income
 * tax: IAS 12.58, taxes are operating unless specifically identified, IAS 7.35) and the
 * end-of-service gratuity provision (2036, an employee benefit accrued through payroll cost,
 * non-current since A3 H10).
 */
export const OPERATING_NON_CURRENT_CODES = new Set(["1270", "2260", "2036"]);

export function isOperatingNonCurrent(
  a: Pick<ReportAccount, "type" | "subType" | "code" | "nameEn">
): boolean {
  if (a.type !== "asset" && a.type !== "liability") return false;
  return (
    OPERATING_NON_CURRENT_CODES.has(a.code) ||
    (a.subType ?? "").toLowerCase() === "deferred_tax" ||
    /deferred tax (asset|liabilit)/i.test(a.nameEn) ||
    /end[- ]of[- ]service|gratuity/i.test(a.nameEn)
  );
}

/** Activity for the indirect method's balance-change adjustments. */
export function indirectActivity(a: ReportAccount): CashFlowActivity {
  if (isOperatingNonCurrent(a)) return "operating";
  if (a.type === "equity") return "financing";
  if (a.type === "liability") return isNonCurrent(a) ? "financing" : "operating";
  if (a.type === "asset") return isNonCurrent(a) ? "investing" : "operating";
  return "operating";
}

/**
 * AS1: the corporate-tax ledger preview, shared by GET /corporate-tax/calculate and the
 * Assistant's CT estimate fact, so both always give the same figure. Posted entries only,
 * closing entries excluded (reporting kernel P&L); corporate tax expense itself is not
 * deductible (Art. 33(9)); add-backs and exempt income come from the tagged accounts. Always an
 * estimate: nothing here is a return and nothing is transmitted to EmaraTax.
 */
import {
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  CT_STANDARD_RATE,
  CT_ZERO_RATE_BAND,
  computeCtComputation,
  sbrAvailableForPeriodEnd,
  type CtBridgeAdjustment,
  type CtComputationResult,
} from "../../../shared/ct-workpaper";
import { profitAndLoss } from "../../reporting";
import { ledgerAdjustmentsFromBooks } from "./engine";
import { readCtBooks } from "./repository";

export interface CtLedgerPreview {
  totalRevenue: number;
  totalExpenses: number;
  ledgerAdjustments: CtBridgeAdjustment[];
  liability: CtComputationResult;
  /** Small Business Relief is still available for a period ending on `to` (MD 73/2023). */
  withinSunset: boolean;
  sbrEligible: boolean;
}

export async function ctLedgerPreview(
  companyId: string,
  from: string,
  to: string
): Promise<CtLedgerPreview> {
  const [pl, books] = await Promise.all([
    profitAndLoss({ companyId, from, to }),
    readCtBooks(companyId, from, to),
  ]);
  const totalRevenue = Math.max(0, pl.totalIncome);
  const totalExpenses = Math.max(
    0,
    Math.round((pl.totalExpenses - books.tags.corporateTaxExpenseExcluded) * 100) / 100
  );
  // C2 (NL4): the same bridge as the return: add-backs and exempt income from the tagged
  // accounts (entertainment 50%, fines, donations, exempt dividends: Arts. 22, 23, 28, 33)
  // and the net interest of the interest-tagged accounts (Art. 30).
  const ledgerAdjustments = ledgerAdjustmentsFromBooks(books);
  const netInterest =
    Math.round((books.tags.interestExpense - books.tags.interestIncome) * 100) / 100;
  const liability = computeCtComputation({
    totalRevenue,
    totalExpenses,
    totalDeductions: 0,
    adjustments: ledgerAdjustments,
    interest:
      netInterest !== 0 ? { netInterestExpense: netInterest, depreciationAmortisation: 0 } : null,
    taxPeriodEnd: to,
    exemptionThreshold: CT_ZERO_RATE_BAND,
    taxRate: CT_STANDARD_RATE,
  });
  const withinSunset = sbrAvailableForPeriodEnd(to);
  return {
    totalRevenue,
    totalExpenses,
    ledgerAdjustments,
    liability,
    withinSunset,
    sbrEligible: totalRevenue <= CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP && withinSunset,
  };
}

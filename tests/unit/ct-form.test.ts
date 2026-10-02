import { describe, expect, it } from "vitest";
import {
  CT_CATEGORIES,
  CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  CT_ZERO_RATE_BAND,
  adjustmentsAreValid,
  adjustmentsToRows,
  bridgeAdjustmentCategory,
  categoryDirection,
  localComputation,
  localReliefOffer,
  reliefOutcome,
  rowAmount,
  rowProblem,
  rowsToAdjustments,
  suggestionAlreadyAdded,
  suggestionToRow,
  type AdjustmentRow,
} from "../../client/src/lib/ct-form";
import { messages } from "../../client/src/components/compliance/CtAdjustments.i18n";

const row = (category: AdjustmentRow["category"], amountText: string, notes = "", id = category): AdjustmentRow => ({ id, category, amountText, notes });

describe("the corporate tax thresholds the screen explains", () => {
  it("keeps 375,000 as the 0% band and 3,000,000 as the Small Business Relief revenue limit", () => {
    expect(CT_ZERO_RATE_BAND).toBe(375_000);
    expect(CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP).toBe(3_000_000);
    expect(CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END).toBe("2026-12-31");
  });

  it("has Arabic text for every category and for the labels that quote the figures", () => {
    for (const c of CT_CATEGORIES) expect(categoryDirection(c)).toMatch(/^(add|deduct)$/);
    expect(messages.tables.ar.reliefHint).toContain("3,000,000");
    expect(messages.tables.ar.reliefHint).toContain("375,000");
    expect(messages.tables.en.reliefHint).toContain("0% band on the first AED 375,000");
  });
});

describe("add-back and deduction rows", () => {
  it("entertainment adds back 50% of the expense and sends the expense as baseAmount", () => {
    const [adj] = rowsToAdjustments([row("entertainment_50", "20000")]);
    expect(adj).toMatchObject({ category: "entertainment_50", baseAmount: 20000, amount: 10000, direction: "add" });
    expect(rowAmount(row("entertainment_50", "21000"))).toBe(10500);
  });

  it("fines, donations, depreciation and other add; capital allowance and other deduct", () => {
    for (const c of ["fines_penalties", "non_approved_donations", "depreciation_addback", "other_addback"] as const) expect(categoryDirection(c)).toBe("add");
    for (const c of ["capital_allowance", "exempt_income", "other_deduction"] as const) expect(categoryDirection(c)).toBe("deduct");
  });

  it("'other' lines and related-party lines need a reason of five characters", () => {
    expect(rowProblem(row("other_addback", "100", ""))).toBe("reason");
    expect(rowProblem(row("other_addback", "100", "abcd"))).toBe("reason");
    expect(rowProblem(row("other_addback", "100", "abcde"))).toBeNull();
    expect(rowProblem(row("other_deduction", "100", ""))).toBe("reason");
    expect(rowProblem(row("fines_penalties", "100", ""))).toBeNull();
  });

  it("a bad amount is a problem; a blank line is neither a problem nor sent", () => {
    expect(rowProblem(row("fines_penalties", "-5"))).toBe("amount");
    expect(rowProblem(row("fines_penalties", "abc", "x"))).toBe("amount");
    expect(rowProblem(row("fines_penalties", "", ""))).toBeNull();
    expect(rowsToAdjustments([row("fines_penalties", "", ""), row("fines_penalties", "50", "", "b")])).toHaveLength(1);
    expect(adjustmentsAreValid([row("other_addback", "100", "")])).toBe(false);
    expect(adjustmentsAreValid([row("other_addback", "100", "owner's car"), row("fines_penalties", "10", "", "b")])).toBe(true);
  });

  it("saved adjustments come back as the expense for entertainment", () => {
    const rows = adjustmentsToRows([{ id: "a", category: "entertainment_50", amount: 500, baseAmount: 1000, direction: "add" }]);
    expect(rows[0].amountText).toBe("1000");
  });

  it("a suggestion is added once and uses the expense base for entertainment", () => {
    const s = { category: "entertainment_50" as const, baseAmount: 21000, amount: 10500, documents: 2, note: "" };
    const r = suggestionToRow(s);
    expect(r.amountText).toBe("21000");
    expect(suggestionAlreadyAdded([], s)).toBe(false);
    expect(suggestionAlreadyAdded([r], s)).toBe(true);
  });
});

describe("Small Business Relief election", () => {
  it("is offered only up to 3,000,000 revenue and for periods ending by 31 Dec 2026", () => {
    expect(localReliefOffer(110_000, "2026-12-31")).toEqual({ available: true });
    expect(localReliefOffer(3_000_000, "2026-12-31").available).toBe(true);
    expect(localReliefOffer(3_200_000, "2026-12-31")).toEqual({ available: false, reason: "revenue_cap" });
    expect(localReliefOffer(110_000, "2027-12-31")).toEqual({ available: false, reason: "period_after_sunset" });
  });

  it("elected and eligible: tax is nil; the outcome reads 'applied'", () => {
    const c = localComputation({ totalRevenue: 110_000, totalExpenses: 60_000, rows: [], elected: true, taxPeriodEnd: "2026-12-31" });
    expect(c.taxPayable).toBe(0);
    expect(c.taxableIncome).toBe(0);
    expect(reliefOutcome(c)).toEqual({ kind: "applied" });
  });

  it("elected over the limit is refused with the reason and tax is worked out normally", () => {
    const c = localComputation({ totalRevenue: 3_200_000, totalExpenses: 2_000_000, rows: [], elected: true, taxPeriodEnd: "2026-12-31" });
    expect(reliefOutcome(c)).toEqual({ kind: "refused", reason: "revenue_cap" });
    expect(c.taxPayable).toBe(Math.round((1_200_000 - 375_000) * 0.09 * 100) / 100);
  });

  it("elected for a period after the sunset is refused for that reason", () => {
    const c = localComputation({ totalRevenue: 100_000, totalExpenses: 10_000, rows: [], elected: true, taxPeriodEnd: "2027-12-31" });
    expect(reliefOutcome(c)).toEqual({ kind: "refused", reason: "period_after_sunset" });
  });

  it("not elected reads 'not elected'", () => {
    const c = localComputation({ totalRevenue: 100_000, totalExpenses: 10_000, rows: [], elected: false, taxPeriodEnd: "2026-12-31" });
    expect(reliefOutcome(c)).toEqual({ kind: "not_elected" });
    expect(reliefOutcome(null)).toEqual({ kind: "not_elected" });
  });
});

describe("the computation with add-backs", () => {
  it("Falcon: 3.2m revenue, entertainment add-back of 10,000 raises tax by 900", () => {
    const base = { totalRevenue: 3_200_000, totalExpenses: 2_000_000, elected: false, taxPeriodEnd: "2026-12-31" };
    const without = localComputation({ ...base, rows: [] });
    const withAdd = localComputation({ ...base, rows: [row("entertainment_50", "20000")] });
    expect(Math.round((withAdd.taxPayable - without.taxPayable) * 100) / 100).toBe(900);
    expect(withAdd.totalAddBacks).toBe(10000);
  });

  it("a deduction lowers taxable income and the bridge names the adjustment lines", () => {
    const c = localComputation({ totalRevenue: 1_000_000, totalExpenses: 400_000, rows: [row("capital_allowance", "50000")], elected: false, taxPeriodEnd: "2026-12-31" });
    expect(c.taxableIncome).toBe(550_000);
    const line = c.bridge.find((l) => l.key.startsWith("adj_capital_allowance_"));
    expect(line?.amount).toBe(-50000);
    expect(bridgeAdjustmentCategory(line!.key)).toBe("capital_allowance");
    expect(bridgeAdjustmentCategory("accounting_profit")).toBeNull();
  });
});

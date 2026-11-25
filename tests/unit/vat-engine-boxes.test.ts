import { describe, expect, it } from "vitest";
import {
  addDelta,
  boxesToAed,
  deriveTotals,
  emptyBoxes,
  normaliseEmirate,
  purchaseDelta,
  purchaseKindFor,
  recoverableShare,
  salesDelta,
  toBaseFils,
} from "../../server/tax/vat-boxes";
import { assertAlignedPeriod, periodContaining, vatDueDate } from "../../server/tax/vat-periods";
import { buildReconciliation, categoryForSource } from "../../server/tax/vat-reconciliation";
import { resolveRecovery } from "../../server/tax/vat-recovery";
import { diffReturns, vatReturnColumns } from "../../server/tax/vat-returns.service";

describe("[R07-03] VAT 201 box mapping truth table", () => {
  it("maps each sales family to exactly one box; out of scope to none", () => {
    expect(salesDelta("standard", "sharjah", 100_000, 5_000)).toEqual({
      box1cSharjahAmount: 100_000,
      box1cSharjahVat: 5_000,
    });
    expect(salesDelta("zero_rated", null, 50_000, 0)).toEqual({ box4ZeroRatedAmount: 50_000 });
    expect(salesDelta("exempt", null, 25_000, 0)).toEqual({ box5ExemptAmount: 25_000 });
    expect(salesDelta("out_of_scope", null, 10_000, 0)).toEqual({});
    expect(salesDelta("reverse_charge", "dubai", 10_000, 0)).toEqual({
      box1bDubaiAmount: 10_000,
      box1bDubaiVat: 0,
    });
  });

  it("[R07-02] refuses a standard supply without an emirate", () => {
    expect(() => salesDelta("standard", null, 1, 0)).toThrow(/emirate/);
    expect(normaliseEmirate("Ras Al Khaimah")).toBe("ras_al_khaimah");
    expect(normaliseEmirate("RAK")).toBe("ras_al_khaimah");
    expect(normaliseEmirate("atlantis")).toBeNull();
    expect(normaliseEmirate(null)).toBeNull();
  });

  it("maps purchases: standard -> Box 9, reverse charge -> Box 3 + 10, imports -> Box 6 + 10", () => {
    expect(purchaseDelta("standard", 40_000, 2_000, 2_000)).toEqual({
      box9ExpensesAmount: 40_000,
      box9ExpensesVat: 2_000,
    });
    expect(purchaseDelta("standard", 40_000, 2_000, 0)).toEqual({});
    expect(purchaseDelta("reverse_charge", 367_250, 18_363, 18_363)).toMatchObject({
      box3ReverseChargeVat: 18_363,
      box10ReverseChargeVat: 18_363,
    });
    expect(purchaseDelta("import", 100_000, 6_000, 3_000)).toMatchObject({
      box6ImportsVat: 6_000,
      box10ReverseChargeVat: 3_000,
    });
    expect(purchaseKindFor({ supplyType: "exempt", vatFils: 0 })).toBe("not_reportable");
    expect(
      purchaseKindFor({ supplyType: "standard_rated", vatFils: 0, designatedZone: true })
    ).toBe("not_reportable");
    expect(purchaseKindFor({ vatFils: 500, isImport: true })).toBe("import");
  });
});

describe("[R07-10] fils arithmetic: rounded boxes sum exactly", () => {
  it("USD 50 VAT @3.6725 is 183.63 on both legs and Box 14 is exactly 30.00", () => {
    const rc = toBaseFils(5_000, "3.6725");
    expect(rc).toBe(18_363);
    const b = emptyBoxes();
    addDelta(b, salesDelta("standard", "sharjah", 100_000, 5_000));
    addDelta(b, purchaseDelta("standard", 40_000, 2_000, 2_000));
    addDelta(b, purchaseDelta("reverse_charge", toBaseFils(100_000, "3.6725"), rc, rc));
    const d = deriveTotals(b);
    expect(d.box8TotalVat).toBe(23_363);
    expect(d.box11TotalVat).toBe(20_363);
    expect(d.box14PayableTax).toBe(3_000);
    const aed = boxesToAed(d);
    expect(aed.box14PayableTax).toBe(30);
    expect(aed.box3ReverseChargeAmount).toBe(3672.5);
    expect(vatReturnColumns(aed).box9NetTax).toBe(30);
  });

  it("refuses non-integer fils and derived boxes", () => {
    const b = emptyBoxes();
    expect(() => addDelta(b, { box9ExpensesVat: 1.5 })).toThrow();
    expect(() => addDelta(b, { box14PayableTax: 1 })).toThrow();
  });

  it("partial recovery rounds half-up like bill posting", () => {
    expect(recoverableShare(5_001, 50)).toBe(2_501);
    expect(recoverableShare(5_000, 0)).toBe(0);
    expect(recoverableShare(5_000, 100)).toBe(5_000);
  });
});

describe("[R07-07] period alignment", () => {
  it("accepts one stagger period and rejects anything else", () => {
    expect(
      assertAlignedPeriod({
        from: "2026-07-01",
        to: "2026-09-30",
        frequency: "quarterly",
        startMonth: 1,
      }).dueDate
    ).toBe("2026-10-28");
    expect(() =>
      assertAlignedPeriod({
        from: "2026-01-01",
        to: "2026-06-30",
        frequency: "quarterly",
        startMonth: 1,
      })
    ).toThrow(/2026-01-01 to 2026-03-31/);
    expect(() =>
      assertAlignedPeriod({
        from: "2026-07-01",
        to: "2026-09-30",
        frequency: "monthly",
        startMonth: 1,
      })
    ).toThrow();
    expect(periodContaining("2026-01-15", "quarterly", 3)).toEqual({
      from: "2025-12-01",
      to: "2026-02-28",
    });
    expect(periodContaining("2026-11-20", "quarterly", 12)).toEqual({
      from: "2026-09-01",
      to: "2026-11-30",
    });
    expect(vatDueDate("2026-02-28")).toBe("2026-03-28");
  });
});

describe("[R12-08b] reconciliation", () => {
  it("separates explained (return-only) from unexplained differences", () => {
    const b = emptyBoxes();
    const sale = salesDelta("standard", "dubai", 100_000, 5_000);
    const tourist = { box2TouristRefundAmount: -20_000, box2TouristRefundVat: -1_000 };
    addDelta(b, sale);
    addDelta(b, tourist);
    const r = buildReconciliation({
      boxes: deriveTotals(b),
      contributions: [
        { boxes: sale, category: "sales", inLedger: true },
        { boxes: tourist, category: "return_adjustments", inLedger: false },
      ],
      ledgerByCategory: new Map([["sales", { output: 5_000, input: 0 }]]),
      hasVatAccounts: true,
    });
    expect(r.outputDifferenceFils).toBe(-1_000);
    expect(r.explainedOutputFils).toBe(-1_000);
    expect(r.hasUnexplainedDifference).toBe(false);
    const onlySale = emptyBoxes();
    addDelta(onlySale, sale);
    const r2 = buildReconciliation({
      boxes: deriveTotals(onlySale),
      contributions: [{ boxes: sale, category: "sales", inLedger: true }],
      ledgerByCategory: new Map([["sales", { output: 4_000, input: 0 }]]),
      hasVatAccounts: true,
    });
    expect(r2.hasUnexplainedDifference).toBe(true);
    expect(categoryForSource("bill_reversal")).toBe("purchases");
    expect(categoryForSource("manual")).toBe("journal:manual");
  });
});

describe("[R05-28] input VAT recovery rules", () => {
  it("blocks entertainment by default, lets a company rule override", () => {
    expect(resolveRecovery({ category: "Entertainment" }, []).percent).toBe(0);
    expect(resolveRecovery({ accountName: "Staff car - personal use" }, []).percent).toBe(0);
    expect(resolveRecovery({ category: "Office" }, []).percent).toBe(100);
    expect(
      resolveRecovery({ category: "Entertainment" }, [
        {
          matchType: "category",
          matchValue: "entertainment",
          recoverablePercent: 100,
          label: "Staff",
        },
      ]).percent
    ).toBe(100);
    expect(
      resolveRecovery({ accountCode: "5300" }, [
        { matchType: "account_code", matchValue: "5300", recoverablePercent: 50, label: "Mixed" },
      ]).percent
    ).toBe(50);
  });
});

describe("[R07-15] amended return diff", () => {
  it("lists changed boxes only", () => {
    const next = boxesToAed(
      deriveTotals({ ...emptyBoxes(), box1cSharjahAmount: 140_000, box1cSharjahVat: 7_000 })
    );
    const diff = diffReturns(
      {
        box1cSharjahAmount: 1000,
        box1cSharjahVat: 50,
        box8TotalAmount: 1000,
        box8TotalVat: 50,
        box12TotalDueTax: 50,
        box14PayableTax: 50,
      },
      next
    );
    expect(diff.find((d) => d.box === "box1cSharjahVat")).toEqual({
      box: "box1cSharjahVat",
      previous: 50,
      amended: 70,
      difference: 20,
    });
    expect(diff.some((d) => d.box === "box4ZeroRatedAmount")).toBe(false);
  });
});

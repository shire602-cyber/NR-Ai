/**
 * A4 pure rules: ADPF pension (M11), payroll accrual date (L6), deposit VAT maths (M1) and the
 * deferred-tax schedule (M2). The posted journals are covered in tests/db/a4-payroll-ct.test.ts.
 */
import { describe, expect, it } from "vitest";
import { pensionContribution } from "../../server/services/payroll/calc";
import { DEFAULT_LEGAL_PARAMS, pensionRuleFor } from "../../server/services/payroll/legal-params";
import { payrollAccrualDate } from "../../server/services/payroll/runs";
import {
  depositVatShareFils,
  vatInsideFils,
} from "../../server/services/customer-deposits.service";
import { deferredTaxSchedule } from "../../server/services/corporate-tax/deferred-tax";

const wage = { basicFils: 2_000_000, housingFils: 500_000, transportFils: 0, otherFils: 0 };

describe("[A4][M11] Abu Dhabi Pension Fund", () => {
  it("ADPF members: employee 5%, employer 15% of basic + housing; GPSSA stays 5% / 12.5%", () => {
    const adpf = pensionContribution(wage, "AE", DEFAULT_LEGAL_PARAMS, "adpf");
    expect(adpf).toMatchObject({ fund: "adpf", employeeFils: 125_000, employerFils: 375_000 });
    expect(adpf.ruleConfirmed).toBe(false); // "confirm with adviser"
    const gpssa = pensionContribution(wage, "AE", DEFAULT_LEGAL_PARAMS);
    expect(gpssa).toMatchObject({ fund: "gpssa", employeeFils: 125_000, employerFils: 312_500 });
  });

  it("ADPF applies to UAE nationals only; GCC nationals pay through GPSSA", () => {
    expect(pensionRuleFor("SA", "adpf")).toMatchObject({ key: "SA", fund: "gpssa" });
    expect(pensionRuleFor("IN", "adpf")).toBeNull();
  });
});

describe("[A4][L6] payroll accrual date", () => {
  it("period end after the month, today inside it, refused before it starts", () => {
    expect(payrollAccrualDate("2026-10-01", "2026-10-31", "2026-11-17")).toBe("2026-10-31");
    expect(payrollAccrualDate("2026-11-01", "2026-11-30", "2026-11-17")).toBe("2026-11-17");
    expect(() => payrollAccrualDate("2026-12-01", "2026-12-31", "2026-11-17")).toThrow(
      /month starts/
    );
  });
});

describe("[A4][M1] deposit VAT maths", () => {
  it("VAT inside a VAT-inclusive amount is A x 5/105, half-up", () => {
    expect(vatInsideFils(105_000)).toBe(5_000);
    expect(vatInsideFils(1_000)).toBe(48); // 10.00 x 5/105 = 0.476 -> 0.48
    expect(vatInsideFils(1_000, "0")).toBe(0);
  });

  it("part applications are pro rata and the last takes the remainder", () => {
    const base = { depositGrossFils: 100_000, depositVatFils: 4_762 };
    const first = depositVatShareFils({
      ...base,
      remainingGrossFils: 100_000,
      vatAlreadyReversedFils: 0,
      amountFils: 33_333,
    });
    expect(first).toBe(1_587);
    const last = depositVatShareFils({
      ...base,
      remainingGrossFils: 66_667,
      vatAlreadyReversedFils: first,
      amountFils: 66_667,
    });
    expect(first + last).toBe(4_762);
  });
});

describe("[A4][M2] deferred-tax schedule (IAS 12)", () => {
  it("asset carrying > tax base is taxable (DTL); liability carrying > base and losses are deductible (DTA)", () => {
    const s = deferredTaxSchedule([
      { description: "PPE", kind: "asset", carryingAmount: 100_000, taxBase: 60_000 },
      { description: "Provision", kind: "liability", carryingAmount: 20_000, taxBase: 0 },
      { description: "Losses", kind: "tax_loss", amount: 10_000 },
    ]);
    expect(s.liabilityFils).toBe(360_000);
    expect(s.assetFils).toBe(180_000 + 90_000);
    expect(s.rows.map((r) => r.nature)).toEqual(["taxable", "deductible", "deductible"]);
  });
});

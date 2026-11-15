import { describe, expect, it } from "vitest";
import {
  calculatePayrollLine,
  calculateSettlement,
  gratuityAccrualTrueUpFils,
  gratuityEntitlement,
  overtimePayFils,
  pensionContribution,
  unpaidLeaveDeductionFils,
  utcDate,
} from "../../server/services/payroll/calc";
import {
  DEFAULT_LEGAL_PARAMS,
  resolveLegalParams,
} from "../../server/services/payroll/legal-params";
import { payrollRunMachine, buildAccrualLines } from "../../server/services/payroll/runs";

const basic10k = 1_000_000; // AED 10,000 in fils
const wages = (basic: number, housing = 0, transport = 0, other = 0) => ({
  basicFils: basic,
  housingFils: housing,
  transportFils: transport,
  otherFils: other,
});

describe("R09-24 gratuity table (report 09 section 3, basic 10,000)", () => {
  const g = (join: string, end: string, unpaidLeaveDays = 0) =>
    gratuityEntitlement({
      joinDate: utcDate(join),
      endDate: utcDate(end),
      basicFils: basic10k,
      unpaidLeaveDays,
    });

  it.each([
    ["1y", "2020-01-01", "2021-01-01", 700_000],
    ["2y", "2020-01-01", "2022-01-01", 1_400_000],
    ["5y", "2020-01-01", "2025-01-01", 3_500_000],
    ["10y", "2010-01-01", "2020-01-01", 8_500_000],
  ])("R09-24: %s -> %i fils", (_label, join, end, expected) => {
    expect(g(join, end).totalFils).toBe(expected);
  });

  it("R09-24: 6y + 182d = 49,986.30", () => {
    const r = g("2019-01-01", "2025-07-02");
    expect(r.completedYears).toBe(6);
    expect(r.trailingDays).toBe(182);
    expect(r.totalFils).toBe(4_998_630);
  });

  it("R09-07: 30 years is capped at 24 months of BASIC (240,000), not total wage", () => {
    const r = g("1990-01-01", "2020-01-01");
    expect(r.uncappedFils).toBe(28_500_000);
    expect(r.capFils).toBe(24_000_000);
    expect(r.totalFils).toBe(24_000_000);
    expect(r.isCapped).toBe(true);
  });

  it("R09-14: under one year of service earns nothing", () => {
    const r = g("2020-01-01", "2020-12-31");
    expect(r.eligible).toBe(false);
    expect(r.totalFils).toBe(0);
  });

  it("R09-14: unpaid leave days are excluded from service length", () => {
    // 1 year exactly minus 10 unpaid days -> below one year -> nothing.
    expect(g("2020-01-01", "2021-01-01", 10).totalFils).toBe(0);
    const five = g("2020-01-01", "2025-01-01", 365);
    expect(five.completedYears).toBe(4);
  });

  it("R09-14: accrual is a true-up and never negative", () => {
    expect(gratuityAccrualTrueUpFils(700_000, 0)).toBe(700_000);
    expect(gratuityAccrualTrueUpFils(700_000, 650_000)).toBe(50_000);
    expect(gratuityAccrualTrueUpFils(700_000, 900_000)).toBe(0);
  });

  it("GCC nationals get no gratuity (pension instead)", () => {
    const r = gratuityEntitlement({
      joinDate: utcDate("2010-01-01"),
      endDate: utcDate("2020-01-01"),
      basicFils: basic10k,
      nationality: "AE",
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("gcc_national");
  });
});

describe("R09-06 / R09-20 pension per configured base", () => {
  it("R09-06: Emirati 20,000 / 5,000 / 2,000 -> 1,250 employee (5% of basic + housing)", () => {
    const p = pensionContribution(wages(2_000_000, 500_000, 200_000), "AE");
    expect(p.baseFils).toBe(2_500_000);
    expect(p.employeeFils).toBe(125_000);
    expect(p.employerFils).toBe(312_500);
    expect(p.ruleConfirmed).toBe(false);
  });

  it("R09-20: base, rates, floor and cap are configurable per GCC country", () => {
    const params = resolveLegalParams({
      pension: {
        SA: {
          employeeRate: "0.09",
          employerRate: "0.09",
          base: "basic_housing_transport",
          maxContributionSalary: "20000.00",
        },
      },
    });
    const p = pensionContribution(wages(2_000_000, 500_000, 200_000), "Saudi", params);
    expect(p.country).toBe("SA");
    expect(p.baseFils).toBe(2_000_000); // capped at 20,000
    expect(p.employeeFils).toBe(180_000);
    // UAE rule untouched
    expect(
      pensionContribution(wages(2_000_000, 500_000, 200_000), "UAE", params).employeeFils
    ).toBe(125_000);
    // expats: none
    expect(pensionContribution(wages(2_000_000), "IN").pensionable).toBe(false);
  });

  it("invalid overrides fall back to the documented defaults", () => {
    expect(resolveLegalParams({ gratuity: { capMonthsOfBasic: -1 } })).toEqual(
      DEFAULT_LEGAL_PARAMS
    );
  });
});

describe("R09-15 unpaid leave and overtime rules", () => {
  it("R09-15: 5 unpaid days reduce pay by basic x 5/30", () => {
    expect(unpaidLeaveDeductionFils(wages(basic10k, 300_000), 5)).toBe(166_667);
    const line = calculatePayrollLine({
      ...wages(basic10k, 300_000),
      nationality: "IN",
      unpaidLeaveDays: 5,
    });
    expect(line.unpaidLeaveDeductionFils).toBe(166_667);
    expect(line.netSalaryFils).toBe(1_300_000 - 166_667);
  });

  it("R09-15: overtime is hours x basic/30/8 x multiplier", () => {
    // 10 hours at 1.25 on basic 10,000: 10,000/240 = 41.6667/h -> 520.83
    expect(overtimePayFils(basic10k, 10, "1.25")).toBe(52_083);
    expect(overtimePayFils(basic10k, 10, "1.5")).toBe(62_500);
  });
});

describe("R09-17 settlement maths", () => {
  it("R09-17: gratuity + notice + leave encashment - deductions; provision used first", () => {
    const r = calculateSettlement({
      ...wages(basic10k, 300_000),
      joinDate: utcDate("2019-01-01"),
      terminationDate: utcDate("2025-07-02"),
      nationality: "IN",
      unpaidLeaveDays: 0,
      noticeDaysInLieu: 30,
      leaveEncashmentDays: 15,
      otherAdditionsFils: 0,
      deductionsFils: 100_000,
      provisionFils: 4_000_000,
    });
    expect(r.gratuityFils).toBe(4_998_630);
    expect(r.provisionUsedFils).toBe(4_000_000);
    expect(r.gratuityExpenseFils).toBe(998_630);
    expect(r.noticePayFils).toBe(1_300_000); // gross / 30 x 30
    expect(r.leaveEncashmentFils).toBe(500_000); // basic / 30 x 15
    expect(r.netFils).toBe(4_998_630 + 1_300_000 + 500_000 - 100_000);
  });
});

describe("R09-02 / R09-22 run state machine and accrual lines", () => {
  it("R09-02: no transition skips approval or goes straight to paid", () => {
    expect(payrollRunMachine.can("draft", "approved")).toBe(false);
    expect(payrollRunMachine.can("calculated", "paid")).toBe(false);
    expect(payrollRunMachine.can("calculated", "approved")).toBe(true);
    expect(payrollRunMachine.can("approved", "paid")).toBe(true);
    expect(payrollRunMachine.can("approved", "reversed")).toBe(true);
    expect(payrollRunMachine.can("reversed", "calculated")).toBe(true);
  });

  it("R09-22: accrual lines split salary cost by cost centre and balance exactly", () => {
    const accounts = {
      salariesExpense: "a5020",
      pensionExpense: "a5025",
      gratuityExpense: "a5028",
      salariesPayable: "a2030",
      pensionPayable: "a2032",
      deductionsPayable: "a2034",
      gratuityProvision: "a2036",
    };
    const item = (
      cc: string | null,
      dept: string,
      net: string,
      extra: Record<string, string> = {}
    ) => ({
      id: "x",
      employee_id: "e",
      basic_salary: "10000.00",
      housing_allowance: "0",
      transport_allowance: "0",
      other_allowance: "0",
      overtime: "0",
      deductions: "0",
      pension_employee: "0",
      pension_employer: "0",
      gratuity_accrual: "0",
      net_salary: net,
      unpaid_leave_deduction: "0",
      unpaid_leave_days: "0",
      paid_leave_days: "0",
      overtime_hours: "0",
      overtime_multiplier: null,
      cost_center_id: cc,
      department: dept,
      ...extra,
    });
    const lines = buildAccrualLines(
      [
        item("cc-a", "Sales", "10000.00", { gratuity_accrual: "583.33" }),
        item("cc-b", "Ops", "9500.00", { pension_employee: "500.00", pension_employer: "1250.00" }),
      ],
      accounts,
      "03/2026"
    );
    const salaryLines = lines.filter((l) => l.accountId === "a5020");
    expect(salaryLines.map((l) => l.costCenterId)).toEqual(["cc-a", "cc-b"]);
    const dr = lines.reduce((a, l) => a + (l.debitFils ?? 0), 0);
    const cr = lines.reduce((a, l) => a + (l.creditFils ?? 0), 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(2_000_000 + 125_000 + 58_333);
  });
});

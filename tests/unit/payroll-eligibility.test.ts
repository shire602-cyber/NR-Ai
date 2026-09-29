import { describe, it, expect } from "vitest";
import {
  parseBasicSalary,
  parseOptionalMoney,
  parseAllowanceFields,
  isPositiveBasicSalary,
  validateBasicSalaryInput,
  partitionPayrollEligible,
  BASIC_SALARY_POSITIVE_MESSAGE,
} from "../../server/services/payroll-eligibility.service";

describe("isPositiveBasicSalary", () => {
  it.each([[5000, true], ["5000.00", true], [0.01, true], [0, false], ["0.00", false], [-1, false], [null, false], [undefined, false], ["", false], ["abc", false], [NaN, false], [Infinity, false]])(
    "%s -> %s",
    (value, expected) => {
      expect(isPositiveBasicSalary(value)).toBe(expected);
    }
  );
});

describe("parseBasicSalary", () => {
  it.each([
    [5000, 5000],
    ["5000", 5000],
    [" 5000.50 ", 5000.5],
    ["+3500", 3500],
    [".5", 0.5],
  ])("accepts %j as %s", (input, expected) => {
    expect(parseBasicSalary(input)).toBe(expected);
  });

  it.each(["5,000", "5000abc", "5e3", "0x10", "1 000", "--5", "Infinity", "NaN", "", "  ", null, undefined, {}, [], true, NaN, Infinity])(
    "rejects %j",
    (input) => {
      expect(parseBasicSalary(input)).toBeNull();
    }
  );
});

describe("validateBasicSalaryInput", () => {
  it("rejects a comma-grouped string that parseFloat would truncate to 5", () => {
    expect(validateBasicSalaryInput("5,000")).toBe(BASIC_SALARY_POSITIVE_MESSAGE);
    expect(validateBasicSalaryInput("5000abc")).toBe(BASIC_SALARY_POSITIVE_MESSAGE);
    expect(isPositiveBasicSalary("5,000")).toBe(false);
  });

  it("returns a clear message for zero and negative", () => {
    expect(validateBasicSalaryInput(0)).toBe(BASIC_SALARY_POSITIVE_MESSAGE);
    expect(validateBasicSalaryInput(-100)).toBe(BASIC_SALARY_POSITIVE_MESSAGE);
  });
  it("returns null for a positive salary", () => {
    expect(validateBasicSalaryInput("3500")).toBeNull();
  });
});

describe("partitionPayrollEligible", () => {
  const emps = [
    { id: "a", full_name: "Aisha", employee_number: "E1", basic_salary: "8000.00" },
    { id: "b", full_name: "Bilal", employee_number: "E2", basic_salary: "0.00" },
    { id: "c", full_name: null, employee_number: null, basic_salary: "0" },
  ];
  it("excludes zero-salary employees and warns by name", () => {
    const r = partitionPayrollEligible(emps);
    expect(r.eligible.map((e) => e.id)).toEqual(["a"]);
    expect(r.excluded.map((e) => e.id)).toEqual(["b", "c"]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("Bilal");
    expect(r.warnings[0]).toContain("E2");
    expect(r.warnings[1]).toContain("c");
  });
  it("returns no warnings when everyone is payable", () => {
    const r = partitionPayrollEligible([emps[0]]);
    expect(r.warnings).toEqual([]);
    expect(r.excluded).toEqual([]);
  });
});

describe("parseOptionalMoney", () => {
  it.each([
    [5000, 5000],
    ["5000.50", 5000.5],
    [" 250 ", 250],
    [0, 0],
    ["0", 0],
  ])("accepts %j as %s", (input, expected) => {
    expect(parseOptionalMoney(input, "housingAllowance")).toEqual({ ok: true, value: expected });
  });

  it.each([undefined, null, "", "   "])("treats %j as not supplied", (input) => {
    expect(parseOptionalMoney(input, "housingAllowance")).toEqual({ ok: true, value: undefined });
  });

  it.each(["5,000", "5000abc", "5e3", "0x10", "abc", -1, "-5", NaN, Infinity, true, {}, []])(
    "rejects %j and names the field",
    (input) => {
      const r = parseOptionalMoney(input, "transportAllowance");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("transportAllowance");
    }
  );
});

describe("parseAllowanceFields", () => {
  it("returns only the supplied fields as numbers", () => {
    expect(parseAllowanceFields({ housingAllowance: "1500", otherAllowance: 20 })).toEqual({
      ok: true,
      values: { housingAllowance: 1500, otherAllowance: 20 },
    });
  });

  it("skips empty values so an update leaves them unchanged", () => {
    expect(parseAllowanceFields({ housingAllowance: "", transportAllowance: undefined })).toEqual({
      ok: true,
      values: {},
    });
  });

  it("fails on the first malformed field, naming it", () => {
    const r = parseAllowanceFields({ housingAllowance: 100, transportAllowance: "5,000" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("transportAllowance");
      expect(r.message).toContain("transportAllowance");
    }
  });

  it("fails on a negative allowance", () => {
    const r = parseAllowanceFields({ otherAllowance: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("otherAllowance");
  });
});

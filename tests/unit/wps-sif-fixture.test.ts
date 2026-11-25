// O07 — WPS SIF fixture: validates the fixed-width layout and field placement of
// generateSIFFile against hand-calculated expected values.
//
// UAE Central Bank WPS SIF format:
//   SCR line: 165 chars (3 + 15 + 9 + 34 + 8 + 8 + 8 + 6 + 6 + 15 + 3 + 50)
//   EDR line: 229 chars (3 + 15 + 9 + 34 + 8 + 8 + 4 + 15 + 15 + 15 + 15 + 15 + 3 + 50 + 20)
//   Lines separated by CRLF.
//
// The file creation date/time fields are wall-clock-dependent; this test checks
// field positions at known offsets rather than the full string.
import { describe, it, expect } from "vitest";
import { generateSIFFile } from "../../server/services/wps-sif.service";

const COMPANY = {
  name: "Pearl Trading LLC",
  registrationNumber: "REG-123456789",
  bankName: "Emirates NBD",
  bankAccountNumber: "AE070331234567890123456",
  routingCode: "ENBD-AED",
};

const PAYROLL_RUN = {
  id: "run-001",
  periodMonth: 6,
  periodYear: 2026,
  totalBasic: "10000.00",
  totalAllowances: "3000.00",
  totalDeductions: "500.00",
  totalNet: "12500.00",
  employeeCount: 2,
};

const EMPLOYEES: Map<string, { employeeNumber?: string; fullName: string; laborCardNumber?: string; bankName?: string; bankAccountNumber?: string; iban?: string; routingCode?: string }> = new Map([
  [
    "emp-001",
    {
      employeeNumber: "EMP001",
      fullName: "Mohammed Al Rashidi",
      laborCardNumber: "LAB-001-2026",
      iban: "AE070331234567890123456",
      routingCode: "ENBD-AED",
    },
  ],
  [
    "emp-002",
    {
      employeeNumber: "EMP002",
      fullName: "Fatima Khalil",
      laborCardNumber: "LAB-002-2026",
      bankAccountNumber: "AE060330987654321098765",
      routingCode: "FAB-AED",
    },
  ],
]);

const PAYROLL_ITEMS = [
  {
    employeeId: "emp-001",
    basicSalary: "5000.00",
    housingAllowance: "1000.00",
    transportAllowance: "500.00",
    otherAllowance: "0.00",
    overtime: "0.00",
    deductions: "250.00",
    netSalary: "6250.00",
    paymentMode: "BT",
  },
  {
    employeeId: "emp-002",
    basicSalary: "5000.00",
    housingAllowance: "1000.00",
    transportAllowance: "500.00",
    otherAllowance: "0.00",
    overtime: "0.00",
    deductions: "250.00",
    netSalary: "6250.00",
    paymentMode: "BT",
  },
];

describe("WPS SIF file generator (O07)", () => {
  let sifContent: string;
  let lines: string[];

  // Generate once for all tests
  function getLines() {
    if (!sifContent) {
      sifContent = generateSIFFile(COMPANY, PAYROLL_RUN, PAYROLL_ITEMS, EMPLOYEES as any);
      lines = sifContent.split("\r\n");
    }
    return lines;
  }

  it("produces CRLF line endings between records", () => {
    const content = generateSIFFile(COMPANY, PAYROLL_RUN, PAYROLL_ITEMS, EMPLOYEES as any);
    expect(content).toContain("\r\n");
  });

  it("produces one SCR header line and one EDR line per employee", () => {
    const ls = getLines();
    // 2 employees → SCR + 2 EDR = 3 lines (last may be empty after trailing CRLF)
    const nonEmpty = ls.filter((l) => l.length > 0);
    expect(nonEmpty).toHaveLength(3);
    expect(nonEmpty[0].startsWith("SCR")).toBe(true);
    expect(nonEmpty[1].startsWith("EDR")).toBe(true);
    expect(nonEmpty[2].startsWith("EDR")).toBe(true);
  });

  it("SCR line is exactly 165 characters", () => {
    const scr = getLines()[0];
    expect(scr.length).toBe(165);
  });

  it("EDR lines are exactly 229 characters each", () => {
    const ls = getLines().filter((l) => l.startsWith("EDR"));
    expect(ls).toHaveLength(2);
    for (const edr of ls) {
      expect(edr.length).toBe(229);
    }
  });

  it("SCR encodes salary period start/end for June 2026 at correct offsets", () => {
    const scr = getLines()[0];
    // offset 3+15+9+34 = 61 → salaryStart (8), salaryEnd (8)
    expect(scr.slice(61, 69)).toBe("20260601");
    expect(scr.slice(69, 77)).toBe("20260630");
  });

  it("SCR encodes employee count at correct offset", () => {
    const scr = getLines()[0];
    // offset 3+15+9+34+8+8+8+6 = 91 → 6-char left-padded count
    expect(scr.slice(91, 97)).toBe("000002");
  });

  it("SCR encodes total net salary at correct offset", () => {
    const scr = getLines()[0];
    // offset 97 → 15-char amount: 12500.00 → 1250000 → padded to 15
    expect(scr.slice(97, 112)).toBe("000000001250000");
  });

  it("SCR encodes currency code AED at correct offset", () => {
    const scr = getLines()[0];
    expect(scr.slice(112, 115)).toBe("AED");
  });

  it("SCR encodes company name left-aligned, padded to 50 at correct offset", () => {
    const scr = getLines()[0];
    const nameField = scr.slice(115, 165);
    expect(nameField.trimEnd()).toBe("Pearl Trading LLC");
    expect(nameField.length).toBe(50);
  });

  it("EDR encodes IBAN at correct offset (falls back to bankAccountNumber when no IBAN)", () => {
    const ls = getLines().filter((l) => l.startsWith("EDR"));
    const edr1 = ls[0];
    const edr2 = ls[1];
    // offset 3+15+9 = 27 → 34-char IBAN/account field
    expect(edr1.slice(27, 61).trimEnd()).toBe("AE070331234567890123456");
    // emp-002 has no IBAN but has bankAccountNumber
    expect(edr2.slice(27, 61).trimEnd()).toBe("AE060330987654321098765");
  });

  it("EDR encodes net salary at correct offset", () => {
    const edr = getLines().filter((l) => l.startsWith("EDR"))[0];
    // offset 3+15+9+34+8+8+4+15+15+15+15 = 141 → 15-char net salary
    // 6250.00 → 625000 → padded to 15
    expect(edr.slice(141, 156)).toBe("000000000625000");
  });

  it("EDR encodes employee name left-aligned, padded to 50 at correct offset", () => {
    const edr = getLines().filter((l) => l.startsWith("EDR"))[0];
    // offset 3+15+9+34+8+8+4+15+15+15+15+15+3 = 159 → 50-char name
    const nameField = edr.slice(159, 209);
    expect(nameField.trimEnd()).toBe("Mohammed Al Rashidi");
    expect(nameField.length).toBe(50);
  });

  it("generates valid output for a single-employee run", () => {
    const singleItem = PAYROLL_ITEMS.slice(0, 1);
    const singleRun = { ...PAYROLL_RUN, employeeCount: 1, totalNet: "6250.00" };
    const content = generateSIFFile(COMPANY, singleRun, singleItem, EMPLOYEES as any);
    const ls = content.split("\r\n").filter((l) => l.length > 0);
    expect(ls).toHaveLength(2);
    expect(ls[0].startsWith("SCR")).toBe(true);
    expect(ls[1].startsWith("EDR")).toBe(true);
    expect(ls[0].length).toBe(165);
    expect(ls[1].length).toBe(229);
  });

  it("skips EDR when employee is not in the employees map", () => {
    const badItem = [{ ...PAYROLL_ITEMS[0], employeeId: "unknown-id" }];
    const content = generateSIFFile(COMPANY, PAYROLL_RUN, badItem, EMPLOYEES as any);
    const ls = content.split("\r\n").filter((l) => l.length > 0);
    // Only SCR, no EDR
    expect(ls).toHaveLength(1);
    expect(ls[0].startsWith("SCR")).toBe(true);
  });

  it("formatAmount handles zero correctly", () => {
    const item = [{ ...PAYROLL_ITEMS[0], deductions: "0", netSalary: "5000.00" }];
    const content = generateSIFFile(COMPANY, PAYROLL_RUN, item, EMPLOYEES as any);
    const edr = content.split("\r\n").find((l) => l.startsWith("EDR"))!;
    // deductions at offset 3+15+9+34+8+8+4+15+15+15 = 126 → 15 chars
    expect(edr.slice(126, 141)).toBe("000000000000000");
  });
});

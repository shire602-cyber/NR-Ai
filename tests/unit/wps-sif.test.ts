import { describe, it, expect } from "vitest";
import { edrLine, generateSIFFile, sifProblems, type SifEmployee, type SifItem } from "../../server/services/wps-sif.service";

const company = { mohreEstablishmentId: "1234567", routingCode: "033000001", reference: "PAYROLL-2026-08" };
const emp = (extra: Partial<SifEmployee> = {}): SifEmployee => ({
  fullName: "Ahmed Hassan", molPersonId: "12345678901234", routingCode: "033000002", iban: "AE070331234567890123456", ...extra,
});
const item = (extra: Partial<SifItem> = {}): SifItem => ({ employeeId: "e1", netSalary: 9000, overtime: 0, ...extra });

describe("EDR layout", () => {
  it("a full month: calendar days, 1st to last day, fixed income = net, variable 0, no leave", () => {
    expect(edrLine({ periodMonth: 8, periodYear: 2026 }, item(), emp())).toBe(
      "EDR,12345678901234,033000002,AE070331234567890123456,2026-08-01,2026-08-31,31,9000.00,0.00,0"
    );
  });
  it("a mid-month joiner (15 Aug): pay starts on the join date and the days are 16, not 31", () => {
    expect(edrLine({ periodMonth: 8, periodYear: 2026 }, item({ netSalary: 4800, daysWorked: 16 }), emp({ joinYmd: "2026-08-15" }))).toBe(
      "EDR,12345678901234,033000002,AE070331234567890123456,2026-08-15,2026-08-31,16,4800.00,0.00,0"
    );
  });
  it("overtime is the variable part; the two add up to the net; days on leave are reported", () => {
    expect(edrLine({ periodMonth: 9, periodYear: 2026 }, item({ netSalary: 5500.5, overtime: 500.5, leaveDays: 10 }), emp())).toBe(
      "EDR,12345678901234,033000002,AE070331234567890123456,2026-09-01,2026-09-30,30,5000.00,500.50,10"
    );
  });
  it("a leaver's pay ends on the last day worked", () => {
    expect(edrLine({ periodMonth: 9, periodYear: 2026 }, item({ netSalary: 3000, daysWorked: 12 }), emp({ terminationYmd: "2026-09-12" }))).toContain(",2026-09-01,2026-09-12,12,3000.00,");
  });
  it("falls back to the account number when there is no IBAN", () => {
    expect(edrLine({ periodMonth: 9, periodYear: 2026 }, item(), emp({ iban: null, bankAccountNumber: "0123 4567" }))).toContain(",033000002,01234567,");
  });
});

describe("the file: EDR records first, one SCR last, CSV, no header", () => {
  const employees = new Map([["e1", emp()], ["e2", emp({ fullName: "Second", molPersonId: "99999999999999" })]]);
  const file = generateSIFFile({
    company,
    run: { periodMonth: 8, periodYear: 2026 },
    items: [item(), item({ employeeId: "e2", netSalary: 1000.25 })],
    employees,
    now: new Date("2026-09-03T08:05:00Z"),
  });
  const lines = file.split("\r\n");
  it("two EDR lines then the SCR", () => {
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("EDR,")).toBe(true);
    expect(lines[1].startsWith("EDR,")).toBe(true);
    expect(lines[2].startsWith("SCR,")).toBe(true);
  });
  it("SCR: employer ID, routing code, date, HHMM, MMYYYY, EDR count, total, AED, reference", () => {
    expect(lines[2]).toBe("SCR,1234567,033000001,2026-09-03,0805,082026,2,10000.25,AED,PAYROLL-2026-08");
  });
});

describe("sifProblems: what is missing, by name", () => {
  const employees = new Map([["e1", emp({ molPersonId: "123", routingCode: "", iban: "" })]]);
  it("lists the employer and employee identifiers the file cannot do without", () => {
    const p = sifProblems({ mohreEstablishmentId: "", routingCode: null }, [item()], employees);
    expect(p.map((x) => `${x.scope}:${x.field}`)).toEqual(["company:mohreEstablishmentId", "company:routingCode", "employee:molPersonId", "employee:routingCode", "employee:iban"]);
    expect(p[2].message).toContain("Ahmed Hassan");
  });
  it("nothing missing = an empty list", () => {
    expect(sifProblems(company, [item()], new Map([["e1", emp()]]))).toEqual([]);
  });
});

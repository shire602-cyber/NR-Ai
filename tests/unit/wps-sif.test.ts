import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSif,
  parseSif,
  prevalidateSif,
  type SifInput,
} from "../../server/services/wps-sif.service";

const golden = readFileSync(join(__dirname, "..", "fixtures", "wps", "golden-2026-03.SIF"), "utf8");

function input(overrides: Partial<SifInput> = {}): SifInput {
  return {
    employer: {
      name: "Golden Trading LLC",
      molEstablishmentId: "1000000000123",
      routingCode: "600310101",
      reference: "032026",
    },
    periodMonth: 3,
    periodYear: 2026,
    createdAt: new Date("2026-04-02T09:30:15Z"),
    lines: [
      {
        employeeId: "e1",
        employeeName: "Aisha Khan",
        molPersonId: "10012345678901",
        routingCode: "600310101",
        iban: "AE07 0331 2345 6789 0123 456",
        netFils: 1_300_000,
        variableFils: 75_000,
        leaveDays: 2,
      },
      {
        employeeId: "e2",
        employeeName: "Rahul Nair",
        molPersonId: "10012345678902",
        routingCode: "602620101",
        iban: "AE690260001015123456701",
        netFils: 833_333,
        variableFils: 0,
        leaveDays: 0,
      },
    ],
    ...overrides,
  };
}

describe("WPS SIF (R09-03 / R09-18): CBUAE comma-separated EDR/SCR", () => {
  it("R09-03: matches the golden file byte for byte, with the standard file name", () => {
    const file = buildSif(input());
    expect(file.content).toBe(golden);
    expect(file.fileName).toBe("1000000000123260402093015.SIF");
    expect(file.edrCount).toBe(2);
    expect(file.totalFils).toBe(2_133_333);
  });

  it("R09-03: golden file parses back field by field", () => {
    const parsed = parseSif(golden);
    expect(parsed.errors).toEqual([]);
    expect(parsed.valid).toBe(true);
    expect(parsed.edrs).toHaveLength(2);
    expect(parsed.edrs[0]).toMatchObject({
      personId: "10012345678901",
      routingCode: "600310101",
      iban: "AE070331234567890123456",
      payStart: "2026-03-01",
      payEnd: "2026-03-31",
      daysInPeriod: 31,
      fixedFils: 1_225_000,
      variableFils: 75_000,
      leaveDays: 2,
    });
    expect(parsed.edrs[1]).toMatchObject({ fixedFils: 833_333, variableFils: 0, leaveDays: 0 });
    expect(parsed.scr).toMatchObject({
      establishmentId: "1000000000123",
      routingCode: "600310101",
      creationDate: "2026-04-02",
      creationTime: "0930",
      salaryMonth: "032026",
      edrCount: 2,
      totalFils: 2_133_333,
      currency: "AED",
      reference: "032026",
    });
    for (const line of golden.trim().split(/\r\n/)) {
      expect(line.split(",")[0]).toMatch(/^(EDR|SCR)$/);
      expect(line.length).toBeLessThan(120); // not the old 230-char fixed-width layout
    }
  });

  it("R09-04: a blank MOL establishment id blocks generation with an employer issue", () => {
    const bad = input({
      employer: { name: "X", molEstablishmentId: null, routingCode: "600310101" },
    });
    expect(() => buildSif(bad)).toThrow(
      expect.objectContaining({ code: "SIF_PREVALIDATION_FAILED", statusCode: 422 })
    );
    const issues = prevalidateSif(bad);
    expect(issues).toEqual([
      expect.objectContaining({ scope: "employer", field: "mohreEstablishmentId" }),
    ]);
  });

  it("R09-04: blank or malformed employee identifiers are listed per employee", () => {
    const base = input();
    const bad = input({
      lines: [
        { ...base.lines[0], molPersonId: "", iban: "XX" },
        { ...base.lines[1], routingCode: "12345" },
      ],
    });
    const issues = prevalidateSif(bad);
    expect(issues.map((i) => `${i.employeeId}:${i.field}`).sort()).toEqual([
      "e1:iban",
      "e1:molPersonId",
      "e2:routingCode",
    ]);
    expect(() => buildSif(bad)).toThrow(/cannot be generated/);
  });

  it("R09-18: the validator flags a tampered total, a bad IBAN and a missing SCR", () => {
    const tampered = golden.replace("21333.33", "21333.34");
    const r = parseSif(tampered);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.field)).toContain("totalSalary");
    const badIban = parseSif(golden.replace("AE070331234567890123456", "AE080331234567890123456"));
    expect(badIban.errors.map((e) => e.field)).toContain("iban");
    const noScr = parseSif(golden.split("\r\n").slice(0, 2).join("\r\n"));
    expect(noScr.errors.map((e) => e.field)).toContain("scr");
  });

  it("variable pay never exceeds net (fixed + variable = transferred amount)", () => {
    const base = input();
    const file = buildSif(
      input({ lines: [{ ...base.lines[0], netFils: 50_000, variableFils: 75_000 }] })
    );
    const parsed = parseSif(file.content);
    expect(parsed.valid).toBe(true);
    expect(parsed.edrs[0].fixedFils + parsed.edrs[0].variableFils).toBe(50_000);
  });
});

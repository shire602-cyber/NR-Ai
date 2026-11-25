// O07 — WPS SIF fixture: validates the CSV layout and field placement of
// buildSif against hand-calculated expected values.
//
// UAE Central Bank WPS SIF format (CSV):
//   EDR,<14-digit person id>,<9-digit routing code>,<UAE IBAN>,
//       <pay start YYYY-MM-DD>,<pay end YYYY-MM-DD>,<days in period>,
//       <fixed AED>,<variable AED>,<leave days>
//   SCR,<13-digit establishment id>,<9-digit routing code>,
//       <creation date YYYY-MM-DD>,<creation time HHMM>,<period MMYYYY>,
//       <EDR count>,<total AED>,AED[,<reference>]
//   Lines separated by CRLF; EDRs precede SCR.
import { describe, it, expect, beforeAll } from "vitest";
import { buildSif, prevalidateSif } from "../../server/services/wps-sif.service";
import type { SifInput } from "../../server/services/wps-sif.service";

// IBANs confirmed valid in payroll-runs.test.ts and report-audit-fixture.mjs
const IBAN_1 = "AE070331234567890123456";
const IBAN_2 = "AE690260001015123456701";

const CREATED_AT = new Date("2026-11-26T09:30:00Z");

const BASE_INPUT: SifInput = {
  employer: {
    name: "Pearl Trading LLC",
    molEstablishmentId: "1000000000123",
    routingCode: "600310101",
  },
  periodMonth: 6,
  periodYear: 2026,
  createdAt: CREATED_AT,
  lines: [
    {
      employeeId: "emp-001",
      employeeName: "Mohammed Al Rashidi",
      molPersonId: "10012345678901",
      routingCode: "600310101",
      iban: IBAN_1,
      netFils: 625000, // AED 6250.00
      variableFils: 0,
      leaveDays: 0,
    },
    {
      employeeId: "emp-002",
      employeeName: "Fatima Khalil",
      molPersonId: "10012345678902",
      routingCode: "602620101",
      iban: IBAN_2,
      netFils: 625000, // AED 6250.00
      variableFils: 0,
      leaveDays: 0,
    },
  ],
};

describe("WPS SIF file generator (O07)", () => {
  let result: ReturnType<typeof buildSif>;
  let lines: string[];

  beforeAll(() => {
    result = buildSif(BASE_INPUT);
    lines = result.content.split("\r\n");
  });

  it("produces CRLF line endings between records", () => {
    expect(result.content).toContain("\r\n");
  });

  it("produces EDR lines then one SCR line", () => {
    const nonEmpty = lines.filter((l) => l.length > 0);
    // 2 employees → 2 EDR + 1 SCR
    expect(nonEmpty).toHaveLength(3);
    expect(nonEmpty[0]).toMatch(/^EDR,/);
    expect(nonEmpty[1]).toMatch(/^EDR,/);
    expect(nonEmpty[2]).toMatch(/^SCR,/);
  });

  it("edrCount and totalFils reflect both employees", () => {
    expect(result.edrCount).toBe(2);
    expect(result.totalFils).toBe(1250000); // AED 12500.00
  });

  it("EDR encodes June 2026 period start and end", () => {
    const edr = lines.find((l) => l.startsWith("EDR,"))!;
    const f = edr.split(",");
    expect(f[4]).toBe("2026-06-01");
    expect(f[5]).toBe("2026-06-30");
    expect(f[6]).toBe("30");
  });

  it("EDR encodes employee IBAN in field 3", () => {
    const edrs = lines.filter((l) => l.startsWith("EDR,"));
    expect(edrs[0].split(",")[3]).toBe(IBAN_1);
    expect(edrs[1].split(",")[3]).toBe(IBAN_2);
  });

  it("EDR encodes net salary as fixed and variable AED amounts", () => {
    const edr = lines.find((l) => l.startsWith("EDR,"))!;
    const f = edr.split(",");
    expect(f[7]).toBe("6250.00"); // fixed (net - variable)
    expect(f[8]).toBe("0.00"); // variable
  });

  it("variable component is capped at net when over", () => {
    const over = buildSif({
      ...BASE_INPUT,
      lines: [{ ...BASE_INPUT.lines[0], netFils: 100000, variableFils: 150000 }],
    });
    const f = over.content.split("\r\n").find((l) => l.startsWith("EDR,"))!.split(",");
    expect(f[8]).toBe("1000.00"); // variable capped at net
    expect(f[7]).toBe("0.00"); // fixed = net - capped variable
  });

  it("SCR encodes employer establishment ID and routing code", () => {
    const scr = lines.find((l) => l.startsWith("SCR,"))!;
    const f = scr.split(",");
    expect(f[1]).toBe("1000000000123");
    expect(f[2]).toBe("600310101");
  });

  it("SCR encodes salary period as MMYYYY", () => {
    const scr = lines.find((l) => l.startsWith("SCR,"))!;
    expect(scr.split(",")[5]).toBe("062026");
  });

  it("SCR encodes EDR count and total salary", () => {
    const scr = lines.find((l) => l.startsWith("SCR,"))!;
    const f = scr.split(",");
    expect(f[6]).toBe("2");
    expect(f[7]).toBe("12500.00");
    expect(f[8]).toBe("AED");
  });

  it("generates valid output for a single-employee run", () => {
    const single = buildSif({ ...BASE_INPUT, lines: BASE_INPUT.lines.slice(0, 1) });
    const ls = single.content.split("\r\n").filter((l) => l.length > 0);
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatch(/^EDR,/);
    expect(ls[1]).toMatch(/^SCR,/);
    expect(single.edrCount).toBe(1);
    expect(single.totalFils).toBe(625000);
  });

  it("fileName includes establishment ID and timestamp", () => {
    expect(result.fileName).toMatch(/^1000000000123\d{12}\.SIF$/);
  });

  it("prevalidateSif catches missing establishment ID", () => {
    const issues = prevalidateSif({
      ...BASE_INPUT,
      employer: { ...BASE_INPUT.employer, molEstablishmentId: null },
    });
    expect(issues.some((i) => i.field === "mohreEstablishmentId")).toBe(true);
  });

  it("prevalidateSif catches non-numeric routing code", () => {
    const issues = prevalidateSif({
      ...BASE_INPUT,
      employer: { ...BASE_INPUT.employer, routingCode: "ENBD-AED" },
    });
    expect(issues.some((i) => i.field === "wpsEmployerRoutingCode")).toBe(true);
  });

  it("prevalidateSif catches invalid employee IBAN", () => {
    const issues = prevalidateSif({
      ...BASE_INPUT,
      lines: [{ ...BASE_INPUT.lines[0], iban: "GB82WEST12345698765432" }],
    });
    expect(issues.some((i) => i.field === "iban")).toBe(true);
  });

  it("buildSif throws SIF_PREVALIDATION_FAILED when validation fails", () => {
    expect(() =>
      buildSif({
        ...BASE_INPUT,
        employer: { ...BASE_INPUT.employer, molEstablishmentId: "SHORT" },
      })
    ).toThrow();
  });
});

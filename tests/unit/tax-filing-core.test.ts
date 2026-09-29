import { describe, expect, it } from "vitest";
import {
  buildCtSnapshot,
  buildVatSnapshot,
  canonicalJson,
  diffBoxes,
  snapshotHash,
  monthEndsInRange,
  validateFilingInput,
} from "../../server/services/tax-filing-core";

const NOW = new Date("2026-09-29T12:00:00Z"); // 16:00 UAE

const row = {
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-31T23:59:59.999Z"),
  dueDate: new Date("2026-09-28T23:59:59.999Z"),
  vatStagger: "monthly",
  box1bDubaiAmount: 1000,
  box1bDubaiVat: 50,
  box8TotalVat: 50,
  box9ExpensesVat: 10,
  box12TotalDueTax: 50,
  box13RecoverableTax: 10,
  box14PayableTax: 40,
  // legacy aliases must never enter a snapshot
  box1SalesStandard: 999,
  box9NetTax: 999,
  adjustmentAmount: 0,
  adjustmentReason: null,
  companyId: "not-a-box",
  status: "submitted",
};

describe("buildVatSnapshot", () => {
  it("captures every canonical box, the period and nothing else", () => {
    const s = buildVatSnapshot(row);
    expect(s.periodStart).toBe("2026-08-01");
    expect(s.periodEnd).toBe("2026-08-31");
    expect(s.boxes.box14PayableTax).toBe(40);
    expect(s.boxes.box1bDubaiVat).toBe(50);
    expect(Object.keys(s.boxes)).not.toContain("box1SalesStandard");
    expect(Object.keys(s.boxes)).not.toContain("box9NetTax");
    expect(Object.keys(s.boxes)).not.toContain("companyId");
  });

  it("rounds every box to fils", () => {
    const s = buildVatSnapshot({ ...row, box8TotalVat: 10.005000000000001 });
    expect(s.boxes.box8TotalVat).toBe(10.01);
  });
});

describe("canonicalJson / snapshotHash", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("hashes to a stable 64-char SHA-256 that changes with any figure", () => {
    const a = snapshotHash(buildVatSnapshot(row));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotHash(buildVatSnapshot(row))).toBe(a);
    expect(snapshotHash(buildVatSnapshot({ ...row, box8TotalVat: 50.01 }))).not.toBe(a);
  });
});

describe("diffBoxes", () => {
  it("returns only boxes that differ, with filed / current / difference", () => {
    const filed = { box8TotalVat: 50, box13RecoverableTax: 10, box14PayableTax: 40 };
    const live = { box8TotalVat: 55.25, box13RecoverableTax: 10, box14PayableTax: 45.25 };
    expect(diffBoxes(filed, live)).toEqual([
      { box: "box14PayableTax", filed: 40, current: 45.25, difference: 5.25 },
      { box: "box8TotalVat", filed: 50, current: 55.25, difference: 5.25 },
    ]);
  });

  it("treats a box missing on one side as zero and ignores sub-fils noise", () => {
    expect(diffBoxes({ box1: 1 }, { box1: 1.0000001, box2: 0 })).toEqual([]);
    expect(diffBoxes({}, { box2: 3 })).toEqual([{ box: "box2", filed: 0, current: 3, difference: 3 }]);
  });
});

describe("validateFilingInput", () => {
  const base = { referenceNumber: "FTA-123", filedAt: "2026-09-20", periodEnd: "2026-08-31", now: NOW };

  it("accepts a reference and a filing date after the period end", () => {
    expect(validateFilingInput(base)).toEqual({ ok: true, referenceNumber: "FTA-123", filedAt: "2026-09-20" });
  });

  it("trims the reference and accepts the period end day itself", () => {
    const r = validateFilingInput({ ...base, referenceNumber: "  R-1 ", filedAt: "2026-08-31" });
    expect(r).toEqual({ ok: true, referenceNumber: "R-1", filedAt: "2026-08-31" });
  });

  it("requires a reference number", () => {
    const r = validateFilingInput({ ...base, referenceNumber: "   " });
    expect(r).toMatchObject({ ok: false, code: "FTA_REFERENCE_REQUIRED" });
  });

  it("requires a real calendar date", () => {
    expect(validateFilingInput({ ...base, filedAt: undefined })).toMatchObject({ ok: false, code: "FILED_AT_REQUIRED" });
    expect(validateFilingInput({ ...base, filedAt: "20/09/2026" })).toMatchObject({ ok: false, code: "FILED_AT_INVALID" });
    expect(validateFilingInput({ ...base, filedAt: "2026-02-30" })).toMatchObject({ ok: false, code: "FILED_AT_INVALID" });
  });

  it("rejects a filing date in the future (UAE calendar day)", () => {
    // 2026-09-29T12:00Z is still 2026-09-29 in the UAE; tomorrow is future.
    expect(validateFilingInput({ ...base, filedAt: "2026-09-29" }).ok).toBe(true);
    expect(validateFilingInput({ ...base, filedAt: "2026-09-30" })).toMatchObject({ ok: false, code: "FILED_AT_IN_FUTURE" });
  });

  it("rejects a filing date before the period end", () => {
    expect(validateFilingInput({ ...base, filedAt: "2026-08-30" })).toMatchObject({ ok: false, code: "FILED_AT_BEFORE_PERIOD_END" });
  });

  it("caps the reference length", () => {
    expect(validateFilingInput({ ...base, referenceNumber: "x".repeat(101) })).toMatchObject({ ok: false, code: "FTA_REFERENCE_INVALID" });
  });
});

describe("monthEndsInRange", () => {
  it("one month period -> that month's last day", () => {
    expect(monthEndsInRange("2026-08-01", "2026-08-31")).toEqual(["2026-08-31"]);
  });

  it("a quarter -> three month ends, including a leap February", () => {
    expect(monthEndsInRange("2028-01-01", "2028-03-31")).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("a period that crosses a year end", () => {
    expect(monthEndsInRange("2026-11-01", "2027-01-31")).toEqual(["2026-11-30", "2026-12-31", "2027-01-31"]);
  });

  it("a mid-month start still includes its month", () => {
    expect(monthEndsInRange("2026-08-15", "2026-09-10")).toEqual(["2026-08-31", "2026-09-30"]);
  });
});

describe("buildCtSnapshot", () => {
  const ct = {
    taxPeriodStart: new Date("2026-01-01T00:00:00Z"),
    taxPeriodEnd: new Date("2026-12-31T00:00:00Z"),
    totalRevenue: 900000.005,
    totalExpenses: 400000,
    totalDeductions: 0,
    taxableIncome: 500000,
    exemptionThreshold: 375000,
    taxRate: 0.09,
    taxPayable: 11250,
    lossBroughtForward: 0,
    lossCarriedForward: 0,
    smallBusinessRelief: false,
    workpaper: { source: "journal_calculation", rows: [{ label: "Sales", amount: 900000 }] },
    companyId: "ignored",
  };

  it("freezes the figures, the period and a hash of the workpaper", () => {
    const s = buildCtSnapshot(ct);
    expect(s.kind).toBe("corporate_tax");
    expect(s.periodStart).toBe("2026-01-01");
    expect(s.periodEnd).toBe("2026-12-31");
    expect(s.boxes.taxPayable).toBe(11250);
    expect(s.boxes.totalRevenue).toBe(900000.01);
    expect(s.boxes.taxRate).toBe(0.09);
    expect(s.smallBusinessRelief).toBe(false);
    expect(s.workpaperHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(s.boxes)).not.toContain("companyId");
  });

  it("the workpaper hash changes when a workpaper row changes", () => {
    const changed = buildCtSnapshot({ ...ct, workpaper: { source: "journal_calculation", rows: [{ label: "Sales", amount: 1 }] } });
    expect(changed.workpaperHash).not.toBe(buildCtSnapshot(ct).workpaperHash);
  });
});

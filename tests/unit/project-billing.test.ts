import { describe, it, expect } from "vitest";
import {
  buildProjectInvoiceLines,
  effectiveRate,
  isEntryBillable,
  isUnbilled,
  minutesBetween,
  summarizeUnbilled,
  profitability,
} from "../../server/services/project-billing";

const project = { id: "p1", billingMethod: "hourly" as const, hourlyRate: 200, currency: "AED" };
const entry = (o: any) => ({ id: "e", entryDate: "2026-09-01", minutes: 60, isBillable: true, rate: null, notes: null, taskId: null, billedInvoiceId: null, billedInvoiceStatus: null, running: false, ...o });

describe("effectiveRate", () => {
  it("an entry rate beats the task rate beats the project rate", () => {
    expect(effectiveRate(entry({ rate: 300 }), { hourlyRate: 250, isBillable: true }, project)).toBe(300);
    expect(effectiveRate(entry({}), { hourlyRate: 250, isBillable: true }, project)).toBe(250);
    expect(effectiveRate(entry({}), { hourlyRate: null, isBillable: true }, project)).toBe(200);
    expect(effectiveRate(entry({}), null, { ...project, hourlyRate: null })).toBe(0);
  });
});

describe("isEntryBillable", () => {
  it("needs an hourly project, a billable entry and a billable task", () => {
    expect(isEntryBillable(entry({}), null, project)).toBe(true);
    expect(isEntryBillable(entry({ isBillable: false }), null, project)).toBe(false);
    expect(isEntryBillable(entry({}), { hourlyRate: null, isBillable: false }, project)).toBe(false);
    expect(isEntryBillable(entry({}), null, { ...project, billingMethod: "non_billable" })).toBe(false);
  });
  it("a running timer is not billable yet", () => {
    expect(isEntryBillable(entry({ running: true }), null, project)).toBe(false);
  });
});

describe("isUnbilled", () => {
  it("unbilled when never billed or when the invoice it was billed on is void or cancelled", () => {
    expect(isUnbilled(null, null)).toBe(true);
    expect(isUnbilled("inv", "void")).toBe(true);
    expect(isUnbilled("inv", "cancelled")).toBe(true);
    expect(isUnbilled("inv", "draft")).toBe(false);
    expect(isUnbilled("inv", "sent")).toBe(false);
  });
});

describe("summarizeUnbilled (D2-1)", () => {
  it("2h + 1.5h billable and 0.5h non-billable at 200 = 3.5 h and 700", () => {
    const s = summarizeUnbilled(
      [entry({ minutes: 120 }), entry({ id: "b", minutes: 90 }), entry({ id: "c", minutes: 30, isBillable: false })],
      () => null,
      project
    );
    expect(s).toEqual({ unbilledHours: 3.5, unbilledAmount: 700 });
  });
  it("leaves out billed entries", () => {
    const s = summarizeUnbilled([entry({ minutes: 60, billedInvoiceId: "i", billedInvoiceStatus: "sent" }), entry({ id: "b", minutes: 60 })], () => null, project);
    expect(s).toEqual({ unbilledHours: 1, unbilledAmount: 200 });
  });
});

describe("minutesBetween", () => {
  it("rounds to the nearest minute and clamps to a day", () => {
    expect(minutesBetween(new Date("2026-09-01T10:00:00Z"), new Date("2026-09-01T10:01:29Z"))).toBe(1);
    expect(minutesBetween(new Date("2026-09-01T10:00:00Z"), new Date("2026-09-01T10:01:30Z"))).toBe(2);
    expect(minutesBetween(new Date("2026-09-01T10:00:00Z"), new Date("2026-09-03T10:00:00Z"))).toBe(1440);
    expect(minutesBetween(new Date("2026-09-01T10:00:00Z"), new Date("2026-09-01T09:00:00Z"))).toBe(0);
  });
});

describe("buildProjectInvoiceLines", () => {
  it("one line per entry (hours at the rate) and per cost (1 x amount), all tagged with the project", () => {
    const lines = buildProjectInvoiceLines({
      project,
      vatRate: 0.05,
      time: [{ ...entry({ minutes: 150, notes: "Design" }), rate: 200, taskName: "Phase 1" }],
      expenses: [{ id: "x1", description: "Courier", amountAed: 300, expenseDate: "2026-09-02" }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "item", quantity: 2.5, unitPrice: 200, vatRate: 0.05, projectId: "p1" });
    expect(lines[0].description).toContain("Phase 1");
    expect(lines[1]).toMatchObject({ quantity: 1, unitPrice: 300, vatRate: 0.05, projectId: "p1" });
  });
  it("0% VAT makes zero-rated lines", () => {
    const lines = buildProjectInvoiceLines({ project, vatRate: 0, time: [], expenses: [{ id: "x", description: "d", amountAed: 10, expenseDate: "2026-09-02" }] });
    expect(lines[0]).toMatchObject({ vatRate: 0, vatSupplyType: "zero_rated" });
  });
});

describe("profitability", () => {
  it("margin = revenue - costs, as a percentage of revenue, and the budget used", () => {
    const p = profitability({ revenue: 1500, costs: 800, hours: { total: 5, billable: 4, billed: 3, unbilled: 1 }, budgetAmount: 4000, budgetHours: 10 });
    expect(p.margin).toBe(700);
    expect(p.marginPct).toBe(46.67);
    expect(p.budget).toEqual({ amount: 4000, hours: 10, usedPct: 20, hoursUsedPct: 50 });
  });
  it("no revenue gives a null margin percentage; no budget gives a null used percentage", () => {
    const p = profitability({ revenue: 0, costs: 100, hours: { total: 0, billable: 0, billed: 0, unbilled: 0 }, budgetAmount: null, budgetHours: null });
    expect(p.margin).toBe(-100);
    expect(p.marginPct).toBeNull();
    expect(p.budget.usedPct).toBeNull();
  });
});

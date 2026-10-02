import { describe, expect, it } from "vitest";
import { normalizeVatEmirate, supplyEmirate } from "../../server/services/vat-emirate";
import { aggregateReturnSalesLines } from "../../server/services/vat-sales-lines";
import { afterVatStart } from "../../server/services/vat-autopilot.service";

const line = (invoiceId: string, quantity: number, unitPrice: number) => ({ invoiceId, quantity, unitPrice, vatRate: 0.05 });

describe("emirate of a supply", () => {
  it("normalises the seven emirates and refuses anything else", () => {
    expect(normalizeVatEmirate("Abu Dhabi")).toBe("abu_dhabi");
    expect(normalizeVatEmirate("umm-al-quwain")).toBe("umm_al_quwain");
    expect(normalizeVatEmirate("Oman")).toBeNull();
    expect(normalizeVatEmirate(null)).toBeNull();
  });
  it("falls back from the document to the company", () => {
    expect(supplyEmirate("dubai", "sharjah")).toBe("dubai");
    expect(supplyEmirate(null, "sharjah")).toBe("sharjah");
    expect(supplyEmirate("nowhere", "ajman")).toBe("ajman");
  });
});

describe("box 1 by emirate", () => {
  it("splits standard-rated supplies per document emirate and adds up to the totals", () => {
    const lines = [line("dub", 400, 33.25), line("abu", 150, 36), line("loc", 1, 1000), line("cn", -20, 33.25)];
    const emirates = new Map<string, string | null>([["dub", "dubai"], ["abu", "abu_dhabi"], ["loc", null], ["cn", "dubai"]]);
    const t = aggregateReturnSalesLines(lines, new Map(), emirates, "sharjah");
    expect(t.standardByEmirate.dubai).toEqual({ amount: 12635, vat: 631.75 });
    expect(t.standardByEmirate.abu_dhabi).toEqual({ amount: 5400, vat: 270 });
    expect(t.standardByEmirate.sharjah).toEqual({ amount: 1000, vat: 50 });
    const sum = Object.values(t.standardByEmirate).reduce((a, v) => a + (v?.amount ?? 0), 0);
    expect(sum).toBe(t.standardRatedAmount);
  });
});

describe("periods before the VAT start day", () => {
  const p = (end: string) => ({ start: new Date(end), end: new Date(`${end}T23:59:59.999Z`), dueDate: new Date(end), frequency: "quarterly" as const });
  it("drops periods that ended before the start and keeps the newest when none is left", () => {
    const periods = [p("2026-09-30"), p("2026-06-30"), p("2026-03-31")];
    expect(afterVatStart(periods, new Date("2026-07-01T00:00:00Z")).map((x) => x.end.toISOString().slice(0, 10))).toEqual(["2026-09-30"]);
    expect(afterVatStart(periods, new Date("2026-10-02T00:00:00Z")).length).toBe(1);
    expect(afterVatStart(periods, null).length).toBe(3);
  });
});

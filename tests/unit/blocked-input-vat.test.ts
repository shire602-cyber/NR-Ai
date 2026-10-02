import { describe, expect, it } from "vitest";
import { blockedInputSql, isBlockedInputCategory } from "../../server/services/blocked-input-vat";
import { totalPurchases, type PurchaseDocRow } from "../../server/services/vat-period-purchases.service";
import { assertClosingWindow } from "../../server/services/closing-guard";
import { dubaiDaySql, dubaiDayTextSql } from "../../server/services/vat-dubai-day";

const row = (over: Partial<PurchaseDocRow>): PurchaseDocRow => ({
  kind: "receipt", id: "r", date: "2026-09-18", number: null, vendor: "V", vendorTrn: null, net: "0", vat: "0", reverseCharge: false, ...over,
});

describe("blocked input VAT rule (Art. 53)", () => {
  it("treats entertainment, in any case or Arabic, as blocked and nothing else", () => {
    expect(isBlockedInputCategory("Entertainment")).toBe(true);
    expect(isBlockedInputCategory("client entertainment lunch")).toBe(true);
    expect(isBlockedInputCategory("ضيافة")).toBe(true);
    expect(isBlockedInputCategory("office")).toBe(false);
    expect(isBlockedInputCategory(null)).toBe(false);
    expect(isBlockedInputCategory(undefined)).toBe(false);
  });

  it("offers the same rule as SQL", () => {
    expect(blockedInputSql("r.category")).toContain("COALESCE(r.category, '')");
    expect(blockedInputSql("r.category")).toContain("entertain");
  });

  it("keeps a blocked document's amount AND VAT out of the box 9 totals, whatever its size", () => {
    const totals = totalPurchases([
      row({ id: "a", net: "200", vat: "10" }),
      row({ id: "b", net: "500", vat: "25", blocked: true }),
      row({ id: "c", kind: "bill", net: "400", vat: "20" }),
    ]);
    expect(totals.totalExpenses).toBe(600);
    expect(totals.inputTaxGross).toBe(30);
  });
});

describe("closing entry guard", () => {
  it("accepts a window ending on the entry date", () => {
    expect(() => assertClosingWindow({ entryYmd: "2025-12-31", fromYmd: "2025-01-01", throughYmd: "2025-12-31" })).not.toThrow();
  });
  it("refuses a closing entry that would include postings after its own date", () => {
    expect(() => assertClosingWindow({ entryYmd: "2026-09-30", fromYmd: "2026-01-01", throughYmd: "2026-10-02" })).toThrow(/cannot include postings/);
  });
  it("refuses an inverted window", () => {
    expect(() => assertClosingWindow({ entryYmd: "2026-09-30", fromYmd: "2026-10-01", throughYmd: "2026-09-30" })).toThrow();
  });
});

describe("the UAE day in SQL", () => {
  it("shifts a UTC instant by four hours before taking the date", () => {
    expect(dubaiDaySql("i.date")).toBe("((i.date) + INTERVAL '4 hours')::date");
    expect(dubaiDayTextSql("i.date")).toContain("INTERVAL '4 hours'");
  });
});

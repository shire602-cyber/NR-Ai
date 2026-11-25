import { describe, expect, it } from "vitest";
import { matchesRecurringSearch } from "../../client/src/lib/recurring-search";
import en from "../../client/src/locales/en/invoices.json";
import ar from "../../client/src/locales/ar/invoices.json";

const labels = { frequency: "Monthly", status: "Active" };

describe("recurring invoice search", () => {
  it("matches customer, frequency and status case-insensitively", () => {
    const item = { customerName: "Al Noor Trading", isActive: true };
    expect(matchesRecurringSearch(item, "", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "  noor ", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "month", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "active", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "zzz", labels)).toBe(false);
  });
  it("matches Arabic customer names", () => {
    const item = { customerName: "شركة النور", isActive: false };
    expect(matchesRecurringSearch(item, "النور", { frequency: "شهري", status: "متوقفة" })).toBe(
      true
    );
  });
});

describe("recurring invoice catalogs", () => {
  it("has every recurring key in English and Arabic, Arabic not left in English", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("invoices.recurring."));
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      const v = (ar as Record<string, string>)[k];
      expect(v, k).toBeTruthy();
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });
});

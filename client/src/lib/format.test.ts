import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, formatNumber, formatPercent, intlLocale } from "./format";

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const strip = (s: string) => s.replace(/[‎‏  ]/g, " ").replace(/\s+/g, " ").trim();

describe("formatting keeps Western digits and currency codes in both languages", () => {
  it("formats AED amounts", () => {
    expect(strip(formatCurrency(1050, "AED", "en"))).toBe("AED 1,050.00");
    const ar = strip(formatCurrency(1050, "AED", "ar"));
    expect(ar).toContain("1,050.00");
    expect(ar).toContain("AED");
    expect(ar).not.toMatch(ARABIC_INDIC);
  });

  it("never emits Arabic-Indic digits for numbers, percents and dates", () => {
    expect(formatNumber(1234567.891, "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatPercent(0.05, "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatDate("2026-09-29T00:00:00Z", "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatDate("2026-09-29T00:00:00Z", "ar")).toMatch(/2026/);
  });

  it("uses the -u-nu-latn extension for Arabic", () => {
    expect(intlLocale("ar")).toBe("ar-AE-u-nu-latn");
    expect(intlLocale("en")).toBe("en-AE");
  });
});

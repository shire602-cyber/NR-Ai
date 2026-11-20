/** Firm audit defect 18 and 12: Arabic-aware portfolio search and the cohort label in Arabic. */
import { describe, expect, it } from "vitest";
import { matchesSearchText, normalizeSearchText } from "../../shared/arabic-text";
import { localizeMonths } from "../../client/src/pages/firm/portfolio/text";

describe("matchesSearchText", () => {
  it("folds alef/hamza, yeh, teh marbuta, diacritics and the article", () => {
    expect(matchesSearchText("نور", "النور للتجارة")).toBe(true);
    expect(matchesSearchText("النور", "نور للتجارة")).toBe(true);
    expect(matchesSearchText("النُّور", "النور للتجارة")).toBe(true);
    expect(matchesSearchText("إبراهيم", "ابراهيم القابضة")).toBe(true);
    expect(matchesSearchText("مؤسسه", "مؤسسة الأمل")).toBe(true);
    expect(matchesSearchText("شركه", "شركة الأمل")).toBe(true);
    expect(matchesSearchText("مدينه", "المدينة")).toBe(true);
  });
  it("matches any of the searched fields, case-insensitively, and requires every word", () => {
    expect(
      matchesSearchText("al noor 1003", "Al Noor Trading LLC", null, null, "100300000000003")
    ).toBe(true);
    expect(matchesSearchText("noor dubai", "Al Noor Trading LLC")).toBe(false);
    expect(matchesSearchText("", "anything")).toBe(true);
    expect(matchesSearchText("x", null, undefined)).toBe(false);
  });
  it("normalises Arabic-Indic digits so a TRN typed in Arabic digits still matches", () => {
    expect(normalizeSearchText("١٠٠٣")).toBe("1003");
    expect(matchesSearchText("١٠٠٣", "100300000000003")).toBe(true);
  });
});

describe("VAT cohort label in Arabic", () => {
  it("localises Monthly, Quarterly and the annual label", () => {
    expect(localizeMonths("Monthly")).toBe("شهري");
    expect(localizeMonths("Quarterly")).toBe("ربع سنوي");
    expect(localizeMonths("Mar annual")).toBe("مارس سنويًا");
    expect(localizeMonths("Jan / Apr / Jul / Oct")).toBe("يناير / أبريل / يوليو / أكتوبر");
  });
});

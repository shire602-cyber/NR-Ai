/**
 * Step 1 / F13: the sweep's "English in Arabic mode" rule excuses only whole user-data strings,
 * never a word that happens to occur somewhere in the data, and it visits every individual report.
 */
import { describe, expect, it } from "vitest";
import { reportCatalog } from "../../client/src/lib/reportCatalog";
import { REPORT_URLS } from "../e2e/lib/report-urls.mjs";
import { collectUserStrings, englishOutsideUserData } from "../e2e/lib/sweep-checks.mjs";

const data = (...values: unknown[]) => {
  const strings = new Set<string>();
  for (const value of values) collectUserStrings(value, strings);
  return strings;
};

describe("englishOutsideUserData", () => {
  const seeded = data({ name: "Blue Palm Services LLC", description: "Monthly bookkeeping" });

  it("excuses a whole user-data string, case-insensitively, inside a sentence", () => {
    expect(englishOutsideUserData("فاتورة Blue Palm Services LLC", seeded)).toEqual([]);
    expect(englishOutsideUserData("monthly BOOKKEEPING", seeded)).toEqual([]);
  });

  it("does not excuse UI words that merely occur in the data", () => {
    // "services" and "monthly" are in the data, but these lines are UI copy.
    expect(englishOutsideUserData("Services overview", seeded)).toEqual(["services", "overview"]);
    expect(englishOutsideUserData("Monthly summary for the period", seeded)).toEqual([
      "monthly",
      "summary",
      "for",
      "the",
      "period",
    ]);
    // a data string inside a longer Latin word is not the data string
    expect(englishOutsideUserData("Unmonthly bookkeepings", seeded)).toContain("bookkeepings");
  });

  it("excuses nothing when there is no user data (the Arabic-data persona)", () => {
    expect(englishOutsideUserData("Blue Palm Services LLC", null)).toEqual([
      "blue",
      "palm",
      "services",
    ]);
    expect(englishOutsideUserData("Blue Palm", new Set())).toEqual(["blue", "palm"]);
  });

  it("keeps brand and acronym allow-listing", () => {
    expect(englishOutsideUserData("تصدير إلى Excel (VAT)", seeded)).toEqual([]);
  });
});

describe("collectUserStrings", () => {
  it("skips system chart-of-accounts English names when an Arabic name exists", () => {
    const strings = data({ nameEn: "Rent Expense", nameAr: "مصروف الإيجار", code: "5100" });
    expect(strings.has("rent expense")).toBe(false);
    // an account with no Arabic name is a user-entered English name
    expect(data({ nameEn: "Petty Float" }).has("petty float")).toBe(true);
  });

  it("skips code-like values and fields", () => {
    const strings = data({
      status: "approved",
      claimStatus: "submitted",
      source: "bill payment",
      method: "bank_reconciliation",
      category: "exempt_income",
      customerName: "Harbor Studio",
    });
    expect([...strings]).toEqual(["harbor studio"]);
  });

  it("keeps typed categories and references (they are data a person wrote)", () => {
    const strings = data({
      category: "Computers & Software",
      reference: "license pool",
      unit: "each",
    });
    expect([...strings].sort()).toEqual(["computers & software", "each", "license pool"]);
  });

  it("keeps the memo of a manual journal entry but not of a system posting", () => {
    const manual = data({ entryNumber: "JE-1", source: "manual", memo: "Monthly cash sales" });
    expect(manual.has("monthly cash sales")).toBe(true);
    const system = data({
      entryNumber: "JE-2",
      source: "invoice",
      memo: "Payment received for Invoice INV-1 - bank",
      lines: [{ memo: "Opening stock", description: "Sales Invoice INV-1 - Harbor Studio" }],
    });
    // only the entry number (a document number) is left
    expect([...system]).toEqual(["je-2"]);
  });
});

describe("every report the catalog opens is in the sweep", () => {
  it("REPORT_URLS lists each catalog entry's page", () => {
    const expected = reportCatalog
      .map((item) =>
        item.href
          ? item.href
          : item.tab
            ? `/reports?tab=${item.tab}&report=${item.id}&persona=${item.personas[0]}`
            : null
      )
      .filter((url): url is string => !!url);
    expect([...REPORT_URLS].sort()).toEqual([...expected].sort());
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchesReceiptSearch } from "../../client/src/lib/receiptSearch";

describe("matchesReceiptSearch", () => {
  const r = { merchant: "Al Futtaim Motors", category: "Fuel", amount: 125.5 };
  it("matches merchant, category and amount case-insensitively", () => {
    expect(matchesReceiptSearch(r, "futtaim")).toBe(true);
    expect(matchesReceiptSearch(r, "FUEL")).toBe(true);
    expect(matchesReceiptSearch(r, "125.5")).toBe(true);
  });
  it("returns false on no match and true on blank query", () => {
    expect(matchesReceiptSearch(r, "carrefour")).toBe(false);
    expect(matchesReceiptSearch(r, "  ")).toBe(true);
  });
  it("ignores Arabic diacritics", () => {
    expect(matchesReceiptSearch({ merchant: "مَطْعَم الشام" }, "مطعم")).toBe(true);
  });
});

describe("receipt screen copy", () => {
  const load = (l: string) =>
    JSON.parse(readFileSync(`client/src/locales/${l}/screens.json`, "utf8"));
  it("has en and ar for the new receipt keys", () => {
    for (const k of [
      "screens.receiptsSearchPlaceholder",
      "screens.receiptsNoMatchTitle",
      "screens.receiptPreviewFor",
      "screens.receiptPreviewThis",
      "screens.receiptScannedFor",
    ]) {
      expect(load("en")[k]).toBeTruthy();
      expect(load("ar")[k]).toBeTruthy();
    }
  });
  it("does not persist English placeholder merchant names from the page", () => {
    // Source check: rendering the 3k-line page needs the full app harness.
    const src = readFileSync("client/src/pages/Receipts.tsx", "utf8");
    expect(src).not.toMatch(/"Unknown Merchant"/);
    expect(src).not.toMatch(/Original scanned image for \$/);
  });
});

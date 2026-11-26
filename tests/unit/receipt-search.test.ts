import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  knownReceiptMerchant,
  matchesReceiptSearch,
  receiptCategoryLabel,
  receiptMerchantLabel,
} from "../../client/src/lib/receiptSearch";
import arPages from "../../client/src/locales/ar/pages.json";
import enPages from "../../client/src/locales/en/pages.json";
import arScreens from "../../client/src/locales/ar/screens.json";
import enScreens from "../../client/src/locales/en/screens.json";

describe("receipt merchant display label", () => {
  const ar = { ...arPages, ...arScreens };
  const placeholders = [null, undefined, "", "   ", "Unknown", "Unknown Merchant"];

  it("localizes blanks and placeholders, current and legacy", () => {
    for (const merchant of placeholders) {
      expect(knownReceiptMerchant(merchant)).toBe("");
      expect(receiptMerchantLabel(ar, merchant)).toBe(arScreens["screens.unknownMerchant"]);
      expect(receiptMerchantLabel(enScreens, merchant)).toBe("Unknown merchant");
    }
    expect(receiptMerchantLabel(ar, "Unknown Brewery")).toBe("Unknown Brewery");
  });

  it("searches the Arabic label and the raw stored value", () => {
    const query = arScreens["screens.unknownMerchant"];
    for (const merchant of placeholders) {
      expect(matchesReceiptSearch({ merchant }, query, ar)).toBe(true);
    }
    expect(matchesReceiptSearch({ merchant: "Unknown Merchant" }, "unknown merchant", ar)).toBe(
      true
    );
    expect(matchesReceiptSearch({ merchant: "Carrefour" }, query, ar)).toBe(false);
  });
});

describe("matchesReceiptSearch", () => {
  const r = { merchant: "Al Futtaim Motors", category: "Fuel", amount: 125.5 };
  it("matches merchant, category and amount case-insensitively", () => {
    expect(matchesReceiptSearch(r, "futtaim", enPages)).toBe(true);
    expect(matchesReceiptSearch(r, "FUEL", enPages)).toBe(true);
    expect(matchesReceiptSearch(r, "125.5", enPages)).toBe(true);
  });
  it("returns false on no match and true on blank query", () => {
    expect(matchesReceiptSearch(r, "carrefour", enPages)).toBe(false);
    expect(matchesReceiptSearch(r, "  ", enPages)).toBe(true);
  });
  it("ignores Arabic diacritics", () => {
    expect(matchesReceiptSearch({ merchant: "مَطْعَم الشام" }, "مطعم", arPages)).toBe(true);
  });
  it("matches an English stored category by the Arabic label displayed to users", () => {
    const receipt = { category: "Travel" };
    expect(receiptCategoryLabel(arPages, receipt.category)).toBe("السفر");
    expect(matchesReceiptSearch(receipt, "السفر", arPages)).toBe(true);
    expect(matchesReceiptSearch(receipt, "travel", arPages)).toBe(true);
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
      "screens.receiptsExportSearchScope",
    ]) {
      expect(load("en")[k]).toBeTruthy();
      expect(load("ar")[k]).toBeTruthy();
    }
  });
  it("does not use localized fallback copy in receipt data", () => {
    // Source check: rendering the 3k-line page needs the full app harness.
    const src = readFileSync("client/src/pages/Receipts.tsx", "utf8");
    expect(src).toMatch(
      /merchant: receipt\.data\.merchant\?\.trim\(\) \|\| UNKNOWN_RECEIPT_MERCHANT/
    );
    expect(src).not.toMatch(/translateNow\("screens\.unknownMerchant"\)/);
    expect(src).not.toMatch(/Original scanned image for \$/);
  });
});

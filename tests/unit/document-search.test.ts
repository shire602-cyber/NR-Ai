import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchesDocumentSearch } from "../../client/src/lib/document-search";

describe("matchesDocumentSearch", () => {
  it("matches everything for a blank query", () => {
    expect(matchesDocumentSearch("  ", "QT-1")).toBe(true);
  });
  it("matches number, party or reference case-insensitively", () => {
    expect(matchesDocumentSearch("qt-0", "QT-0012", "Acme")).toBe(true);
    expect(matchesDocumentSearch("acme", "QT-0012", "ACME Trading")).toBe(true);
    expect(matchesDocumentSearch("inv-9", "CN-1", "Acme", "INV-90")).toBe(true);
  });
  it("matches Arabic party names and ignores null fields", () => {
    expect(matchesDocumentSearch("شركة", null, "شركة النور")).toBe(true);
    expect(matchesDocumentSearch("zzz", null, undefined, "CN-1")).toBe(false);
  });
});

describe("quote / credit / debit note catalogs", () => {
  const read = (l: string) =>
    JSON.parse(readFileSync(`client/src/locales/${l}/screens.json`, "utf8")) as Record<
      string,
      string
    >;
  it("ship Arabic copy for the list search and eyebrow keys", () => {
    const en = read("en");
    const ar = read("ar");
    for (const k of [
      "screens.salesEyebrow",
      "screens.searchQuotes",
      "screens.searchCreditNotes",
      "screens.searchDebitNotes",
      "screens.noMatchingDocuments",
      "screens.noMatchingDocumentsBody",
    ]) {
      expect(en[k], k).toBeTruthy();
      expect(ar[k], k).toBeTruthy();
      expect(ar[k]).not.toBe(en[k]);
    }
  });
});

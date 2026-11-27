import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterClaims } from "../../client/src/lib/expense-claim-search";

const claims = [
  { claim_number: "EC-001", title: "Taxi to Dubai", description: null, status: "draft" },
  { claim_number: "EC-002", title: "رحلة عمل", description: "فندق", status: "submitted" },
  { claim_number: "EC-003", title: "Lunch", description: "Client meeting", status: "paid" },
];

describe("expense claim search", () => {
  it("keeps everything for a blank query", () => {
    expect(filterClaims(claims, "  ")).toHaveLength(3);
  });
  it("matches number, title, description and status case-insensitively", () => {
    expect(filterClaims(claims, "ec-002")).toHaveLength(1);
    expect(filterClaims(claims, "TAXI")[0].claim_number).toBe("EC-001");
    expect(filterClaims(claims, "meeting")[0].claim_number).toBe("EC-003");
    expect(filterClaims(claims, "submitted")[0].claim_number).toBe("EC-002");
  });
  it("matches every badge label from the Arabic catalog, including approved", () => {
    const ar: Record<string, string> = JSON.parse(
      readFileSync("client/src/locales/ar/pages.json", "utf8")
    );
    const paidLabel = "مدفوعة"; // CLAIM_COPY.ar.paid in the page
    const label = (s: string) =>
      s === "paid" ? paidLabel : s === "unknown" ? undefined : ar[`pages.${s}`];
    const rows = ["draft", "submitted", "approved", "rejected", "paid", "unknown"].map((s, i) => ({
      claim_number: `EC-${i}`,
      title: "x",
      status: s,
    }));
    for (const s of ["draft", "submitted", "approved", "rejected", "paid"]) {
      const text = label(s) as string;
      expect(text, s).toBeTruthy();
      expect(filterClaims(rows, text, label).map((r) => r.status)).toContain(s);
      // The raw submitted value still matches when the resolver is passed.
      expect(filterClaims(rows, s, label).map((r) => r.status)).toContain(s);
    }
    // Unknown status: no label, still matched by its raw value.
    expect(filterClaims(rows, "unknown", label).map((r) => r.status)).toEqual(["unknown"]);
  });
  it("matches Arabic text and returns [] when nothing matches", () => {
    expect(filterClaims(claims, "فندق")).toHaveLength(1);
    expect(filterClaims(claims, "zzz")).toEqual([]);
  });
});

describe("expense claim catalogs", () => {
  // Source-inspection: the page needs a company + API to render, so key presence is asserted on catalogs.
  const keys = [
    "screens.searchClaims",
    "screens.noMatchingClaims",
    "screens.noMatchingClaimsBody",
    "screens.claimPaymentRefPlaceholder",
  ];
  for (const lang of ["en", "ar"]) {
    it(`${lang} has the claim search and placeholder strings`, () => {
      const cat = JSON.parse(readFileSync(`client/src/locales/${lang}/screens.json`, "utf8"));
      for (const k of keys) expect(cat[k], k).toBeTruthy();
    });
  }
  it("page has no hardcoded English eyebrow or payment placeholder", () => {
    const src = readFileSync("client/src/pages/ExpenseClaims.tsx", "utf8");
    expect(src).not.toContain('eyebrow="Purchases"');
    expect(src).not.toContain("e.g., Bank transfer ref");
  });
});

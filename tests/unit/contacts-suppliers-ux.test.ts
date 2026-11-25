import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterVendors } from "../../client/src/lib/vendor-filter";

const load = (l: string) =>
  JSON.parse(readFileSync(`client/src/locales/${l}/pages.json`, "utf8")) as Record<string, string>;

const vendors = [
  {
    name: "Gulf Supplies LLC",
    nameAr: "الخليج للتوريد",
    trn: "100123456700003",
    email: "a@gulf.ae",
  },
  { name: "Noor Traders", nameAr: null, trn: null, email: "sales@noor.ae" },
];

describe("supplier search", () => {
  it("returns everything for an empty term", () => {
    expect(filterVendors(vendors, "  ")).toHaveLength(2);
  });
  it("matches name, Arabic name, TRN and email", () => {
    expect(filterVendors(vendors, "noor")).toHaveLength(1);
    expect(filterVendors(vendors, "الخليج")).toHaveLength(1);
    expect(filterVendors(vendors, "1001234")).toHaveLength(1);
    expect(filterVendors(vendors, "SALES@")).toHaveLength(1);
    expect(filterVendors(vendors, "zzz")).toHaveLength(0);
  });
});

describe("contacts and suppliers copy", () => {
  const keys = Object.keys(load("en")).filter(
    (k) => k.startsWith("pages.vendors") || k.startsWith("pages.contactsDelete")
  );
  it("has Arabic for every new key, with matching placeholders", () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const en = load("en");
    const ar = load("ar");
    for (const k of keys) {
      expect(ar[k], k).toBeTruthy();
      expect(ar[k], k).not.toBe(en[k]);
      const ph = (s: string) => (s.match(/\{(\w+)/g) ?? []).sort().join();
      expect(ph(ar[k]), k).toBe(ph(en[k]));
    }
  });
  it("covers every supplier statement type", () => {
    for (const t of ["bill", "payment", "debit_note", "credit_applied"]) {
      expect(load("ar")[`pages.vendorsStatementType.${t}`]).toBeTruthy();
    }
  });
  it("pages no longer hardcode the English strings", () => {
    // Source inspection: rendering these pages needs the full provider tree.
    const c = readFileSync("client/src/pages/CustomerContacts.tsx", "utf8");
    expect(c).not.toContain("This action cannot be undone");
    expect(c).not.toContain('"Delete all contacts"');
    const v = readFileSync("client/src/pages/Vendors.tsx", "utf8");
    expect(v).not.toContain('eyebrow="Purchases"');
  });
});

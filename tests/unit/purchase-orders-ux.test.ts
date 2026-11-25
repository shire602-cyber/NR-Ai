import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterPurchaseOrders } from "../../client/src/lib/purchase-order-filters";

const orders = [
  { number: "PO-001", vendorName: "Acme Trading", status: "draft" },
  { number: "PO-002", vendorName: "مؤسسة النور", status: "partially_received" },
  { number: "PO-003", vendorName: null, status: "sent" },
];

describe("purchase order list search", () => {
  it("returns everything for a blank query and tolerates undefined", () => {
    expect(filterPurchaseOrders(orders, "  ")).toHaveLength(3);
    expect(filterPurchaseOrders(undefined, "x")).toEqual([]);
  });
  it("matches number, vendor (Arabic too) and status", () => {
    expect(filterPurchaseOrders(orders, "po-002").map((o) => o.number)).toEqual(["PO-002"]);
    expect(filterPurchaseOrders(orders, "acme")).toHaveLength(1);
    expect(filterPurchaseOrders(orders, "النور")).toHaveLength(1);
    expect(filterPurchaseOrders(orders, "partially received")).toHaveLength(1);
  });
  it("returns nothing for an unknown term", () => {
    expect(filterPurchaseOrders(orders, "zzz")).toEqual([]);
  });
});

describe("purchase order locale keys", () => {
  for (const key of ["poSearch", "poNoMatch", "poNoMatchBody", "eyebrow"]) {
    it(`purchases.${key} exists in en and ar`, () => {
      for (const loc of ["en", "ar"]) {
        const c = JSON.parse(
          readFileSync(`client/src/locales/${loc}/purchases.json`, "utf8")
        ) as Record<string, string>;
        expect(c[`purchases.${key}`]).toBeTruthy();
      }
    });
  }
});

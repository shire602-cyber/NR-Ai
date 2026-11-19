/**
 * S8 final sweep (unit): R07-15 invoice-form margin-scheme totals match the server engine;
 * W5-A object-storage deletion helpers (strict delete + retry backoff).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  computeInvoiceFormLine,
  computeInvoiceFormTotals,
  lineVatRate,
} from "../../client/src/lib/invoice-totals";
import { computeSalesDocument } from "../../server/services/document-totals.service";
import {
  __setObjectStoreForTests,
  deleteObject,
  deleteObjectOrThrow,
} from "../../server/services/fileStorage";
import { objectDeletionBackoffMinutes } from "../../server/services/object-deletion-queue";

describe("[S8][R07-15] invoice-form margin-scheme totals", () => {
  it("charges VAT on the margin only, price VAT-inclusive", () => {
    // Price 1,050.00, cost 840.00 -> margin 210.00, VAT = 210 x 5/105 = 10.00.
    const l = computeInvoiceFormLine({
      quantity: 1,
      unitPrice: 1050,
      vatSupplyType: "standard_rated",
      marginScheme: true,
      marginPurchaseCost: 840,
    });
    expect(l).toMatchObject({ vatFils: 1000, netFils: 104000, marginFils: 20000, lineTotal: 1050 });
    // Sold below cost: no VAT, the whole price is net.
    const loss = computeInvoiceFormLine({
      quantity: 1,
      unitPrice: 500,
      marginScheme: true,
      marginPurchaseCost: 800,
    });
    expect(loss).toMatchObject({ vatFils: 0, netFils: 50000, marginFils: 0 });
  });

  it("matches the server engine to the fil for mixed margin / normal lines", () => {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const types = ["standard_rated", "zero_rated", "exempt"] as const;
    for (const rate of [0.05]) {
      for (let round = 0; round < 200; round++) {
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
          const vatSupplyType = types[Math.floor(rnd() * types.length)];
          const marginScheme = vatSupplyType === "standard_rated" && rnd() < 0.5;
          return {
            quantity: Number((Math.round(rnd() * 1000) / 100 + 0.01).toFixed(2)),
            unitPrice: Number((Math.round(rnd() * 1_000_000) / 100 + 0.01).toFixed(2)),
            vatSupplyType,
            discountPercent: rnd() < 0.4 ? Math.round(rnd() * 5000) / 100 : 0,
            marginScheme,
            marginPurchaseCost: marginScheme
              ? Number((Math.round(rnd() * 2_000_000) / 100).toFixed(2))
              : 0,
          };
        });
        const client = computeInvoiceFormTotals(lines, rate);
        const server = computeSalesDocument(
          lines.map((l) => ({
            quantity: l.quantity,
            unitPriceFils: Math.round(l.unitPrice * 100),
            vatRate: lineVatRate(l.vatSupplyType, rate),
            vatSupplyType: l.vatSupplyType,
            discountType: l.discountPercent ? "percent" : null,
            discountValue: l.discountPercent || null,
            ...(l.marginScheme
              ? { marginScheme: true, marginCostFils: Math.round(l.marginPurchaseCost * 100) }
              : {}),
          })),
          { resolve: true }
        );
        const msg = JSON.stringify({ rate, lines });
        expect(client.subtotalFils, msg).toBe(server.subtotalFils);
        expect(client.vatFils, msg).toBe(server.vatFils);
        expect(client.totalFils, msg).toBe(server.totalFils);
        client.lines.forEach((cl, i) => {
          expect(cl.marginFils, msg).toBe(server.lines[i].marginFils);
        });
      }
    }
  });
});

describe("[S8][W5-A] object-storage deletion helpers", () => {
  afterEach(() => __setObjectStoreForTests(null));

  it("deleteObjectOrThrow surfaces backend failures; deleteObject swallows them", async () => {
    const deleted: string[] = [];
    let fail = true;
    __setObjectStoreForTests({
      put: async (k) => k,
      get: async () => null,
      del: async (k) => {
        if (fail) throw new Error("bucket unavailable");
        deleted.push(k);
      },
    });
    const key = "report-artifacts/x_y_file.pdf";
    await expect(deleteObjectOrThrow(key)).rejects.toThrow("bucket unavailable");
    await expect(deleteObject(key)).resolves.toBeUndefined();
    fail = false;
    await deleteObjectOrThrow(key);
    expect(deleted).toEqual([key]);
    // A forged reference outside the allowed prefixes is never sent to the backend.
    await deleteObjectOrThrow("../../etc/passwd");
    expect(deleted).toEqual([key]);
  });

  it("backs off exponentially, capped at one day", () => {
    expect([1, 2, 3, 4].map(objectDeletionBackoffMinutes)).toEqual([1, 2, 4, 8]);
    expect(objectDeletionBackoffMinutes(30)).toBe(24 * 60);
  });
});

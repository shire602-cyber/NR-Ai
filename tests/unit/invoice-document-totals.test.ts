/**
 * R03-07 / R03-20 / R03-12: one fils-exact totals function for every sales document.
 */
import { describe, expect, it } from "vitest";
import { computeSalesDocument } from "../../server/services/document-totals.service";
import {
  dueDateFromTerms,
  prepareSalesLines,
  termsFromDays,
} from "../../server/services/invoice-lifecycle";
import { createInvoiceSchema, salesLineInputSchema } from "../../shared/validators/invoices";
import { invoiceMachine, settlementStatus } from "../../server/services/invoice-state-machine";

describe("computeSalesDocument [R03-07][R03-20]", () => {
  it("applies a 10% document discount pro-rata and rounds VAT once", () => {
    const t = computeSalesDocument(
      [
        { quantity: 1, unitPriceFils: 33_333, vatRate: 0.05 },
        { quantity: 2, unitPriceFils: 10_001, vatRate: 0.05 },
      ],
      { discountType: "percent", discountValue: 10, resolve: true }
    );
    expect(t.grossFils).toBe(53_335);
    expect(t.documentDiscountFils).toBe(5_334);
    expect(t.lines.reduce((s, l) => s + l.documentDiscountFils, 0)).toBe(5_334);
    expect(t.subtotalFils).toBe(48_001);
    expect(t.vatFils).toBe(2_400);
    expect(t.totalFils).toBe(t.subtotalFils + t.vatFils);
  });

  it("line amount discount ≤ gross; discount above the amount is refused", () => {
    const ok = computeSalesDocument(
      [
        {
          quantity: 1,
          unitPriceFils: 20_000,
          vatRate: 0.05,
          discountType: "amount",
          discountValue: 50,
        },
      ],
      { resolve: true }
    );
    expect(ok.subtotalFils).toBe(15_000);
    expect(ok.vatFils).toBe(750);
    expect(() =>
      computeSalesDocument(
        [
          {
            quantity: 1,
            unitPriceFils: 100,
            vatRate: 0.05,
            discountType: "amount",
            discountValue: 5,
          },
        ],
        { resolve: true }
      )
    ).toThrow(/cannot exceed/);
  });

  it("splits zero-rated / exempt / out-of-scope lines by revenue role and charges no VAT on them", () => {
    const t = computeSalesDocument(
      [
        { quantity: 1, unitPriceFils: 100_000, vatRate: 0.05 },
        { quantity: 1, unitPriceFils: 50_000, vatRate: 0, vatSupplyType: "zero_rated" },
        { quantity: 1, unitPriceFils: 25_000, vatRate: 0, vatSupplyType: "exempt" },
        { quantity: 1, unitPriceFils: 10_000, vatRate: 0, vatSupplyType: "out_of_scope" },
      ],
      { resolve: true }
    );
    expect(t.lines.map((l) => l.classification.revenueAccountRole)).toEqual([
      "standard_sales",
      "zero_rated_sales",
      "exempt_sales",
      "out_of_scope_revenue",
    ]);
    expect(t.vatFils).toBe(5_000);
    expect(t.totalFils).toBe(190_000);
  });

  it("prepareSalesLines turns a missing 0% supply type into a 400 SUPPLY_TYPE_REQUIRED", () => {
    try {
      prepareSalesLines([{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0 }]);
      throw new Error("expected failure");
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      expect(err.code).toBe("SUPPLY_TYPE_REQUIRED");
      expect(err.statusCode).toBe(400);
    }
  });
});

describe("sales validators [R03-02][R03-07]", () => {
  it("rejects unknown line fields and server-owned header fields", () => {
    expect(
      salesLineInputSchema.safeParse({ description: "x", quantity: 1, unitPrice: 1, discount: 10 })
        .success
    ).toBe(false);
    const base = {
      customerName: "A",
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "x", quantity: 1, unitPrice: 1 }],
    };
    expect(createInvoiceSchema.safeParse(base).success).toBe(true);
    for (const k of [
      "status",
      "total",
      "subtotal",
      "vatAmount",
      "journalEntryId",
      "baseCurrencyAmount",
    ]) {
      expect(createInvoiceSchema.safeParse({ ...base, [k]: 1 }).success, k).toBe(false);
    }
    expect(
      createInvoiceSchema.safeParse({ ...base, discountType: "percent", discountValue: 120 })
        .success
    ).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, discountType: "percent" }).success).toBe(false);
  });
});

describe("terms and settlement [R03-10][R03-13]", () => {
  it("computes due dates from payment terms", () => {
    expect(dueDateFromTerms("2026-01-31", "net30")).toBe("2026-03-02");
    expect(dueDateFromTerms("2026-01-31", "due_on_receipt")).toBe("2026-01-31");
    expect(dueDateFromTerms("2026-01-31", "custom")).toBeNull();
    expect(termsFromDays(30)).toBe("net30");
    expect(termsFromDays(0)).toBe("due_on_receipt");
  });

  it("settlement status and machine never let paid be set from draft", () => {
    expect(invoiceMachine.can("draft", "paid")).toBe(false);
    expect(invoiceMachine.can("sent", "paid")).toBe(true);
    expect(invoiceMachine.can("void", "sent")).toBe(false);
    expect(settlementStatus("sent", 1000, 1000)).toBe("paid");
    expect(settlementStatus("paid", 1000, 400)).toBe("partial");
    expect(settlementStatus("partial", 1000, 0)).toBe("sent");
    expect(settlementStatus("draft", 1000, 1000)).toBe("draft");
  });
});

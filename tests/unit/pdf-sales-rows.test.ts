import { describe, expect, it } from "vitest";
import { advanceTitles, buildPdfRows } from "../../server/services/pdf-sales-rows";
import { checkRequestedQuantities, orderStatuses } from "../../server/services/sales-order.service";

describe("buildPdfRows", () => {
  const lines = [
    { id: "i1", description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, lineKind: "item", discountType: "percent", discountValue: 10 },
    { id: "d1", description: "Discount: Consulting", quantity: 1, unitPrice: -100, vatRate: 0.05, lineKind: "discount", parentLineId: "i1" },
    { id: "d2", description: "Discount", quantity: 1, unitPrice: -50, vatRate: 0.05, lineKind: "discount" },
    { id: "s1", description: "Delivery", quantity: 1, unitPrice: 100, vatRate: 0.05, lineKind: "shipping" },
    { id: "a1", description: "Less advance ADV-1 (INV-1)", quantity: 1, unitPrice: -200, vatRate: 0.05, lineKind: "advance" },
  ];
  it("folds a line discount into its item, collapses document discounts, keeps shipping and advances as rows", () => {
    const rows = buildPdfRows(lines as any);
    expect(rows.map((r) => r.kind)).toEqual(["item", "discount", "shipping", "advance"]);
    expect(rows[0]).toMatchObject({ amount: 900, discountLabel: "10%", quantity: 1, unitPrice: 1000 });
    expect(rows[1]).toMatchObject({ amount: -50, quantity: null });
    expect(rows[2]).toMatchObject({ amount: 100 });
    expect(rows[3]).toMatchObject({ amount: -200, description: "Less advance ADV-1 (INV-1)" });
  });
  it("the printed amounts add up to the document subtotal", () => {
    const sum = buildPdfRows(lines as any).reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(1000 - 100 - 50 + 100 - 200);
  });
  it("legacy lines without a kind print as items", () => {
    expect(buildPdfRows([{ description: "x", quantity: 2, unitPrice: 10, vatRate: 0.05 }] as any)).toEqual([
      { kind: "item", description: "x", quantity: 2, unitPrice: 10, discountLabel: null, vatRate: 0.05, amount: 20 },
    ]);
  });
  it("an amount discount shows its amount in the Disc. column", () => {
    const rows = buildPdfRows([
      { id: "i", description: "A", quantity: 1, unitPrice: 500, vatRate: 0.05, lineKind: "item", discountType: "amount", discountValue: 75 },
      { id: "d", description: "Discount: A", quantity: 1, unitPrice: -75, vatRate: 0.05, lineKind: "discount", parentLineId: "i" },
    ] as any);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ discountLabel: "75.00", amount: 425 });
  });
});

describe("advanceTitles", () => {
  it("titles an advance tax invoice and a deposit receipt, nothing for ordinary invoices", () => {
    expect(advanceTitles("advance", [{ vatSupplyType: "standard_rated" }])?.en).toBe("ADVANCE TAX INVOICE");
    expect(advanceTitles("advance", [{ vatSupplyType: "zero_rated" }])?.en).toBe("ADVANCE TAX INVOICE");
    expect(advanceTitles("advance", [{ vatSupplyType: "out_of_scope" }])?.en).toBe("DEPOSIT RECEIPT");
    expect(advanceTitles("invoice", [])).toBeNull();
  });
});

describe("sales order quantities", () => {
  const q = (ordered: number, invoiced: number, delivered = 0) => ({ ordered, invoiced, delivered });
  it("status is derived from billable lines: not, partially, fully invoiced", () => {
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 0) }]).invoicingStatus).toBe("not_invoiced");
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 4) }]).invoicingStatus).toBe("partially_invoiced");
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 10) }]).invoicingStatus).toBe("invoiced");
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 10) }, { lineKind: "shipping", quantities: q(1, 0) }]).invoicingStatus).toBe("partially_invoiced");
  });
  it("delivery status looks at items only", () => {
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 0, 10) }, { lineKind: "shipping", quantities: q(1, 0, 0) }]).deliveryStatus).toBe("delivered");
    expect(orderStatuses([{ lineKind: "item", quantities: q(10, 0, 3) }]).deliveryStatus).toBe("partially_delivered");
  });
  it("a request above what is left is SO_QTY_EXCEEDED; a foreign line is a mismatch", () => {
    const map = new Map([["L1", q(10, 4)]]);
    expect(checkRequestedQuantities(map, [{ salesOrderLineId: "L1", quantity: 6 }])).toEqual({ ok: true });
    expect(checkRequestedQuantities(map, [{ salesOrderLineId: "L1", quantity: 6.5 }])).toMatchObject({ ok: false, code: "SO_QTY_EXCEEDED" });
    expect(checkRequestedQuantities(map, [{ salesOrderLineId: "L1", quantity: 3 }, { salesOrderLineId: "L1", quantity: 4 }])).toMatchObject({ ok: false, code: "SO_QTY_EXCEEDED" });
    expect(checkRequestedQuantities(map, [{ salesOrderLineId: "other", quantity: 1 }])).toMatchObject({ ok: false, code: "SALES_ORDER_LINE_MISMATCH" });
  });
});

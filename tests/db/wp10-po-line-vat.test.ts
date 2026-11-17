/**
 * WP10 (code audit §2.5): purchase-order totals used `vatRate > 0 ? net * 0.05 : 0`,
 * so a line's supply type was ignored (an exempt / zero-rated / out-of-scope line with
 * the rate left out was charged 5%). Totals now come per line, in integer fils, from
 * the same purchase calculator the converted bill uses, and the PO, its stored lines
 * and the bill it converts into agree to the fil.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const poUrl = (t: Tenant) => `/api/companies/${t.company.id}/purchase-orders`;

const MIXED = [
  { description: "Standard", quantity: 2, unitPrice: 100.5, vatRate: 5 }, // 201.00 + 10.05
  { description: "Zero by rate", quantity: 1, unitPrice: 300, vatRate: 0 }, // 300.00 + 0
  { description: "Exempt, rate omitted", quantity: 1, unitPrice: 400, vatSupplyType: "exempt" },
  {
    description: "Zero-rated, rate omitted",
    quantity: 3,
    unitPrice: 10.01,
    vatSupplyType: "zero_rated",
  }, // 30.03 + 0
  {
    description: "Out of scope, 0%",
    quantity: 1,
    unitPrice: 50,
    vatRate: 0,
    vatSupplyType: "out_of_scope",
  },
  { description: "Standard, rate omitted", quantity: 1, unitPrice: 0.3 }, // 0.30 + 0.015 -> 0.02
];

describe("WP10 purchase-order VAT per line", () => {
  it("WP10: 0% / exempt / zero-rated / out-of-scope lines carry no VAT; 5% lines do", async () => {
    const t = await h.createTenant();
    const po = await t.as.post(poUrl(t), {
      vendorName: "Acme Supplies",
      date: "2026-01-15",
      lines: MIXED,
    });
    expect(po.status, po.text).toBe(201);
    // Subtotal 201 + 300 + 400 + 30.03 + 50 + 0.30 = 981.33; VAT only on the two
    // standard lines: 10.05 + 0.02 (0.015 rounded half-up per line) = 10.07.
    expect(Number(po.body.subtotal)).toBe(981.33);
    expect(Number(po.body.vatAmount)).toBe(10.07);
    expect(Number(po.body.total)).toBe(991.4);

    const lines = await h.sql<{ description: string; vat_rate: string; vat_supply_type: string }>(
      `SELECT description, vat_rate::text, vat_supply_type FROM purchase_order_lines
        WHERE purchase_order_id = $1 ORDER BY description`,
      [po.body.id]
    );
    const byName = Object.fromEntries(
      lines.map((l) => [l.description, [Number(l.vat_rate), l.vat_supply_type]])
    );
    expect(byName).toEqual({
      Standard: [0.05, "standard_rated"],
      "Zero by rate": [0, "zero_rated"],
      "Exempt, rate omitted": [0, "exempt"],
      "Zero-rated, rate omitted": [0, "zero_rated"],
      "Out of scope, 0%": [0, "out_of_scope"],
      "Standard, rate omitted": [0.05, "standard_rated"],
    });

    // The bill converted from the PO carries the same totals.
    expect((await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {})).status).toBe(200);
    const conv = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {
      billDate: "2026-01-21",
    });
    expect(conv.status, conv.text).toBe(201);
    expect(Number(conv.body.bill.subtotal)).toBe(981.33);
    expect(Number(conv.body.bill.vat_amount)).toBe(10.07);
    expect(Number(conv.body.bill.total_amount)).toBe(991.4);
  });

  it("WP10: an all-exempt PO has 0 VAT, and PUT recomputes per line", async () => {
    const t = await h.createTenant();
    const po = await t.as.post(poUrl(t), {
      vendorName: "Acme Supplies",
      date: "2026-01-15",
      lines: [{ description: "Rent", quantity: 1, unitPrice: 1000, vatSupplyType: "exempt" }],
    });
    expect(po.status, po.text).toBe(201);
    expect(Number(po.body.vatAmount)).toBe(0);
    expect(Number(po.body.total)).toBe(1000);

    const put = await t.as.put(`/api/purchase-orders/${po.body.id}`, {
      lines: [
        { description: "Rent", quantity: 1, unitPrice: 1000, vatSupplyType: "exempt" },
        { description: "Service", quantity: 1, unitPrice: 200, vatRate: 5 },
      ],
    });
    expect(put.status, put.text).toBe(200);
    expect(Number(put.body.subtotal)).toBe(1200);
    expect(Number(put.body.vatAmount)).toBe(10);
    expect(Number(put.body.total)).toBe(1210);
  });

  it("WP10: a zero-VAT supply type sent with an explicit 5% is a 400, not a silent 5%", async () => {
    const t = await h.createTenant();
    const bad = await t.as.post(poUrl(t), {
      vendorName: "Acme Supplies",
      date: "2026-01-15",
      lines: [
        { description: "x", quantity: 1, unitPrice: 100, vatRate: 5, vatSupplyType: "exempt" },
      ],
    });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.code).toBe("VAT_RATE_SUPPLY_MISMATCH");
  });
});

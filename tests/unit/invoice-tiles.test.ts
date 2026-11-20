import { describe, expect, it } from "vitest";
import { computeInvoiceTiles } from "../../client/src/lib/invoice-tiles";
import type { InvoiceListItem } from "../../shared/invoice-balance";

const inv = (o: Record<string, unknown>) => o as unknown as InvoiceListItem;
const today = new Date("2026-11-15T00:00:00Z");

describe("computeInvoiceTiles", () => {
  const rows = [
    inv({
      status: "partial",
      total: 5250,
      baseCurrencyAmount: 5250,
      openBalanceBase: 4250,
      dueDate: "2026-10-16",
    }),
    inv({
      status: "sent",
      total: 1000,
      baseCurrencyAmount: 3670,
      openBalanceBase: 2202,
      dueDate: "2026-12-10",
    }),
    inv({
      status: "sent",
      total: 100,
      baseCurrencyAmount: 100,
      openBalanceBase: 0,
      dueDate: "2026-10-01",
    }),
    inv({ status: "draft", total: 9450, baseCurrencyAmount: 9450, openBalanceBase: 0 }),
    inv({ status: "paid", total: 300, baseCurrencyAmount: 300, openBalanceBase: 0 }),
    inv({ status: "sent", total: -50, baseCurrencyAmount: -50, openBalanceBase: 0 }),
  ];
  const tile = (k: string) => computeInvoiceTiles(rows, today).find((x) => x.key === k)!;

  it("Open and Overdue sum remaining base balance, not document totals", () => {
    expect(tile("open")).toMatchObject({ count: 2, value: 6452 });
    expect(tile("overdue")).toMatchObject({ count: 1, value: 4250 });
  });

  it("Draft and Paid keep document totals in base currency", () => {
    expect(tile("draft")).toMatchObject({ count: 1, value: 9450 });
    expect(tile("paid")).toMatchObject({ count: 1, value: 300 });
  });

  it("missing balance fields never fall back to the document total", () => {
    const t = computeInvoiceTiles(
      [inv({ status: "sent", total: 500, dueDate: "2026-01-01" })],
      today
    );
    expect(t.find((x) => x.key === "open")).toMatchObject({ count: 0, value: 0 });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildVendorCreditLines,
  computeCreditTotals,
  nextVendorCreditNumber,
  remainingApplicable,
} from "../../server/services/vendor-credit-posting";

const accts = { apId: "ap", inputVatId: "in", outputVatId: "out" };
const sum = (rows: Array<{ debit: number; credit: number }>, k: "debit" | "credit") =>
  Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;

describe("computeCreditTotals", () => {
  it("adds VAT to the total for an ordinary credit", () => {
    const t = computeCreditTotals([{ unit_price: 200, quantity: 1, vat_rate: 5 }], false);
    expect(t.subtotal).toBe("200.00");
    expect(t.vatAmount).toBe("10.00");
    expect(t.total).toBe("210.00");
  });

  it("excludes VAT from the total under reverse charge (vendor charged none)", () => {
    const t = computeCreditTotals([{ unit_price: 200, quantity: 1, vat_rate: 5 }], true);
    expect(t.total).toBe("200.00");
    expect(t.vatAmount).toBe("10.00");
  });

  it("honours zero-rated lines", () => {
    const t = computeCreditTotals(
      [
        { unit_price: 100, quantity: 2, vat_rate: 0 },
        { unit_price: 50, quantity: 1, vat_rate: 5 },
      ],
      false
    );
    expect(t.subtotal).toBe("250.00");
    expect(t.vatAmount).toBe("2.50");
    expect(t.total).toBe("252.50");
  });
});

describe("buildVendorCreditLines", () => {
  it("reverses an ordinary bill: Dr A/P total, Cr expense net, Cr input VAT", () => {
    const rows = buildVendorCreditLines({
      lines: [{ accountId: "exp", amount: 200, description: "Goods" }],
      vatAmount: 10,
      fxRate: 1,
      reverseCharge: false,
      accounts: accts,
      ref: "VCN-0001",
      vendorName: "Acme",
    });
    expect(rows.find((r) => r.accountId === "ap")).toMatchObject({ debit: 210, credit: 0 });
    expect(rows.find((r) => r.accountId === "exp")).toMatchObject({ debit: 0, credit: 200 });
    expect(rows.find((r) => r.accountId === "in")).toMatchObject({ debit: 0, credit: 10 });
    expect(sum(rows, "debit")).toBe(sum(rows, "credit"));
  });

  it("mirrors reverse charge in reverse: Dr output VAT, Cr input VAT, Dr A/P net", () => {
    const rows = buildVendorCreditLines({
      lines: [{ accountId: "exp", amount: 200, description: "Import" }],
      vatAmount: 10,
      fxRate: 1,
      reverseCharge: true,
      accounts: accts,
      ref: "VCN-0002",
      vendorName: "Acme",
    });
    expect(rows.find((r) => r.accountId === "ap")).toMatchObject({ debit: 200, credit: 0 });
    expect(rows.find((r) => r.accountId === "out")).toMatchObject({ debit: 10, credit: 0 });
    expect(rows.find((r) => r.accountId === "in")).toMatchObject({ debit: 0, credit: 10 });
    expect(rows.find((r) => r.accountId === "exp")).toMatchObject({ credit: 200 });
    expect(sum(rows, "debit")).toBe(sum(rows, "credit"));
  });

  it("converts at the exchange rate and stays balanced after per-line rounding", () => {
    const rows = buildVendorCreditLines({
      lines: [
        { accountId: "e1", amount: 33.33, description: "a" },
        { accountId: "e2", amount: 33.33, description: "b" },
        { accountId: "e3", amount: 33.34, description: "c" },
      ],
      vatAmount: 5,
      fxRate: 3.6725,
      reverseCharge: false,
      accounts: accts,
      ref: "VCN-0003",
      vendorName: "Acme",
    });
    expect(sum(rows, "debit")).toBe(sum(rows, "credit"));
    expect(rows.find((r) => r.accountId === "in")!.credit).toBe(18.36);
  });

  it("omits the VAT leg when there is no VAT", () => {
    const rows = buildVendorCreditLines({
      lines: [{ accountId: "exp", amount: 100, description: "x" }],
      vatAmount: 0,
      fxRate: 1,
      reverseCharge: false,
      accounts: accts,
      ref: "r",
      vendorName: "v",
    });
    expect(rows).toHaveLength(2);
  });
});

describe("remainingApplicable", () => {
  it("is the smaller of credit remaining and bill due", () => {
    expect(remainingApplicable("50.00", "120.00")).toBe("50.00");
    expect(remainingApplicable("500.00", "120.00")).toBe("120.00");
    expect(remainingApplicable("0", "120.00")).toBe("0.00");
  });
});

describe("nextVendorCreditNumber", () => {
  it("starts at VCN-0001 and increments the highest existing number", () => {
    expect(nextVendorCreditNumber(null)).toBe("VCN-0001");
    expect(nextVendorCreditNumber("VCN-0009")).toBe("VCN-0010");
    expect(nextVendorCreditNumber("VCN-12345")).toBe("VCN-12346");
  });
});

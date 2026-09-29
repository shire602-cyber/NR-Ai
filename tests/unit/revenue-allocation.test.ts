import { describe, it, expect } from "vitest";
import {
  allocateRevenueCredits,
  validateRevenueAccounts,
  buildRevenueCreditLines,
} from "../../server/services/revenue-allocation.service";
import { buildReversalLines } from "../../server/services/invoice-lifecycle";

const DEFAULT = "acc-4010";
const ZERO = "acc-4060";
const SERVICE = "acc-4020";
const OTHER = "acc-4030";

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("allocateRevenueCredits", () => {
  it("keeps today's behaviour when no line has a revenue account", () => {
    const r = allocateRevenueCredits({
      lines: [
        { quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { quantity: 2, unitPrice: 50, vatRate: 0 },
      ],
      rate: 1,
      subtotal: 200,
      defaultAccountId: DEFAULT,
      zeroRatedAccountId: ZERO,
    });
    expect(r).toEqual([
      { accountId: DEFAULT, amount: 100 },
      { accountId: ZERO, amount: 100 },
    ]);
  });

  it("credits the default account for a document that has a subtotal but no lines", () => {
    expect(
      allocateRevenueCredits({ lines: [], rate: 1, subtotal: 250, defaultAccountId: DEFAULT })
    ).toEqual([{ accountId: DEFAULT, amount: 250 }]);
  });

  it("falls back to the default account for zero-rated lines when there is no zero-rated account", () => {
    const r = allocateRevenueCredits({
      lines: [{ quantity: 1, unitPrice: 100, vatRate: 0 }],
      rate: 1,
      subtotal: 100,
      defaultAccountId: DEFAULT,
    });
    expect(r).toEqual([{ accountId: DEFAULT, amount: 100 }]);
  });

  it("mixed lines: two chosen accounts + one default -> three credits summing to the net total", () => {
    const r = allocateRevenueCredits({
      lines: [
        { quantity: 1, unitPrice: 1000, vatRate: 0.05, revenueAccountId: SERVICE },
        { quantity: 3, unitPrice: 200, vatRate: 0.05, revenueAccountId: OTHER },
        { quantity: 2, unitPrice: 50.5, vatRate: 0.05 },
      ],
      rate: 1,
      subtotal: 1701,
      defaultAccountId: DEFAULT,
      zeroRatedAccountId: ZERO,
    });
    expect(r).toHaveLength(3);
    expect(r).toContainEqual({ accountId: SERVICE, amount: 1000 });
    expect(r).toContainEqual({ accountId: OTHER, amount: 600 });
    expect(r).toContainEqual({ accountId: DEFAULT, amount: 101 });
    expect(sum(r.map((x) => x.amount))).toBe(1701);
  });

  it("groups several lines that share one chosen account", () => {
    const r = allocateRevenueCredits({
      lines: [
        { quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE },
        { quantity: 1, unitPrice: 250, vatRate: 0, revenueAccountId: SERVICE },
      ],
      rate: 1,
      subtotal: 350,
      defaultAccountId: DEFAULT,
      zeroRatedAccountId: ZERO,
    });
    // An explicit choice beats the zero-rated split.
    expect(r).toEqual([{ accountId: SERVICE, amount: 350 }]);
  });

  it("converts to AED at the document rate and still sums exactly to the AED subtotal", () => {
    const r = allocateRevenueCredits({
      lines: [
        { quantity: 1, unitPrice: 33.333333, vatRate: 0.05, revenueAccountId: SERVICE },
        { quantity: 1, unitPrice: 33.333333, vatRate: 0.05 },
        { quantity: 1, unitPrice: 33.333333, vatRate: 0.05, revenueAccountId: OTHER },
      ],
      rate: 3.6725,
      subtotal: 367.25, // round2(99.999999 * 3.6725)
      defaultAccountId: DEFAULT,
    });
    expect(sum(r.map((x) => x.amount))).toBe(367.25);
    expect(r).toHaveLength(3);
  });

  it("assigns a rounding residual to the default group, never dropping a fils", () => {
    const r = allocateRevenueCredits({
      lines: [
        { quantity: 1, unitPrice: 0.335, vatRate: 0.05, revenueAccountId: SERVICE },
        { quantity: 1, unitPrice: 0.335, vatRate: 0.05 },
      ],
      rate: 1,
      subtotal: 0.67,
      defaultAccountId: DEFAULT,
    });
    expect(sum(r.map((x) => x.amount))).toBe(0.67);
  });
});

describe("buildRevenueCreditLines / reversal balance", () => {
  it("posting legs (Dr A/R, Cr revenue groups, Cr VAT) balance", () => {
    const alloc = [
      { accountId: SERVICE, amount: 1000 },
      { accountId: OTHER, amount: 600 },
      { accountId: DEFAULT, amount: 101 },
    ];
    const credits = buildRevenueCreditLines(alloc, {
      defaultAccountId: DEFAULT,
      zeroRatedAccountId: ZERO,
      invoiceNumber: "INV-1",
    });
    expect(credits).toHaveLength(3);
    const vat = 85.05;
    const arDebit = 1701 + vat;
    expect(sum([...credits.map((c) => c.credit), vat])).toBe(sum([arDebit]));
    expect(credits.find((c) => c.accountId === DEFAULT)?.description).toContain("Sales revenue");
  });

  it("the reversal debits the SAME accounts and stays balanced", () => {
    const built = buildReversalLines({
      amounts: { subtotal: 1701, vatAmount: 85.05, total: 1786.05 },
      accounts: { accountsReceivableId: "ar", salesRevenueId: DEFAULT, vatPayableId: "vat" },
      revenueSplit: [
        { accountId: SERVICE, amount: 1000 },
        { accountId: OTHER, amount: 600 },
        { accountId: DEFAULT, amount: 101 },
      ],
      labels: { revenue: "Reverse revenue", vat: "Reverse VAT", ar: "Reduce A/R" },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const debits = built.lines.filter((l) => l.debit > 0).map((l) => l.accountId);
    expect(debits).toEqual(expect.arrayContaining([SERVICE, OTHER, DEFAULT, "vat"]));
    expect(sum(built.lines.map((l) => l.debit))).toBe(sum(built.lines.map((l) => l.credit)));
  });

  it("a reversal without a split behaves exactly as before", () => {
    const built = buildReversalLines({
      amounts: { subtotal: 100, vatAmount: 5, total: 105 },
      accounts: { accountsReceivableId: "ar", salesRevenueId: DEFAULT, vatPayableId: "vat" },
      labels: { revenue: "r", vat: "v", ar: "a" },
    });
    expect(built.ok && built.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [DEFAULT, 100, 0],
      ["vat", 5, 0],
      ["ar", 0, 105],
    ]);
  });

  it("rejects a split that does not add up to the subtotal", () => {
    const built = buildReversalLines({
      amounts: { subtotal: 100, vatAmount: 5, total: 105 },
      accounts: { accountsReceivableId: "ar", salesRevenueId: DEFAULT, vatPayableId: "vat" },
      revenueSplit: [{ accountId: SERVICE, amount: 90 }],
      labels: { revenue: "r", vat: "v", ar: "a" },
    });
    expect(built.ok).toBe(false);
  });
});

describe("validateRevenueAccounts", () => {
  const chart = [
    { id: "inc-1", type: "income", isActive: true },
    { id: "inc-off", type: "income", isActive: false },
    { id: "exp-1", type: "expense", isActive: true },
    { id: "ast-1", type: "asset", isActive: true },
  ];

  it("accepts income accounts of the company and ignores blanks", () => {
    expect(validateRevenueAccounts(chart, ["inc-1", null, undefined, ""]).ok).toBe(true);
  });

  it("rejects an account from another company (not in the company chart)", () => {
    const r = validateRevenueAccounts(chart, ["foreign-uuid"]);
    expect(r).toMatchObject({ ok: false, code: "INVALID_REVENUE_ACCOUNT" });
  });

  it("rejects a non-income account", () => {
    expect(validateRevenueAccounts(chart, ["exp-1"]).ok).toBe(false);
    expect(validateRevenueAccounts(chart, ["ast-1"]).ok).toBe(false);
  });

  it("rejects an inactive account", () => {
    expect(validateRevenueAccounts(chart, ["inc-off"]).ok).toBe(false);
  });
});

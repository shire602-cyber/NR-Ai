import { describe, it, expect } from "vitest";
import { checkPostedInvoiceEdit } from "../../server/services/posted-invoice-lock.service";

const DEFAULT = "acc-4010";
const ZERO = "acc-4060";
const SERVICE = "acc-4020";

type L = {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType?: string | null;
  revenueAccountId?: string | null;
};
const sub = (lines: L[]) => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
const check = (before: L[], after: L[], rate = 1) =>
  checkPostedInvoiceEdit({
    before: { lines: before, subtotal: sub(before), rate },
    after: { lines: after, subtotal: sub(after), rate },
    defaultAccountId: DEFAULT,
    zeroRatedAccountId: ZERO,
  });

describe("checkPostedInvoiceEdit", () => {
  it("allows an edit that changes nothing the ledger or VAT return sees", () => {
    const before: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE }];
    const after: L[] = [{ quantity: 2, unitPrice: 50, vatRate: 0.05, revenueAccountId: SERVICE }];
    expect(check(before, after)).toEqual({ ok: true });
  });

  it("rejects swapping the amounts between two revenue accounts (defect 2 proof)", () => {
    // A 100 -> 4020, B 900 -> default; edit makes A 900, B 100. Same set of
    // accounts and same totals, but the ledger amounts per account move.
    const before: L[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE },
      { quantity: 1, unitPrice: 900, vatRate: 0.05 },
    ];
    const after: L[] = [
      { quantity: 1, unitPrice: 900, vatRate: 0.05, revenueAccountId: SERVICE },
      { quantity: 1, unitPrice: 100, vatRate: 0.05 },
    ];
    const verdict = check(before, after);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("INVOICE_POSTED_REVENUE_ACCOUNT_LOCKED");
  });

  it("rejects moving a line to another account", () => {
    const before: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE }];
    const after: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05 }];
    expect(check(before, after).ok).toBe(false);
  });

  it("allows reordering lines / re-splitting within the same accounts", () => {
    const before: L[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE },
      { quantity: 1, unitPrice: 900, vatRate: 0.05 },
    ];
    const after: L[] = [
      { quantity: 1, unitPrice: 900, vatRate: 0.05 },
      { quantity: 4, unitPrice: 25, vatRate: 0.05, revenueAccountId: SERVICE },
    ];
    expect(check(before, after)).toEqual({ ok: true });
  });

  it("rejects moving net between a 5% and a 0% line even when totals are unchanged", () => {
    const before: L[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE },
      { quantity: 1, unitPrice: 100, vatRate: 0, revenueAccountId: SERVICE },
    ];
    const after: L[] = [
      { quantity: 1, unitPrice: 150, vatRate: 0.05, revenueAccountId: SERVICE },
      { quantity: 1, unitPrice: 50, vatRate: 0, revenueAccountId: SERVICE },
    ];
    const verdict = check(before, after);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("INVOICE_POSTED_VAT_LOCKED");
  });

  it("rejects turning an exempt 0% line into zero-rated (moves VAT 201 boxes)", () => {
    const before: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "exempt" }];
    const after: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "zero_rated" }];
    const verdict = check(before, after);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("INVOICE_POSTED_VAT_LOCKED");
  });

  it("does not trip on legacy rows that stored a taxed line as exempt", () => {
    // Defect 1 legacy data: 5% line stored exempt. Re-saving derives
    // standard_rated; that is a correction, not a change.
    const before: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" }];
    const after: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" }];
    expect(check(before, after)).toEqual({ ok: true });
  });

  it("rejects a changed exchange rate (AED amounts would move)", () => {
    const lines: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05 }];
    const verdict = checkPostedInvoiceEdit({
      before: { lines, subtotal: 100, rate: 3.6725 },
      after: { lines, subtotal: 100, rate: 3.7 },
      defaultAccountId: DEFAULT,
      zeroRatedAccountId: ZERO,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("INVOICE_POSTED_AMOUNT_LOCKED");
  });

  it("compares in AED for a foreign-currency invoice", () => {
    const before: L[] = [{ quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: SERVICE }];
    expect(check(before, before, 3.6725)).toEqual({ ok: true });
  });
});

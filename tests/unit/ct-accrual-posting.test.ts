import { describe, expect, it } from "vitest";
import { buildCtAccrualPosting } from "../../server/services/tax-settlement";

const ACC = { expenseId: "exp", payableId: "pay", retainedId: "ret" };
const net = (lines: Array<{ accountId: string; debit: number; credit: number }>, id: string) =>
  Math.round(lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
const balanced = (lines: Array<{ debit: number; credit: number }>) =>
  Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) === 0;

describe("buildCtAccrualPosting", () => {
  it("year not closed: only the accrual, Dr expense / Cr payable", () => {
    const p = buildCtAccrualPosting(20250, ACC, { yearClosed: false });
    expect(balanced(p.accrual)).toBe(true);
    expect(net(p.accrual, "exp")).toBe(20250);
    expect(net(p.accrual, "pay")).toBe(-20250);
    expect(p.closing).toEqual([]);
  });

  it("year already closed: the accrual PLUS a closing line Dr retained earnings / Cr expense", () => {
    const p = buildCtAccrualPosting(20250, ACC, { yearClosed: true });
    expect(balanced(p.accrual)).toBe(true);
    expect(balanced(p.closing)).toBe(true);
    expect(net(p.closing, "ret")).toBe(20250);
    expect(net(p.closing, "exp")).toBe(-20250);
    // the closed year's expense account nets to zero across both entries
    expect(net([...p.accrual, ...p.closing], "exp")).toBe(0);
    // and the payable and retained earnings carry the liability and the cost
    expect(net([...p.accrual, ...p.closing], "pay")).toBe(-20250);
    expect(net([...p.accrual, ...p.closing], "ret")).toBe(20250);
  });

  it("an amendment that lowers the tax reverses part of the accrual and of the closing line", () => {
    const p = buildCtAccrualPosting(-9000, ACC, { yearClosed: true });
    expect(net(p.accrual, "exp")).toBe(-9000);
    expect(net(p.accrual, "pay")).toBe(9000);
    expect(net(p.closing, "ret")).toBe(-9000);
    expect(net(p.closing, "exp")).toBe(9000);
    expect(net([...p.accrual, ...p.closing], "exp")).toBe(0);
  });

  it("zero amount posts nothing", () => {
    expect(buildCtAccrualPosting(0, ACC, { yearClosed: true })).toEqual({ accrual: [], closing: [] });
  });

  it("is exact to the fils", () => {
    const p = buildCtAccrualPosting(1234.57, ACC, { yearClosed: true });
    expect(balanced(p.accrual)).toBe(true);
    expect(balanced(p.closing)).toBe(true);
  });

  it("closing a year without a retained earnings account is an error, not a silent skip", () => {
    expect(() => buildCtAccrualPosting(100, { expenseId: "e", payableId: "p" }, { yearClosed: true })).toThrow(/retained/i);
  });
});

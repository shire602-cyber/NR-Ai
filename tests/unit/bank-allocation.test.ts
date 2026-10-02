import { describe, expect, it } from "vitest";
import { allocateInOrder, allocationState, splitState } from "../../client/src/components/banking/allocation";

const inv = (id: string, outstanding: number) => ({ id, outstanding });

describe("allocateInOrder", () => {
  it("settles two invoices with one receipt (31,500 = 21,000 + 10,500)", () => {
    expect(allocateInOrder(31500, [inv("a", 21000), inv("b", 10500)])).toEqual({ allocations: [{ invoiceId: "a", amount: 21000 }, { invoiceId: "b", amount: 10500 }], remaining: 0 });
  });
  it("pays the last invoice partly when the line runs out", () => {
    expect(allocateInOrder(25000, [inv("a", 21000), inv("b", 10500)])).toEqual({ allocations: [{ invoiceId: "a", amount: 21000 }, { invoiceId: "b", amount: 4000 }], remaining: 0 });
  });
  it("leaves the excess when the invoices are all paid (9,000 against 8,400)", () => {
    expect(allocateInOrder(9000, [inv("a", 8400)])).toEqual({ allocations: [{ invoiceId: "a", amount: 8400 }], remaining: 600 });
  });
  it("works in whole cents", () => {
    expect(allocateInOrder(0.3, [inv("a", 0.1), inv("b", 0.2)]).remaining).toBe(0);
  });
});

describe("allocationState", () => {
  const out = { a: 21000, b: 10500 };
  it("is clean for an exact settlement", () => {
    const s = allocationState(31500, [{ invoiceId: "a", amount: 21000 }, { invoiceId: "b", amount: 10500 }], out);
    expect(s).toMatchObject({ issues: [], remaining: 0, excess: 0, total: 31500 });
  });
  it("refuses more than the line or more than an invoice owes", () => {
    expect(allocationState(20000, [{ invoiceId: "a", amount: 21000 }], out).issues).toEqual(expect.arrayContaining(["OVER_LINE"]));
    expect(allocationState(40000, [{ invoiceId: "a", amount: 22000 }], out).issues).toContain("OVER_OUTSTANDING");
    expect(allocationState(100, [], out).issues).toContain("NONE_SELECTED");
    expect(allocationState(100, [{ invoiceId: "a", amount: 0 }], out).issues).toContain("AMOUNT_INVALID");
  });
  it("reports the excess and whether it can be kept as credit (only after a fully paid last invoice)", () => {
    const full = allocationState(9000, [{ invoiceId: "a", amount: 8400 }], { a: 8400 });
    expect(full).toMatchObject({ excess: 600, canKeepExcess: true, issues: [] });
    const partial = allocationState(9000, [{ invoiceId: "a", amount: 5000 }], { a: 8400 });
    expect(partial.canKeepExcess).toBe(false);
    expect(partial.excess).toBe(4000);
  });
});

describe("splitState", () => {
  it("accepts a loan instalment split into principal and interest", () => {
    expect(splitState(-5000, [{ accountId: "p", amount: 4200 }, { accountId: "i", amount: 800 }])).toEqual({ total: 5000, remaining: 0, issues: [] });
  });
  it("shows what is left and flags a mismatch", () => {
    const s = splitState(5000, [{ accountId: "p", amount: 4200 }]);
    expect(s.remaining).toBe(800);
    expect(s.issues).toContain("TOTAL_MISMATCH");
  });
  it("flags missing accounts, bad amounts, no lines and too many lines", () => {
    expect(splitState(100, []).issues).toContain("NO_LINES");
    expect(splitState(100, [{ accountId: "", amount: 100 }]).issues).toContain("ACCOUNT_MISSING");
    expect(splitState(100, [{ accountId: "a", amount: 0 }]).issues).toContain("AMOUNT_INVALID");
    expect(splitState(100, Array.from({ length: 11 }, () => ({ accountId: "a", amount: 1 }))).issues).toContain("TOO_MANY");
  });
});

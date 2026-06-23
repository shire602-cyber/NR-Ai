import { describe, it, expect } from "vitest";
import {
  computeCompletenessGaps,
  isWithinPeriod,
  type BankLine,
} from "../../server/services/intake-completeness";

const START = new Date("2026-01-01T00:00:00Z");
const END = new Date("2026-03-31T23:59:59Z");

const line = (over: Partial<BankLine> = {}): BankLine => ({
  id: "t" + Math.random().toString(36).slice(2, 7),
  transactionDate: new Date("2026-02-15T00:00:00Z"),
  amount: -100,
  matchStatus: "unmatched",
  ...over,
});

describe("isWithinPeriod", () => {
  it("is inclusive of both ends", () => {
    expect(isWithinPeriod(START, START, END)).toBe(true);
    expect(isWithinPeriod(END, START, END)).toBe(true);
    expect(isWithinPeriod(new Date("2025-12-31T23:00:00Z"), START, END)).toBe(false);
  });
});

describe("computeCompletenessGaps", () => {
  it("flags an unmatched outflow as missing purchase evidence", () => {
    const r = computeCompletenessGaps({
      lines: [line({ id: "a", amount: -250, description: "CARD PURCHASE" })],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].kind).toBe("missing_purchase_evidence");
    expect(r.gaps[0].direction).toBe("outflow");
    expect(r.gaps[0].amount).toBe(250);
    expect(r.summary.unmatchedOutflowValue).toBe(250);
  });

  it("flags an unmatched inflow as missing sales evidence", () => {
    const r = computeCompletenessGaps({
      lines: [line({ id: "b", amount: 900 })],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.gaps[0].kind).toBe("missing_sales_evidence");
    expect(r.gaps[0].direction).toBe("inflow");
    expect(r.summary.unmatchedInflowValue).toBe(900);
  });

  it("does not flag a matched line, and counts coverage", () => {
    const r = computeCompletenessGaps({
      lines: [
        line({ id: "m1", matchStatus: "matched" }),
        line({ id: "m2", matchStatus: "unmatched", matchedReceiptId: "r1" }),
        line({ id: "g1", amount: -50 }),
      ],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.summary.totalLines).toBe(3);
    expect(r.summary.matchedLines).toBe(2); // matched + receipt-linked
    expect(r.summary.unmatchedLines).toBe(1);
    expect(r.summary.coverageRatio).toBe(0.67);
    expect(r.gaps.map((g) => g.bankTransactionId)).toEqual(["g1"]);
  });

  it("treats a 'suggested' (unconfirmed) match as still a gap", () => {
    const r = computeCompletenessGaps({
      lines: [line({ id: "s1", matchStatus: "suggested", amount: -75 })],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.summary.unmatchedLines).toBe(1);
    expect(r.gaps).toHaveLength(1);
  });

  it("excludes lines outside the period", () => {
    const r = computeCompletenessGaps({
      lines: [
        line({ id: "in", transactionDate: new Date("2026-02-01T00:00:00Z"), amount: -10 }),
        line({ id: "out", transactionDate: new Date("2026-05-01T00:00:00Z"), amount: -999 }),
      ],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.summary.totalLines).toBe(1);
    expect(r.gaps.map((g) => g.bankTransactionId)).toEqual(["in"]);
  });

  it("ignores zero-amount lines", () => {
    const r = computeCompletenessGaps({
      lines: [line({ id: "z", amount: 0 })],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.gaps).toHaveLength(0);
  });

  it("sorts gaps by descending value (chase the biggest first)", () => {
    const r = computeCompletenessGaps({
      lines: [line({ id: "small", amount: -10 }), line({ id: "big", amount: -5000 }), line({ id: "mid", amount: -300 })],
      periodStart: START,
      periodEnd: END,
    });
    expect(r.gaps.map((g) => g.bankTransactionId)).toEqual(["big", "mid", "small"]);
  });

  it("reports full coverage when there are no lines", () => {
    const r = computeCompletenessGaps({ lines: [], periodStart: START, periodEnd: END });
    expect(r.summary.coverageRatio).toBe(1);
    expect(r.summary.gapCount).toBe(0);
  });
});

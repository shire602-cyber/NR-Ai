import { describe, expect, it } from "vitest";
import {
  balanceCheck,
  buildCommitRows,
  fromStagedRows,
  isIsoDay,
  parseAmountText,
  rowIssues,
  summariseReview,
  type ReviewRow,
} from "../../client/src/lib/statement-review";

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  key: "r1",
  date: "2026-06-14",
  description: "ETISALAT UAE",
  reference: "TEL-0614",
  amount: "-1260.00",
  balance: "56958.00",
  excluded: false,
  serverIssues: [],
  ...over,
});

describe("parseAmountText", () => {
  it("reads plain, grouped and bracketed numbers", () => {
    expect(parseAmountText("1260")).toBe(1260);
    expect(parseAmountText("-1,260.50")).toBe(-1260.5);
    expect(parseAmountText("(42.00)")).toBe(-42);
    expect(parseAmountText(" 19 425.00 ")).toBe(19425);
  });
  it("refuses text that is not a number", () => {
    expect(parseAmountText("")).toBeNull();
    expect(parseAmountText("abc")).toBeNull();
    expect(parseAmountText("12.3.4")).toBeNull();
    expect(parseAmountText("1e5")).toBeNull();
  });
});

describe("isIsoDay", () => {
  it("accepts only real calendar days", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("14/06/2026")).toBe(false);
    expect(isIsoDay("")).toBe(false);
  });
});

describe("rowIssues", () => {
  it("is empty for a good row", () => {
    expect(rowIssues(row())).toEqual([]);
  });
  it("flags a bad date, a zero or missing amount, and an empty description", () => {
    expect(rowIssues(row({ date: "2026-13-01" }))).toContain("DATE_INVALID");
    expect(rowIssues(row({ amount: "0" }))).toContain("AMOUNT_ZERO");
    expect(rowIssues(row({ amount: "x" }))).toContain("AMOUNT_INVALID");
    expect(rowIssues(row({ description: "   " }))).toContain("DESCRIPTION_EMPTY");
  });
  it("flags a balance that is typed but not a number", () => {
    expect(rowIssues(row({ balance: "n/a" }))).toContain("BALANCE_INVALID");
    expect(rowIssues(row({ balance: "" }))).toEqual([]);
  });
  it("does not report issues for an excluded row", () => {
    expect(rowIssues(row({ excluded: true, amount: "x" }))).toEqual([]);
  });
});

describe("balanceCheck", () => {
  it("is ok when opening + sum = closing", () => {
    const rows = [row({ amount: "-100" }), row({ key: "r2", amount: "250.50" })];
    expect(balanceCheck({ opening: 1000, closing: 1150.5, rows })).toEqual({ status: "ok", expectedClosing: 1150.5, difference: 0 });
  });
  it("reports the difference in cents-safe arithmetic", () => {
    const rows = [row({ amount: "0.1" }), row({ key: "r2", amount: "0.2" })];
    const r = balanceCheck({ opening: 0, closing: 0.3, rows });
    expect(r.status).toBe("ok");
    const off = balanceCheck({ opening: 0, closing: 1, rows });
    expect(off).toMatchObject({ status: "mismatch", expectedClosing: 0.3, difference: 0.7 });
  });
  it("ignores excluded rows and invalid amounts", () => {
    const rows = [row({ amount: "-100", excluded: true }), row({ key: "r2", amount: "oops" }), row({ key: "r3", amount: "40" })];
    expect(balanceCheck({ opening: 10, closing: 50, rows }).status).toBe("ok");
  });
  it("is unknown without both balances", () => {
    expect(balanceCheck({ opening: null, closing: 5, rows: [row()] }).status).toBe("unknown");
    expect(balanceCheck({ opening: 5, closing: null, rows: [row()] }).status).toBe("unknown");
  });
});

describe("fromStagedRows", () => {
  it("keeps server issues and gives every row a distinct key", () => {
    const rows = fromStagedRows([
      { date: "2026-06-13", description: "FEE", reference: null, amount: -42, balance: 58218, issues: ["balance_gap"] },
      { date: "2026-06-14", description: "IN", reference: "R1", amount: 19425, balance: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).not.toBe(rows[1].key);
    expect(rows[0]).toMatchObject({ amount: "-42.00", serverIssues: ["balance_gap"], excluded: false });
    expect(rows[1]).toMatchObject({ balance: "", reference: "R1" });
  });
});

describe("summariseReview and buildCommitRows", () => {
  it("counts included, excluded and rows with issues", () => {
    const rows = [row(), row({ key: "r2", excluded: true }), row({ key: "r3", amount: "x" })];
    expect(summariseReview(rows)).toEqual({ included: 2, excluded: 1, withIssues: 1, canCommit: false });
    expect(summariseReview([row(), row({ key: "r2", excluded: true })]).canCommit).toBe(true);
  });
  it("cannot commit when every row is excluded", () => {
    expect(summariseReview([row({ excluded: true })]).canCommit).toBe(false);
  });
  it("sends only included rows, with numbers", () => {
    const out = buildCommitRows([row({ amount: "(42.00)", balance: "" }), row({ key: "r2", excluded: true }), row({ key: "r3", reference: "  ", valueDate: "2026-06-15" })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ date: "2026-06-14", description: "ETISALAT UAE", reference: "TEL-0614", amount: -42, balance: null, valueDate: null });
    expect(out[1].reference).toBeNull();
    expect(out[1].valueDate).toBe("2026-06-15");
  });
  it("throws if a row with issues is committed", () => {
    expect(() => buildCommitRows([row({ amount: "x" })])).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_FILS,
  MoneyError,
  allocate,
  filsToNumber,
  formatFils,
  fromFils,
  mulRate,
  roundHalfUp,
  sumFils,
  toFils,
  tryToFils,
} from "../../shared/money";

function moneyCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof MoneyError ? err.code : "NOT_MONEY_ERROR";
  }
  return undefined;
}

describe("shared/money toFils", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["1", 100],
    ["1.5", 150],
    ["1.05", 105],
    [" 1234.56 ", 123456],
    ["-12.30", -1230],
    ["+7.01", 701],
    [".5", 50],
    [0.1, 10],
    [19.99, 1999],
    [1234.56, 123456],
    ["9999999999999.99", MAX_FILS],
    ["-9999999999999.99", -MAX_FILS],
  ] as const)("parses %j exactly", (input, fils) => {
    expect(toFils(input)).toBe(fils);
  });

  it("keeps 100.01 and 100.00 unequal — no tolerance", () => {
    expect(toFils("100.01")).not.toBe(toFils("100.00"));
    expect(toFils("100.01") - toFils("100.00")).toBe(1);
  });

  it("does not accept float drift: 0.1 + 0.2 is rejected unless rounding is explicit", () => {
    expect(moneyCode(() => toFils(0.1 + 0.2))).toBe("MONEY_TOO_PRECISE");
    expect(toFils(0.1 + 0.2, { rounding: "halfUp" })).toBe(30);
  });

  it.each([
    ["2.345", 235],
    ["2.344", 234],
    ["2.355", 236],
    ["-2.345", -235],
    ["0.005", 1],
    ["-0.005", -1],
    ["0.004", 0],
    ["1.995", 200],
  ] as const)("rounds %s half-up (away from zero) to %i fils when asked", (input, fils) => {
    expect(toFils(input, { rounding: "halfUp" })).toBe(fils);
  });

  it("rejects more than 2 decimals by default", () => {
    expect(moneyCode(() => toFils("1.001"))).toBe("MONEY_TOO_PRECISE");
    expect(moneyCode(() => toFils(2.345))).toBe("MONEY_TOO_PRECISE");
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite %s", (v) => {
    expect(moneyCode(() => toFils(v))).toBe("MONEY_NOT_FINITE");
  });

  it.each(["", "abc", "1,000.00", "1e3", "12.3.4", "AED 5", "--1", "0x10"])(
    "rejects non-decimal string %j",
    (v) => {
      expect(moneyCode(() => toFils(v))).toBe("MONEY_INVALID");
    }
  );

  it("rejects values beyond numeric(15,2)", () => {
    expect(moneyCode(() => toFils("10000000000000.00"))).toBe("MONEY_OUT_OF_RANGE");
    expect(moneyCode(() => toFils(-1e13))).toBe("MONEY_OUT_OF_RANGE");
    expect(moneyCode(() => toFils(1e21))).toBe("MONEY_OUT_OF_RANGE");
    // Rounding up can push over the edge too.
    expect(moneyCode(() => toFils("9999999999999.995", { rounding: "halfUp" }))).toBe(
      "MONEY_OUT_OF_RANGE"
    );
  });

  it("tryToFils returns null instead of throwing", () => {
    expect(tryToFils("x")).toBeNull();
    expect(tryToFils(undefined)).toBeNull();
    expect(tryToFils("1.10")).toBe(110);
  });

  it("never returns negative zero", () => {
    expect(Object.is(toFils("-0.00"), 0)).toBe(true);
  });
});

describe("shared/money conversions and arithmetic", () => {
  it("fromFils renders exact 2dp strings", () => {
    expect(fromFils(0)).toBe("0.00");
    expect(fromFils(5)).toBe("0.05");
    expect(fromFils(-1230)).toBe("-12.30");
    expect(fromFils(MAX_FILS)).toBe("9999999999999.99");
    expect(filsToNumber(123456)).toBe(1234.56);
  });

  it("fromFils rejects non-integers and out-of-range", () => {
    expect(moneyCode(() => fromFils(1.5))).toBe("MONEY_INVALID");
    expect(moneyCode(() => fromFils(MAX_FILS + 1))).toBe("MONEY_OUT_OF_RANGE");
  });

  it("roundHalfUp returns strings", () => {
    expect(roundHalfUp("2.345")).toBe("2.35");
    expect(roundHalfUp(-2.345)).toBe("-2.35");
    expect(roundHalfUp("1.23456789", 6)).toBe("1.234568");
  });

  it("sumFils is exact where floats drift", () => {
    const tenths = Array.from({ length: 10 }, () => toFils("0.10"));
    expect(sumFils(tenths)).toBe(100);
    expect(sumFils([])).toBe(0);
    expect(moneyCode(() => sumFils([MAX_FILS, 1]))).toBe("MONEY_OUT_OF_RANGE");
    expect(moneyCode(() => sumFils([1.5]))).toBe("MONEY_INVALID");
  });

  it("mulRate rounds the rate to 6dp then the product half-up to fils", () => {
    // 100.00 USD at 3.6725 → 367.25 AED
    expect(mulRate(10000, "3.6725")).toBe(36725);
    // 5% VAT on 0.10 = 0.005 → 0.01 (half-up)
    expect(mulRate(10, "0.05")).toBe(1);
    expect(mulRate(1000000, "1.0000005")).toBe(1000001); // rate → 1.000001
    expect(mulRate(-333, "0.5")).toBe(-167); // -166.5 → -167 (away from zero)
  });

  it("mulRate rejects bad rates and overflow", () => {
    expect(moneyCode(() => mulRate(100, 0))).toBe("MONEY_INVALID_RATE");
    expect(moneyCode(() => mulRate(100, -1))).toBe("MONEY_INVALID_RATE");
    expect(moneyCode(() => mulRate(100, "abc"))).toBe("MONEY_INVALID_RATE");
    expect(moneyCode(() => mulRate(100, NaN))).toBe("MONEY_INVALID_RATE");
    expect(moneyCode(() => mulRate(MAX_FILS, 2))).toBe("MONEY_OUT_OF_RANGE");
  });

  it("allocate always sums back exactly and distributes the remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(allocate(5, [0.3, 0.7])).toEqual([2, 3]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(7, [0, 1, 0])).toEqual([0, 7, 0]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    const parts = allocate(999_999, [3, 7, 11, 13]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999_999);
  });

  it("allocate rejects bad ratios", () => {
    expect(moneyCode(() => allocate(100, []))).toBe("MONEY_INVALID_RATIOS");
    expect(moneyCode(() => allocate(100, [0, 0]))).toBe("MONEY_INVALID_RATIOS");
    expect(moneyCode(() => allocate(100, [1, -1]))).toBe("MONEY_INVALID_RATIOS");
  });

  it("formatFils formats without floating point", () => {
    expect(formatFils(123456789)).toBe("AED 1,234,567.89");
    expect(formatFils(-500)).toBe("-AED 5.00");
    expect(formatFils(MAX_FILS, { currency: null })).toBe("9,999,999,999,999.99");
    expect(formatFils(123456, { currency: "USD", grouping: false })).toBe("USD 1234.56");
  });
});

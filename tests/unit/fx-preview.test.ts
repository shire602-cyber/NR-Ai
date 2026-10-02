import { describe, expect, it } from "vitest";
import { parseRate, realisedFx } from "../../client/src/components/banking/fx-preview";

describe("realisedFx", () => {
  it("a USD 5,000 receipt at 3.6735 against an invoice at 3.6725 is a gain of AED 5.00", () => {
    expect(realisedFx({ kind: "receipt", amount: 5000, bookRate: 3.6725, paymentRate: 3.6735 })).toEqual({ aedAtBook: 18362.5, aedAtPayment: 18367.5, gainLoss: 5 });
  });
  it("a lower rate on the day is a loss on a receipt", () => {
    expect(realisedFx({ kind: "receipt", amount: 1000, bookRate: 3.67, paymentRate: 3.66 })?.gainLoss).toBe(-10);
  });
  it("a payment is the mirror: a higher rate on the day is a loss", () => {
    expect(realisedFx({ kind: "payment", amount: 1000, bookRate: 3.67, paymentRate: 3.68 })?.gainLoss).toBe(-10);
    expect(realisedFx({ kind: "payment", amount: 1000, bookRate: 3.67, paymentRate: 3.66 })?.gainLoss).toBe(10);
  });
  it("is nothing without a usable amount or rate", () => {
    expect(realisedFx({ kind: "receipt", amount: 0, bookRate: 3.67, paymentRate: 3.67 })).toBeNull();
    expect(realisedFx({ kind: "receipt", amount: 10, bookRate: NaN, paymentRate: 3.67 })).toBeNull();
  });
});

describe("parseRate", () => {
  it("accepts a positive number with up to 6 decimals", () => {
    expect(parseRate("3.6735")).toBe(3.6735);
    expect(parseRate(" 3.674 ")).toBe(3.674);
  });
  it("refuses zero, text and too many decimals", () => {
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("3.1234567")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});

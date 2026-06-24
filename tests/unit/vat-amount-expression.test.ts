import { describe, it, expect } from "vitest";
import { evaluateAmountExpression } from "../../shared/vat-workpaper-grid";

describe("evaluateAmountExpression", () => {
  it("adds (the reported case): 7800+1850 → 9650", () => {
    expect(evaluateAmountExpression("7800+1850")).toBe(9650);
  });

  it("handles a plain number", () => {
    expect(evaluateAmountExpression("1000")).toBe(1000);
    expect(evaluateAmountExpression("1000.50")).toBe(1000.5);
  });

  it("respects operator precedence and parentheses", () => {
    expect(evaluateAmountExpression("100*1.05")).toBe(105);
    expect(evaluateAmountExpression("100+50*2")).toBe(200);
    expect(evaluateAmountExpression("(20+5)/2")).toBe(12.5);
  });

  it("supports subtraction and division", () => {
    expect(evaluateAmountExpression("9650-1850")).toBe(7800);
    expect(evaluateAmountExpression("100/8")).toBe(12.5);
  });

  it("handles a leading unary minus", () => {
    expect(evaluateAmountExpression("-50")).toBe(-50);
    expect(evaluateAmountExpression("-50+20")).toBe(-30);
  });

  it("strips currency symbols, AED and thousands separators", () => {
    expect(evaluateAmountExpression("AED 7,800 + 1,850")).toBe(9650);
    expect(evaluateAmountExpression("1,234.56")).toBe(1234.56);
  });

  it("accepts a number input directly", () => {
    expect(evaluateAmountExpression(9650)).toBe(9650);
  });

  it("rounds to 2 decimals", () => {
    expect(evaluateAmountExpression("10/3")).toBe(3.33);
  });

  it("returns 0 for empty / null / undefined", () => {
    expect(evaluateAmountExpression("")).toBe(0);
    expect(evaluateAmountExpression(null)).toBe(0);
    expect(evaluateAmountExpression(undefined)).toBe(0);
  });

  it("returns 0 for malformed input (no eval / no injection)", () => {
    expect(evaluateAmountExpression("7800+")).toBe(0); // trailing operator
    expect(evaluateAmountExpression("abc")).toBe(0);
    expect(evaluateAmountExpression("alert(1)")).toBe(0);
    expect(evaluateAmountExpression("(1+2")).toBe(0); // unbalanced
  });

  it("does not divide-by-zero into Infinity (returns 0)", () => {
    expect(evaluateAmountExpression("5/0")).toBe(0);
  });
});

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  canonicalizeCompanyRate,
  invertRate,
  parseRate,
  sanityCheck,
  validateRateInput,
} from "../../server/services/fx/rates";
import { buildRevaluationLines } from "../../server/services/fx/revaluation";
import type { FxExposure } from "../../server/services/fx/exposure";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
};

describe("R14-02 canonical rate convention", () => {
  it("stores (foreign, base) as base-per-foreign and inverts base->foreign entries once", () => {
    expect(canonicalizeCompanyRate("EUR", "AED", new Decimal(4), "AED")).toMatchObject({
      baseCurrency: "EUR",
      targetCurrency: "AED",
    });
    const flipped = canonicalizeCompanyRate("AED", "USD", new Decimal("0.272294"), "AED");
    expect(flipped.baseCurrency).toBe("USD");
    expect(flipped.targetCurrency).toBe("AED");
    expect(flipped.rate.toFixed(6)).toBe("3.672501");
    expect(invertRate(4).toFixed(6)).toBe("0.250000");
  });
});

describe("R14-12 rate validation", () => {
  it("rejects bad codes, same currency, non-positive and future rates", () => {
    expect(
      code(() => validateRateInput({ fromCurrency: "ZZZ", toCurrency: "AED", rate: 1 }, "AED"))
    ).toBe("INVALID_CURRENCY");
    expect(
      code(() => validateRateInput({ fromCurrency: "AED", toCurrency: "aed", rate: 1 }, "AED"))
    ).toBe("SAME_CURRENCY");
    expect(code(() => parseRate(0))).toBe("INVALID_RATE");
    expect(code(() => parseRate("-1"))).toBe("INVALID_RATE");
    expect(code(() => parseRate("0.0000001"))).toBe("INVALID_RATE");
    expect(code(() => parseRate(Number.NaN))).toBe("INVALID_RATE");
    expect(parseRate("3.67250049").toFixed(6)).toBe("3.672500");
    expect(
      code(() =>
        validateRateInput(
          { fromCurrency: "USD", toCurrency: "AED", rate: 3.67, effectiveDate: "2999-01-01" },
          "AED"
        )
      )
    ).toBe("FUTURE_RATE_DATE");
  });

  it("flags a > 20% move unless confirmed", () => {
    const prev = { rate: new Decimal("3.6725"), date: "2026-01-01" };
    expect(code(() => sanityCheck(new Decimal(5), prev, false))).toBe("RATE_CHANGE_UNCONFIRMED");
    expect(sanityCheck(new Decimal(5), prev, true)?.changePct).toBeCloseTo(36.15, 2);
    expect(sanityCheck(new Decimal("3.8"), prev, false)?.changePct).toBeCloseTo(3.47, 2);
    expect(sanityCheck(new Decimal(5), null, false)).toBeNull();
  });
});

describe("R14-03 revaluation lines", () => {
  const exposure = (receivableFils: number, payableFils: number): FxExposure => ({
    asOf: "2026-11-14",
    baseCurrency: "AED",
    rateType: "closing",
    items: [],
    missingRates: [],
    warnings: [],
    totals: {
      receivableFils,
      payableFils,
      bankFils: 0,
      gainFils: 0,
      lossFils: 0,
      netFils: receivableFils + payableFils,
    },
  });
  const acct = (id: string) => ({ id, code: id, nameEn: id });
  const accounts = {
    ar: acct("1040"),
    ap: acct("2010"),
    gain: acct("4091"),
    loss: acct("5141"),
    banks: new Map(),
  };

  it("balances A/R and A/P adjustments against the unrealised gain or loss account", () => {
    const lines = buildRevaluationLines(exposure(5500, -2500), accounts);
    expect(lines.map((l) => [l.accountCode, l.debitFils, l.creditFils])).toEqual([
      ["1040", 5500, 0],
      ["2010", 0, 2500],
      ["4091", 0, 3000],
    ]);
    const loss = buildRevaluationLines(exposure(-1000, 0), accounts);
    expect(loss.map((l) => [l.accountCode, l.debitFils, l.creditFils])).toEqual([
      ["1040", 0, 1000],
      ["5141", 1000, 0],
    ]);
    expect(buildRevaluationLines(exposure(0, 0), accounts)).toEqual([]);
    expect(code(() => buildRevaluationLines(exposure(100, 0), { ...accounts, ar: null }))).toBe(
      "AR_ACCOUNT_MISSING"
    );
  });
});

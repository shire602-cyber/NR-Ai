import { describe, it, expect } from "vitest";
import {
  resolveRate,
  validateRateInput,
  normalizeEffectiveDate,
  type RateRow,
} from "../../server/services/exchange-rate-rules";

const A = "company-a";
const B = "company-b";
const day = (s: string) => new Date(`${s}T00:00:00Z`);

function row(over: Partial<RateRow>): RateRow {
  return {
    companyId: null,
    baseCurrency: "CHF",
    targetCurrency: "AED",
    rate: 4.1,
    date: day("2026-09-01"),
    source: "manual",
    isTrusted: true,
    ...over,
  };
}

describe("resolveRate lookup order", () => {
  it("returns the company's own direct rate", () => {
    const r = resolveRate([row({ companyId: A, rate: 4.1 })], {
      from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A,
    });
    expect(r).toMatchObject({ rate: 4.1, scope: "company", inverted: false });
  });

  it("never returns another company's rate", () => {
    const r = resolveRate([row({ companyId: A, rate: 4.1 })], {
      from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: B,
    });
    expect(r).toBeNull();
  });

  it("prefers the company's own rate over a newer system rate", () => {
    const r = resolveRate(
      [
        row({ companyId: A, rate: 4.1, date: day("2026-09-01") }),
        row({ companyId: null, rate: 4.5, date: day("2026-09-08") }),
      ],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r).toMatchObject({ rate: 4.1, scope: "company" });
  });

  it("falls back to the system rate when the company has none", () => {
    const r = resolveRate([row({ companyId: null, rate: 4.5, source: "fta" })], {
      from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: B,
    });
    expect(r).toMatchObject({ rate: 4.5, scope: "system", source: "fta" });
  });

  it("uses the most recent rate on or before asOf, ignoring later ones", () => {
    const r = resolveRate(
      [
        row({ companyId: A, rate: 4.0, date: day("2026-09-01") }),
        row({ companyId: A, rate: 4.2, date: day("2026-09-05") }),
        row({ companyId: A, rate: 9.9, date: day("2026-09-20") }),
      ],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r?.rate).toBe(4.2);
  });

  it("with no asOf takes the newest rate", () => {
    const r = resolveRate(
      [
        row({ companyId: A, rate: 4.0, date: day("2026-09-01") }),
        row({ companyId: A, rate: 4.2, date: day("2026-09-05") }),
      ],
      { from: "CHF", to: "AED", companyId: A }
    );
    expect(r?.rate).toBe(4.2);
  });

  it("inverts the reverse pair: 1 AED = 0.25 CHF means CHF->AED 4", () => {
    const r = resolveRate(
      [row({ companyId: A, baseCurrency: "AED", targetCurrency: "CHF", rate: 0.25 })],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r).toMatchObject({ rate: 4, scope: "company", inverted: true });
  });

  it("prefers a direct system rate over an inverse company rate", () => {
    const r = resolveRate(
      [
        row({ companyId: A, baseCurrency: "AED", targetCurrency: "CHF", rate: 0.25 }),
        row({ companyId: null, rate: 4.5 }),
      ],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r).toMatchObject({ rate: 4.5, scope: "system", inverted: false });
  });

  it("tries the inverse own rate before the inverse system rate", () => {
    const r = resolveRate(
      [
        row({ companyId: null, baseCurrency: "AED", targetCurrency: "CHF", rate: 0.2 }),
        row({ companyId: A, baseCurrency: "AED", targetCurrency: "CHF", rate: 0.25 }),
      ],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r).toMatchObject({ rate: 4, scope: "company", inverted: true });
  });

  it("ignores untrusted rows entirely", () => {
    const r = resolveRate(
      [row({ companyId: null, rate: 0.2439, isTrusted: false })],
      { from: "CHF", to: "AED", asOf: day("2026-09-10"), companyId: A }
    );
    expect(r).toBeNull();
  });

  it("ignores rows with a non-positive or non-finite rate", () => {
    const r = resolveRate(
      [row({ companyId: A, rate: 0 }), row({ companyId: A, rate: Number.NaN })],
      { from: "CHF", to: "AED", companyId: A }
    );
    expect(r).toBeNull();
  });

  it("with a null company only system rows are visible", () => {
    const r = resolveRate(
      [row({ companyId: A, rate: 4.1 }), row({ companyId: null, rate: 4.5 })],
      { from: "CHF", to: "AED", companyId: null }
    );
    expect(r).toMatchObject({ rate: 4.5, scope: "system" });
  });

  it("same currency is rate 1", () => {
    expect(resolveRate([], { from: "AED", to: "AED", companyId: A })?.rate).toBe(1);
  });
});

describe("validateRateInput", () => {
  const ok = (over: object = {}) =>
    validateRateInput({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.1, ...over });

  it("accepts 1 CHF = 4.1 AED and stores base=CHF target=AED", () => {
    const v = ok();
    expect(v).toEqual({ ok: true, value: { baseCurrency: "CHF", targetCurrency: "AED", rate: 4.1 } });
  });

  it("accepts the inverse entry 1 AED = 0.25 CHF as base=AED target=CHF", () => {
    const v = ok({ fromCurrency: "AED", toCurrency: "CHF", rate: 0.25 });
    expect(v).toEqual({ ok: true, value: { baseCurrency: "AED", targetCurrency: "CHF", rate: 0.25 } });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "4.1", null, undefined])(
    "rejects rate %s",
    (rate) => {
      expect(ok({ rate }).ok).toBe(false);
    }
  );

  it("rejects the same currency on both sides", () => {
    expect(ok({ fromCurrency: "AED", toCurrency: "AED" }).ok).toBe(false);
  });

  it("rejects codes that are not ISO 4217", () => {
    expect(ok({ fromCurrency: "CH" }).ok).toBe(false);
    expect(ok({ fromCurrency: "QQZ" }).ok).toBe(false);
    expect(ok({ fromCurrency: 5 }).ok).toBe(false);
    expect(ok({ toCurrency: undefined }).ok).toBe(false);
  });

  it("normalises lower-case codes", () => {
    const v = ok({ fromCurrency: "chf", toCurrency: "aed" });
    expect(v.ok && v.value.baseCurrency).toBe("CHF");
  });

  it("requires one side of the pair to be AED", () => {
    expect(ok({ fromCurrency: "USD", toCurrency: "EUR" }).ok).toBe(false);
  });

  it("rejects an implausible value for the foreign unit in AED", () => {
    expect(ok({ rate: 200000 }).ok).toBe(false); // 1 CHF = 200,000 AED
    expect(ok({ rate: 0.00001 }).ok).toBe(false); // 1 CHF = 0.00001 AED
    // inverse direction: 1 AED = 50000 CHF means 1 CHF = 0.00002 AED
    expect(ok({ fromCurrency: "AED", toCurrency: "CHF", rate: 50000 }).ok).toBe(false);
    // 1 AED = 0.00001 CHF means 1 CHF = 100000 AED (edge, allowed) ; 0.000001 is not
    expect(ok({ fromCurrency: "AED", toCurrency: "CHF", rate: 0.000001 }).ok).toBe(false);
  });

  it("accepts realistic USD, KWD and JPY rates", () => {
    expect(ok({ fromCurrency: "USD", rate: 3.6725 }).ok).toBe(true);
    expect(ok({ fromCurrency: "KWD", rate: 11.9 }).ok).toBe(true);
    expect(ok({ fromCurrency: "JPY", rate: 0.0245 }).ok).toBe(true);
  });
});

describe("normalizeEffectiveDate", () => {
  it("keeps a plain date at 00:00 UTC", () => {
    expect(normalizeEffectiveDate("2026-09-10")?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("drops the time part of a full timestamp", () => {
    expect(normalizeEffectiveDate("2026-09-10T17:45:00Z")?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("defaults to today (00:00 UTC) when absent", () => {
    const d = normalizeEffectiveDate(undefined);
    expect(d?.getUTCHours()).toBe(0);
    expect(Date.now() - (d?.getTime() ?? 0)).toBeLessThan(24 * 3600 * 1000);
  });

  it("rejects garbage", () => {
    expect(normalizeEffectiveDate("not-a-date")).toBeNull();
    expect(normalizeEffectiveDate(12345)).toBeNull();
  });
});

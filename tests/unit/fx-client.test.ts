import { describe, expect, it } from "vitest";
import { aedEquivalent, currencyPayload, parseRate, pickRate, type RateRow } from "../../client/src/lib/fx";
import { COMPANY_EMIRATE, defaultInvoiceEmirate, emirateValue, isEmirate } from "../../client/src/lib/emirates";

const rows: RateRow[] = [
  { fromCurrency: "USD", toCurrency: "AED", rate: "3.6725", effectiveDate: "2026-07-01", scope: "system" },
  { fromCurrency: "USD", toCurrency: "AED", rate: "3.6730", effectiveDate: "2026-09-01T00:00:00.000Z", scope: "company" },
  { fromCurrency: "USD", toCurrency: "AED", rate: "3.7", effectiveDate: "2026-10-15", scope: "company" },
  { fromCurrency: "AED", toCurrency: "EUR", rate: "0.25", effectiveDate: "2026-08-01", scope: "company" },
];

describe("pickRate", () => {
  it("takes the latest rate on or before the document date", () => {
    expect(pickRate(rows, "USD", "2026-08-20")).toMatchObject({ rate: 3.6725, date: "2026-07-01" });
    expect(pickRate(rows, "USD", "2026-09-01")).toMatchObject({ rate: 3.673, date: "2026-09-01" });
    expect(pickRate(rows, "USD", "2026-10-01")).toMatchObject({ rate: 3.673 });
  });
  it("ignores a rate set after the document date and gives null when there is none", () => {
    expect(pickRate(rows, "USD", "2026-06-30")).toBeNull();
    expect(pickRate(rows, "GBP", "2026-10-01")).toBeNull();
  });
  it("inverts a rate stored the other way round", () => {
    expect(pickRate(rows, "EUR", "2026-10-01")?.rate).toBe(4);
  });
  it("prefers the company's own rate over a system rate on the same day", () => {
    const same: RateRow[] = [
      { fromCurrency: "USD", toCurrency: "AED", rate: 3.6, effectiveDate: "2026-09-01", scope: "system" },
      { fromCurrency: "USD", toCurrency: "AED", rate: 3.7, effectiveDate: "2026-09-01", scope: "company" },
    ];
    expect(pickRate(same, "USD", "2026-09-30")?.rate).toBe(3.7);
  });
  it("needs no rate for AED", () => {
    expect(pickRate(rows, "AED", "2026-10-01")).toBeNull();
  });
});

describe("rate fields", () => {
  it("converts to AED to the fils", () => {
    expect(aedEquivalent(1000, 3.6725)).toBe(3672.5);
    expect(aedEquivalent(10, 0)).toBe(0);
  });
  it("parses typed rates", () => {
    expect(parseRate("3.6725")).toBe(3.6725);
    expect(parseRate("")).toBeNull();
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });
  it("sends rate 1 for AED, the typed rate for a foreign currency, none when it is missing", () => {
    expect(currencyPayload("AED", "")).toEqual({ currency: "AED", exchangeRate: 1 });
    expect(currencyPayload("USD", "3.67")).toEqual({ currency: "USD", exchangeRate: 3.67 });
    expect(currencyPayload("USD", "")).toEqual({ currency: "USD" });
  });
});

describe("emirates", () => {
  it("knows the seven emirates and nothing else", () => {
    expect(isEmirate("dubai")).toBe(true);
    expect(isEmirate("umm_al_quwain")).toBe(true);
    expect(isEmirate("Dubai")).toBe(false);
    expect(isEmirate(COMPANY_EMIRATE)).toBe(false);
  });
  it("sends null for the company's own emirate", () => {
    expect(emirateValue(COMPANY_EMIRATE)).toBeNull();
    expect(emirateValue("sharjah")).toBe("sharjah");
  });
  it("starts an invoice with the customer's emirate", () => {
    expect(defaultInvoiceEmirate({ emirate: "abu_dhabi" })).toBe("abu_dhabi");
    expect(defaultInvoiceEmirate({ emirate: null })).toBeNull();
    expect(defaultInvoiceEmirate(null)).toBeNull();
  });
});

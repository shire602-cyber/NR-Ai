/**
 * D2b (CTO checkpoint issues 1, 7): the one money formatter and the one display-date
 * formatter. English: `AED 8,922.33`; Arabic: `8,922.33 د.إ`; sign first, true minus,
 * Latin digits; dates `d MMM yyyy`, ranges collapse shared parts.
 */
import { describe, expect, it } from "vitest";
import {
  MINUS_SIGN,
  currencyLabel,
  formatMoneyParts,
  formatMoneyText,
  formatPercentDelta,
  stripBidiControls,
} from "../../client/src/lib/format-money";
import {
  displayObligationTitle,
  formatDate,
  formatDateRange,
  formatEmbeddedDates,
  formatMonthYear,
} from "../../client/src/lib/format-date";
import { formatCurrency } from "../../client/src/lib/format";

describe("formatMoneyParts", () => {
  it("English puts the currency code at the inline start", () => {
    const p = formatMoneyParts(8922.33, "AED", "en");
    expect(p).toMatchObject({
      sign: "",
      amount: "8,922.33",
      currency: "AED",
      currencyPosition: "start",
      dir: "ltr",
    });
  });

  it("Arabic uses د.إ after the number, Latin digits, no trailing dot", () => {
    const p = formatMoneyParts(8922.33, "AED", "ar");
    expect(p.amount).toBe("8,922.33");
    expect(p.currency).toBe("د.إ");
    expect(p.currencyPosition).toBe("end");
    expect(p.dir).toBe("rtl");
    expect(p.amount).not.toMatch(/[٠-٩]/);
  });

  it("negative amounts use a true minus before the digits", () => {
    const en = formatMoneyParts(-24000, "AED", "en");
    expect(en.sign).toBe(MINUS_SIGN);
    expect(en.amount).toBe("24,000.00");
    expect(en.isNegative).toBe(true);
    const ar = formatMoneyParts(-77765.65, "AED", "ar");
    expect(ar.sign).toBe("−");
    expect(ar.amount).toBe("77,765.65");
  });

  it("zero has no sign, even with signDisplay always, and -0 is zero", () => {
    expect(formatMoneyParts(0, "AED", "en", { signDisplay: "always" }).sign).toBe("");
    const negZero = formatMoneyParts(-0.001, "AED", "en");
    expect(negZero.sign).toBe("");
    expect(negZero.isZero).toBe(true);
    expect(negZero.amount).toBe("0.00");
  });

  it("signDisplay always marks positive variances with +", () => {
    expect(formatMoneyParts(32000, "AED", "en", { signDisplay: "always" }).sign).toBe("+");
  });

  it("foreign currencies keep their ISO code in both languages", () => {
    expect(formatMoneyParts(6400, "USD", "en").currency).toBe("USD");
    expect(formatMoneyParts(6400, "usd", "ar").currency).toBe("USD");
    expect(currencyLabel(undefined, "en")).toBe("AED");
  });
});

describe("formatMoneyText", () => {
  it("renders English as `AED 1,250.50`", () => {
    expect(stripBidiControls(formatMoneyText(1250.5, "AED", "en"))).toBe("AED 1,250.50");
    expect(stripBidiControls(formatMoneyText(-1250.5, "AED", "en"))).toBe("AED −1,250.50");
  });

  it("renders Arabic as `1,250.50 د.إ` wrapped in isolates", () => {
    const text = formatMoneyText(-1250.5, "AED", "ar");
    expect(stripBidiControls(text)).toBe("−1,250.50 د.إ");
    expect(text.startsWith("⁧")).toBe(true);
    expect(text).toContain("⁦−1,250.50⁩");
  });

  it("lib/format formatCurrency delegates to the same formatter", () => {
    expect(stripBidiControls(formatCurrency(6400, "USD", "en"))).toBe("USD 6,400.00");
    expect(stripBidiControls(formatCurrency(6400, "USD", "ar"))).toBe("6,400.00 USD");
    expect(formatCurrency(1, "AED", "ar")).not.toMatch(/US\$|د\.إ\./);
  });
});

describe("formatPercentDelta", () => {
  it("uses + / true minus with one decimal", () => {
    expect(formatPercentDelta(273.94)).toBe("+273.9%");
    expect(formatPercentDelta(-4.2)).toBe("−4.2%");
    expect(formatPercentDelta(0)).toBe("0.0%");
  });
});

describe("formatDate", () => {
  it("English is d MMM yyyy", () => {
    expect(formatDate("2026-11-16", "en")).toBe("16 Nov 2026");
    expect(formatDate(new Date(2026, 0, 5), "en")).toBe("5 Jan 2026");
  });

  it("Arabic uses ar-AE month names with Latin digits", () => {
    const text = formatDate("2026-11-16", "ar");
    expect(text).toMatch(/^16 \S+ 2026$/);
    expect(text).toContain("نوفمبر");
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it("reads YYYY-MM-DD as a calendar date (no time-zone shift)", () => {
    expect(formatDate("2026-01-01", "en")).toBe("1 Jan 2026");
  });

  it("returns an empty string for empty or invalid input", () => {
    expect(formatDate("", "en")).toBe("");
    expect(formatDate(null, "en")).toBe("");
    expect(formatDate("not a date", "en")).toBe("");
  });

  it("formatMonthYear gives month and year", () => {
    expect(formatMonthYear("2026-11-01", "en")).toBe("Nov 2026");
  });
});

describe("formatDateRange", () => {
  it("collapses a range inside one month: 1–16 Nov 2026", () => {
    expect(formatDateRange("2026-11-01", "2026-11-16", "en")).toBe("1–16 Nov 2026");
  });

  it("collapses a range inside one year: 28 Oct – 16 Nov 2026", () => {
    expect(formatDateRange("2026-10-28", "2026-11-16", "en")).toBe("28 Oct – 16 Nov 2026");
  });

  it("spells out both ends across years", () => {
    expect(formatDateRange("2025-12-28", "2026-01-03", "en")).toBe("28 Dec 2025 – 3 Jan 2026");
  });

  it("single day and open ends fall back to one date", () => {
    expect(formatDateRange("2026-11-16", "2026-11-16", "en")).toBe("16 Nov 2026");
    expect(formatDateRange(null, "2026-11-16", "en")).toBe("16 Nov 2026");
  });

  it("Arabic ranges keep Latin digits", () => {
    const text = formatDateRange("2026-11-01", "2026-11-16", "ar");
    expect(text).toMatch(/^1–16 \S+ 2026$/);
    expect(text).not.toMatch(/[٠-٩]/);
  });
});

describe("B6: machine dates inside server text", () => {
  it("formats compliance calendar titles in the firm practice period style", () => {
    expect(displayObligationTitle("VAT return 2026-07-01 to 2026-09-30", "en")).toBe(
      "VAT return, 1 Jul – 30 Sep 2026"
    );
    expect(displayObligationTitle("Corporate tax return FY 2026-01-01 to 2026-12-31", "en")).toBe(
      "Corporate tax return, 1 Jan – 31 Dec 2026"
    );
    expect(displayObligationTitle("Pay 2026-11 salaries through WPS", "en")).toBe(
      "Pay Nov 2026 salaries through WPS"
    );
    expect(displayObligationTitle("Renew trade licence (expires 2027-03-01)", "en")).toBe(
      "Renew trade licence (expires 1 Mar 2027)"
    );
    const ar = displayObligationTitle("إقرار ضريبة القيمة المضافة 2026-07-01 إلى 2026-09-30", "ar");
    expect(ar).toMatch(/^إقرار ضريبة القيمة المضافة، 1 \S+ – 30 \S+ 2026$/);
    expect(displayObligationTitle("دفع رواتب 2026-11 عبر نظام حماية الأجور", "ar")).not.toMatch(
      /\d{4}-\d{2}/
    );
    expect(displayObligationTitle("Register for corporate tax", "en")).toBe(
      "Register for corporate tax"
    );
  });

  it("leaves document numbers alone and formats free-standing dates", () => {
    expect(formatEmbeddedDates("Computed 2026-11-17", "en")).toBe("Computed 17 Nov 2026");
    expect(formatEmbeddedDates("Payroll 2026-11", "en")).toBe("Payroll Nov 2026");
    expect(formatEmbeddedDates("VAT return payment 2026-07-01 to 2026-09-30", "en")).toBe(
      "VAT return payment 1 Jul – 30 Sep 2026"
    );
    expect(formatEmbeddedDates("Invoice INV-2026-01 – Acme", "en")).toBe(
      "Invoice INV-2026-01 – Acme"
    );
    expect(formatEmbeddedDates("Ref 2026-11-17T10:00:00Z", "en")).toBe("Ref 2026-11-17T10:00:00Z");
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ISO_4217_CODES,
  ibanMod97Valid,
  luhnValid,
  parseIsoDate,
  sanitizePlainText,
  zAccountType,
  zCurrency,
  zDate,
  zDateIn,
  zEmail,
  zEmirate,
  zEmiratesId,
  zHttpsUrl,
  zIbanAE,
  zMoney,
  zMoneyFils,
  zMoneyPositive,
  zMoneySigned,
  zPeriodMonth,
  zPeriodYear,
  zQuantity,
  zSupplyType,
  zText,
  zTrn,
  zUuid,
  zVatRate,
} from "../../shared/validators/primitives";

const ok = <S extends z.ZodTypeAny>(s: S, v: unknown) => {
  const r = s.safeParse(v);
  if (!r.success) throw new Error(`expected success for ${JSON.stringify(v)}: ${r.error.message}`);
  return r.data as z.output<S>;
};
const bad = (s: z.ZodTypeAny, v: unknown) => expect(s.safeParse(v).success).toBe(false);

describe("money primitives", () => {
  it("zMoney canonicalises to 2dp strings and rejects garbage", () => {
    expect(ok(zMoney, "1234.5")).toBe("1234.50");
    expect(ok(zMoney, 0)).toBe("0.00");
    for (const v of ["-1", "1.001", "abc", NaN, Infinity, "10000000000000", null, {}])
      bad(zMoney, v);
  });
  it("positive / signed / fils variants", () => {
    bad(zMoneyPositive, 0);
    expect(ok(zMoneyPositive, "0.01")).toBe("0.01");
    expect(ok(zMoneySigned, "-5")).toBe("-5.00");
    expect(ok(zMoneyFils, "12.34")).toBe(1234);
  });
  it("zQuantity allows up to 4dp, non-negative", () => {
    expect(ok(zQuantity, "2.5")).toBe(2.5);
    expect(ok(zQuantity, 3)).toBe(3);
    for (const v of ["-1", "1.23456", "x", NaN, "1e3"]) bad(zQuantity, v);
  });
});

describe("date primitives", () => {
  it.each([
    "garbage",
    "2025-13-01",
    "2025-02-30",
    "2025-00-10",
    "11/13/2026",
    "13/11/2026",
    "2026-1-5",
    "1989-12-31",
    "9999-12-31",
    "",
    "2026-11-13T25:00:00Z",
  ])("zDate rejects %j", (v) => bad(zDate, v));

  it("zDate accepts real calendar dates and canonicalises", () => {
    expect(ok(zDate, "2024-02-29")).toBe("2024-02-29");
    expect(ok(zDate, "1990-01-01")).toBe("1990-01-01");
    expect(ok(zDate, "2026-03-15T10:30:00Z")).toBe("2026-03-15");
    expect(ok(zDate, new Date(Date.UTC(2025, 5, 1)))).toBe("2025-06-01");
    bad(zDate, new Date(NaN));
    bad(zDate, "2023-02-29");
  });

  it("zDateIn honours configurable range", () => {
    const today = new Date().toISOString().slice(0, 10);
    const noFuture = zDateIn({ maxDaysAhead: 0 });
    expect(ok(noFuture, today)).toBe(today);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    bad(noFuture, tomorrow);
    bad(zDateIn({ min: "2020-01-01" }), "2019-12-31");
  });

  it("parseIsoDate", () => {
    expect(parseIsoDate("2026-11-13")).toBe("2026-11-13");
    expect(parseIsoDate("11/13/2026")).toBeNull();
    expect(parseIsoDate(42)).toBeNull();
  });

  it("period month/year", () => {
    expect(ok(zPeriodMonth, "7")).toBe(7);
    for (const v of [0, 13, 1.5, "x"]) bad(zPeriodMonth, v);
    expect(ok(zPeriodYear, 2026)).toBe(2026);
    for (const v of [1989, 2101, "abc"]) bad(zPeriodYear, v);
  });
});

describe("identifier primitives", () => {
  it("zUuid", () => {
    expect(ok(zUuid, "3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
    );
    bad(zUuid, "not-a-uuid");
  });

  it("zTrn is exactly 15 digits", () => {
    expect(ok(zTrn, " 100123456700003 ")).toBe("100123456700003");
    for (const v of [
      "10012345670000",
      "1001234567000031",
      "10012345670000A",
      "100-1234-5670-0003",
    ]) {
      bad(zTrn, v);
    }
  });

  it("zIbanAE checks shape and mod-97", () => {
    expect(ok(zIbanAE, "ae07 0331 2345 6789 0123 456")).toBe("AE070331234567890123456");
    expect(ibanMod97Valid("AE070331234567890123456")).toBe(true);
    bad(zIbanAE, "AE080331234567890123456"); // wrong check digits
    bad(zIbanAE, "AE07033123456789012345"); // 20 digits
    bad(zIbanAE, "GB82WEST12345698765432"); // valid IBAN, not UAE
  });

  it("zEmiratesId checks 784 prefix, year and Luhn", () => {
    expect(ok(zEmiratesId, "784-1990-1234567-6")).toBe("784-1990-1234567-6");
    expect(ok(zEmiratesId, "784199012345676")).toBe("784-1990-1234567-6");
    expect(luhnValid("784199012345676")).toBe(true);
    bad(zEmiratesId, "784-1990-1234567-5"); // bad check digit
    bad(zEmiratesId, "785-1990-1234567-6"); // wrong prefix
    bad(zEmiratesId, "784-3000-1234567-6"); // future year
    bad(zEmiratesId, "784-1990-123456-6"); // too short
  });

  it("zCurrency uses the ISO 4217 list", () => {
    expect(ok(zCurrency, "aed")).toBe("AED");
    expect(ISO_4217_CODES).toContain("SAR");
    for (const v of ["XYZ", "US", "usdollar"]) bad(zCurrency, v);
  });
});

describe("enum primitives", () => {
  it("zEmirate has the seven emirates and no default", () => {
    expect(zEmirate.options).toHaveLength(7);
    expect(ok(zEmirate, "ras_al_khaimah")).toBe("ras_al_khaimah");
    bad(zEmirate, undefined);
    bad(zEmirate, "Dubai");
  });
  it("zVatRate is 0 or 5", () => {
    expect(ok(zVatRate, "5")).toBe(5);
    expect(ok(zVatRate, 0)).toBe(0);
    for (const v of [15, 5.5, -5]) bad(zVatRate, v);
  });
  it("zSupplyType and zAccountType", () => {
    expect(ok(zSupplyType, "reverse_charge")).toBe("reverse_charge");
    bad(zSupplyType, "standard");
    expect(ok(zAccountType, "income")).toBe("income");
    bad(zAccountType, "revenue");
  });
});

describe("text, url, email primitives", () => {
  it("zText strips tags and control chars, then enforces length", () => {
    expect(ok(zText(50), "  <b>Hello</b><script>x</script>\u0000 world ")).toBe("Hellox world");
    expect(sanitizePlainText("a < b and c > d")).toBe("a < b and c > d");
    expect(sanitizePlainText('<img src=x onerror="alert(1)">ok')).toBe("ok");
    bad(zText(3), "abcd");
    bad(zText(10, { min: 1 }), "<i></i>");
  });

  it("zHttpsUrl only allows https and raster data:image", () => {
    expect(ok(zHttpsUrl, "https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(ok(zHttpsUrl, "data:image/png;base64,iVBORw0KGgo=")).toBeTruthy();
    for (const v of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "http://example.com",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "//evil.com",
      "ftp://x",
      "not a url",
    ]) {
      bad(zHttpsUrl, v);
    }
  });

  it("zEmail trims and lower-cases", () => {
    expect(ok(zEmail, "  Alice@Example.COM ")).toBe("alice@example.com");
    bad(zEmail, "not-an-email");
  });
});

import { describe, expect, it } from "vitest";
import {
  parseVatAmount,
  vatBreakdown,
} from "../../client/src/components/marketing/phase/vat-calculator";

describe("public UAE VAT calculator", () => {
  it.each(["1,234.56", "١٬٢٣٤٫٥٦", "۱٬۲۳۴٫۵۶"])("parses %s in fils", (amount) => {
    expect(parseVatAmount(amount)).toBe(123456);
  });

  it.each(["", "-1", "5e2", "1,2", "1.234", "١٢٫٣٫٤", "1000000000000.01"])(
    "rejects malformed or out-of-range amount %j",
    (amount) => expect(parseVatAmount(amount)).toBeUndefined()
  );

  it("adds or extracts standard VAT and rounds to a fil", () => {
    const expected = { net: 10000, vat: 500, gross: 10500 };
    expect(vatBreakdown(10000, "add", "standard")).toEqual(expected);
    expect(vatBreakdown(10500, "extract", "standard")).toEqual(expected);
    expect(vatBreakdown(parseVatAmount("0.10")!, "add", "standard").vat).toBe(1);
    expect(vatBreakdown(parseVatAmount("0")!, "extract", "standard").vat).toBe(0);
  });

  it.each(["zero", "exempt"])("returns zero tax for the %s treatment", (taxClass) => {
    expect(vatBreakdown(10500, "extract", taxClass)).toEqual({
      net: 10500,
      vat: 0,
      gross: 10500,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  billQuantitySchema,
  billUnitPriceSchema,
  computeBillLines,
} from "../../server/services/bill-line-math";

const issueMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message;

describe("billQuantitySchema", () => {
  it("accepts the maximum and rejects anything above it with a clear message", () => {
    expect(billQuantitySchema.safeParse("9999999999.9999").success).toBe(true);
    const over = billQuantitySchema.safeParse(10_000_000_000);
    expect(over.success).toBe(false);
    expect(issueMessage(over as any)).toMatch(/quantity.*9,999,999,999\.9999/i);
  });

  it("rejects non-numeric strings and NaN", () => {
    expect(billQuantitySchema.safeParse("abc").success).toBe(false);
    expect(billQuantitySchema.safeParse(Number.NaN).success).toBe(false);
  });
});

describe("billUnitPriceSchema", () => {
  it("accepts the maximum and rejects anything above it", () => {
    expect(billUnitPriceSchema.safeParse("9999999999999.999999").success).toBe(true);
    const over = billUnitPriceSchema.safeParse(1e13);
    expect(over.success).toBe(false);
    expect(issueMessage(over as any)).toMatch(/unit price.*9,999,999,999,999\.999999/i);
  });

  it("rejects a value that only exceeds the cap after rounding to 6dp", () => {
    expect(billUnitPriceSchema.safeParse("9999999999999.9999996").success).toBe(false);
  });

  it("rejects negative overflow too", () => {
    expect(billUnitPriceSchema.safeParse(-1e13).success).toBe(false);
  });
});

describe("computeBillLines", () => {
  it("rounds unit price to 6dp and quantity to 4dp BEFORE computing the line amount", () => {
    const { lines } = computeBillLines([{ quantity: "1.23456", unit_price: "2.0000006", vat_rate: 5 }]);
    expect(lines[0].quantity).toBe("1.2346");
    expect(lines[0].unitPrice).toBe("2.000001");
    // 1.2346 * 2.000001 = 2.4692012346 -> 2.47
    expect(lines[0].amount).toBe("2.47");
  });

  it("uses exact decimal arithmetic (no float drift)", () => {
    // 0.1 * 3 = 0.30000000000000004 in floats; 1.005 * 100 = 100.49999999999999
    const { lines, subtotal } = computeBillLines([
      { quantity: 3, unit_price: 0.1, vat_rate: 0 },
      { quantity: 100, unit_price: 1.005, vat_rate: 0 },
    ]);
    expect(lines.map((l) => l.amount)).toEqual(["0.30", "100.50"]);
    expect(subtotal).toBe("100.80");
  });

  it("subtotal is the sum of the stored (rounded) line amounts and VAT is exact", () => {
    const { subtotal, vatAmount } = computeBillLines([
      { quantity: 1, unit_price: 33.335, vat_rate: 5 },
      { quantity: 1, unit_price: 33.335, vat_rate: 5 },
    ]);
    expect(subtotal).toBe("66.68"); // 33.34 + 33.34
    expect(vatAmount).toBe("3.33"); // 66.68 * 5% = 3.334
  });

  it("defaults a missing quantity to 1 and a missing VAT rate to the standard 5%", () => {
    const { lines, subtotal, vatAmount } = computeBillLines([{ unit_price: 100 }]);
    expect(lines[0].quantity).toBe("1.0000");
    expect(subtotal).toBe("100.00");
    expect(vatAmount).toBe("5.00");
  });

  it("keeps an explicit 0% line at zero VAT and reads 0.05 as 5%", () => {
    const { vatAmount } = computeBillLines([
      { quantity: 1, unit_price: 100, vat_rate: 0 },
      { quantity: 1, unit_price: 100, vat_rate: 0.05 },
    ]);
    expect(vatAmount).toBe("5.00");
  });
});

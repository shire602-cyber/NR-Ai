/**
 * R07-01: the shared UAE supply-classification truth table (shared/vat-classification.ts).
 */
import { describe, expect, it } from "vitest";
import {
  classifySupply,
  normaliseUaeVatRate,
  resolveSupplyType,
  SupplyClassificationError,
} from "../../shared/vat-classification";

describe("classifySupply truth table [R07-01]", () => {
  it.each([
    ["standard_rated", 0.05, false, "S", "standard", "standard_sales", 0.05, true],
    ["zero_rated", 0, false, "Z", "zero_rated", "zero_rated_sales", 0, true],
    ["exempt", 0, false, "E", "exempt", "exempt_sales", 0, true],
    ["out_of_scope", 0, false, "O", "out_of_scope", "out_of_scope_revenue", 0, false],
    ["reverse_charge", 0, false, "AE", "reverse_charge", "standard_sales", 0, true],
    ["standard_rated", 0.05, true, "AE", "reverse_charge", "standard_sales", 0, true],
  ] as const)(
    "%s @ %s (reverse charge %s) → %s / %s / %s",
    (supplyType, vatRate, reverseCharge, ubl, family, role, charged, reportable) => {
      const c = classifySupply({ supplyType, vatRate, reverseCharge });
      expect(c.ublCategory).toBe(ubl);
      expect(c.vat201Family).toBe(family);
      expect(c.revenueAccountRole).toBe(role);
      expect(c.chargedVatRate).toBe(charged);
      expect(c.reportable).toBe(reportable);
      if (ubl === "S") expect(c.exemptionReasonCode).toBeUndefined();
      else expect(c.exemptionReasonCode).toMatch(/^VATEX-AE-/);
    }
  );

  it("treats a legacy 0% row stored as standard_rated as zero-rated (listed by the drift script)", () => {
    expect(classifySupply({ supplyType: "standard_rated", vatRate: 0 }).supplyType).toBe(
      "zero_rated"
    );
    expect(classifySupply({ vatRate: 0 }).supplyType).toBe("zero_rated");
    expect(classifySupply({ vatRate: "0.05" }).supplyType).toBe("standard_rated");
  });
});

describe("resolveSupplyType (new input) [R07-01]", () => {
  it("derives standard_rated for 5% when omitted and requires an explicit type at 0%", () => {
    expect(resolveSupplyType({ vatRate: 5 })).toBe("standard_rated");
    expect(resolveSupplyType({ vatRate: 0.05 })).toBe("standard_rated");
    expect(() => resolveSupplyType({ vatRate: 0 })).toThrow(SupplyClassificationError);
    try {
      resolveSupplyType({ vatRate: 0 });
    } catch (e) {
      expect((e as SupplyClassificationError).code).toBe("SUPPLY_TYPE_REQUIRED");
    }
  });

  it("rejects a type that disagrees with the rate", () => {
    expect(() => resolveSupplyType({ supplyType: "exempt", vatRate: 5 })).toThrow(
      /must carry 0% VAT/
    );
    expect(() => resolveSupplyType({ supplyType: "standard_rated", vatRate: 0 })).toThrow(
      /must carry 5% VAT/
    );
    expect(resolveSupplyType({ supplyType: "out_of_scope", vatRate: 0 })).toBe("out_of_scope");
  });

  it("forces reverse_charge on a reverse-charge invoice", () => {
    expect(resolveSupplyType({ vatRate: 5, reverseCharge: true })).toBe("reverse_charge");
    expect(() =>
      resolveSupplyType({ supplyType: "exempt", vatRate: 0, reverseCharge: true })
    ).toThrow();
  });

  it("normalises 5 / 0.05 / '5' and rejects other rates", () => {
    expect(normaliseUaeVatRate(5)).toBe(0.05);
    expect(normaliseUaeVatRate("5")).toBe(0.05);
    expect(normaliseUaeVatRate(0)).toBe(0);
    expect(normaliseUaeVatRate(0.5)).toBeNull();
    expect(() => resolveSupplyType({ vatRate: 0.5 })).toThrow(/0% or 5%/);
  });
});

import { describe, it, expect } from "vitest";
import { deriveVatSupplyType, classifyVatLineForReturn } from "../../server/services/vat-supply-type";

describe("deriveVatSupplyType", () => {
  it("rate above zero is standard-rated", () => {
    expect(deriveVatSupplyType(0.05, undefined)).toBe("standard_rated");
    expect(deriveVatSupplyType(0.05, null)).toBe("standard_rated");
  });
  it("rate zero with no explicit type is stored as zero-rated", () => {
    expect(deriveVatSupplyType(0, undefined)).toBe("zero_rated");
    expect(deriveVatSupplyType(0, null)).toBe("zero_rated");
    expect(deriveVatSupplyType(0, "")).toBe("zero_rated");
  });
  it("never overrides an explicit exempt / out-of-scope / zero-rated value", () => {
    expect(deriveVatSupplyType(0, "exempt")).toBe("exempt");
    expect(deriveVatSupplyType(0, "out_of_scope")).toBe("out_of_scope");
    expect(deriveVatSupplyType(0, "zero_rated")).toBe("zero_rated");
  });
  it("the RATE decides: a taxed line is standard-rated even when exempt / out-of-scope was sent", () => {
    // A line that charges 5% VAT and is booked as exempt posts VAT Payable in
    // the ledger but drops out of the VAT 201 (both engines skip exempt lines).
    expect(deriveVatSupplyType(0.05, "exempt")).toBe("standard_rated");
    expect(deriveVatSupplyType(0.05, "out_of_scope")).toBe("standard_rated");
    expect(deriveVatSupplyType(0.05, "zero_rated")).toBe("standard_rated");
    expect(deriveVatSupplyType(0.05, "standard_rated")).toBe("standard_rated");
  });
  it("rate zero with standard_rated sent is zero-rated", () => {
    expect(deriveVatSupplyType(0, "standard_rated")).toBe("zero_rated");
  });
  it("a taxed (5%) line cannot be zero-rated: it is standard-rated", () => {
    expect(deriveVatSupplyType(0.05, "zero_rated")).toBe("standard_rated");
  });
  it("ignores unknown values", () => {
    expect(deriveVatSupplyType(0, "banana")).toBe("zero_rated");
    expect(deriveVatSupplyType(0.05, "banana")).toBe("standard_rated");
  });
});

describe("classifyVatLineForReturn (one rule for every VAT engine)", () => {
  it("VAT charged (rate > 0) is standard whatever the stored type", () => {
    for (const t of [undefined, null, "standard_rated", "zero_rated", "exempt", "out_of_scope"]) {
      expect(classifyVatLineForReturn({ rate: 0.05, supplyType: t })).toBe("standard");
    }
  });
  it("0% + out_of_scope is excluded from Boxes 1-5", () => {
    expect(classifyVatLineForReturn({ rate: 0, supplyType: "out_of_scope" })).toBe("excluded");
  });
  it("0% + exempt is exempt (Box 5)", () => {
    expect(classifyVatLineForReturn({ rate: 0, supplyType: "exempt" })).toBe("exempt");
  });
  it("any other 0% line is zero-rated (Box 4)", () => {
    for (const t of [undefined, null, "", "zero_rated", "standard_rated", "banana"]) {
      expect(classifyVatLineForReturn({ rate: 0, supplyType: t })).toBe("zero_rated");
    }
  });
  it("a missing rate is the standard rate, as every engine already treated it", () => {
    expect(classifyVatLineForReturn({ rate: null, supplyType: undefined })).toBe("standard");
  });
  it("accepts a numeric string rate (drizzle numeric columns)", () => {
    expect(classifyVatLineForReturn({ rate: "0.0500", supplyType: null })).toBe("standard");
    expect(classifyVatLineForReturn({ rate: "0.0000", supplyType: "exempt" })).toBe("exempt");
  });
});

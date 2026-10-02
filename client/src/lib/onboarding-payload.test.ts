import { describe, expect, it } from "vitest";
import { withoutBlankTrn } from "./onboarding-payload";

describe("withoutBlankTrn", () => {
  it("drops an empty TRN so it never overwrites the saved one", () => {
    expect(withoutBlankTrn({ name: "Acme", trnVatNumber: "" })).toEqual({ name: "Acme" });
  });

  it("drops a whitespace-only or missing TRN", () => {
    expect(withoutBlankTrn({ name: "Acme", trnVatNumber: "   " })).toEqual({ name: "Acme" });
    expect(withoutBlankTrn({ name: "Acme" })).toEqual({ name: "Acme" });
    expect(withoutBlankTrn({ name: "Acme", trnVatNumber: null })).toEqual({ name: "Acme" });
  });

  it("keeps a typed TRN, trimmed", () => {
    expect(withoutBlankTrn({ name: "Acme", trnVatNumber: " 100123456700003 " })).toEqual({ name: "Acme", trnVatNumber: "100123456700003" });
  });

  it("does not change the input object", () => {
    const input = { name: "Acme", trnVatNumber: "" };
    withoutBlankTrn(input);
    expect(input).toEqual({ name: "Acme", trnVatNumber: "" });
  });
});

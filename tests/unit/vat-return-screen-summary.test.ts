import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summariseVatReturns } from "../../client/src/lib/vat-filing-stage";

describe("summariseVatReturns", () => {
  it("does not count an amended (superseded) return in the total payable", () => {
    const s = summariseVatReturns([
      { status: "amended", box14PayableTax: 1000, paymentStatus: null },
      { status: "draft", box14PayableTax: 800, paymentStatus: null },
    ]);
    expect(s.total).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.totalPayable).toBe(800);
  });

  it("handles a missing list as an empty summary", () => {
    expect(summariseVatReturns(undefined).totalPayable).toBe(0);
  });
});

// Source check: the page is too heavy to render in a unit test; this pins that the
// failed-fetch screen uses the translated eyebrow and Arabic copy covers the TRN case.
describe("VAT filing screen Arabic copy", () => {
  const src = readFileSync("client/src/pages/VATFiling.tsx", "utf8");
  it("has no hardcoded English eyebrow", () => {
    expect(src).not.toMatch(/eyebrow="Compliance"/);
    expect(src).not.toMatch(/eyebrow=\{locale === "ar" \? "[^"]*" : "Compliance"\}/);
  });
  it("tells an Arabic user to add the TRN when it is missing", () => {
    expect(src).toContain("أضف رقم التسجيل الضريبي للشركة قبل إنشاء المسودات الرسمية");
  });
});

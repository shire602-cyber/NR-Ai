import { describe, expect, it } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";

// Tourism dirham, municipality fee and service charge are non-recoverable fees, never VAT. The
// parser used to read "Tourism tax 10.00" as the VAT line and booked 10.00 as input VAT.
function parse(text: string) {
  const r = parseReceiptOcrText(text, { fallbackDate: "2026-01-01" });
  return {
    subtotal: r.subtotal,
    vat: r.vatAmount,
    total: r.total,
    codes: r.validationIssues.map((i) => i.code).sort(),
  };
}

describe("fee lines are never read as VAT", () => {
  it("tourism tax only: 10.00 is not VAT (VAT is worked back from the net and flagged)", () => {
    const r = parse("Grand Hotel\nTourism tax 10.00\nTotal 110.00");
    expect(r.vat).not.toBe(10);
    expect(r.vat).toBe(4.76);
    expect(r.subtotal).toBe(95.24);
    expect(r.total).toBe(110);
    expect(r.codes).toContain("VAT_DERIVED");
    expect(r.codes).toContain("NON_VAT_FEE");
  });

  it("municipality fee only", () => {
    const r = parse("Cafe\nMunicipality fee 10.00\nTotal 110.00");
    expect(r.vat).not.toBe(10);
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.codes).toContain("VAT_DERIVED");
    expect(r.total).toBe(110);
  });

  it("VAT + tourism fee + service charge reconcile with no false mismatch", () => {
    const r = parse(
      "Grand Hotel\nSubtotal 100.00\nService charge 10.00\nVAT 5% 5.00\nTourism dirham fee 10.00\nTotal 125.00"
    );
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 125 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
  });

  it("subtotal, VAT, tourism fee, total", () => {
    const r = parse("Hotel\nSubtotal 100\nVAT 5\nTourism fee 10\nTotal 115");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 115 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
  });

  it("a VAT line with a tourism line before it keeps the genuine VAT", () => {
    const r = parse("Hotel\nTourism tax 10.00\nVAT 5.00\nTotal 115.00");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 115 });
  });

  it("a fee that does not add up still goes to review", () => {
    const r = parse("Hotel\nSubtotal 100\nVAT 5\nTourism fee 10\nTotal 200");
    expect(r.codes).toContain("AMOUNT_MISMATCH");
  });

  it("abbreviations and a rate-only service charge are fees", () => {
    const r = parse("Bar\nSubtotal 100\nSvc chg 10%\nVAT 5.00\nTotal 105.00");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    const m = parse("Hotel\nMunic. tax 4.00\nTDF 15.00\nTotal 119.00");
    expect(m.vat).not.toBe(4);
    expect(m.vat).not.toBe(15);
  });

  it("a VAT line that mentions a service charge stays a VAT line", () => {
    const r = parse("Cafe\nSubtotal 100\nVAT on service charge 5.00\nTotal 105.00");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    expect(r.codes).toEqual([]);
  });

  it("a receipt with no fees is unchanged", () => {
    const r = parse("Cafe\nSubtotal 100\nVAT 5\nTotal 105");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    expect(r.codes).toEqual([]);
  });
});

describe("Arabic fee lines are never read as VAT", () => {
  it("municipality tax only", () => {
    const r = parse("فندق\nضريبة البلدية 10.00\nالاجمالي 110.00");
    expect(r.vat).not.toBe(10);
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.codes).toContain("VAT_DERIVED");
    expect(r.total).toBe(110);
  });

  it("tourism dirham only, Arabic-Indic digits", () => {
    const r = parse("فندق\nدرهم السياحة ١٠٫٠٠\nالاجمالي ١١٠٫٠٠");
    expect(r.vat).not.toBe(10);
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.total).toBe(110);
  });

  it("hotel bill with a VAT line and a tourism dirham line", () => {
    const r = parse(
      "فندق\nالمجموع الفرعي 100.00\nض.ق.م 5.00\nدرهم السياحة 10.00\nرسوم الخدمة 10.00\nالاجمالي 125.00"
    );
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 125 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
  });

  it("full VAT label with tourism tax", () => {
    const r = parse(
      "فندق\nالمجموع الفرعي 100.00\nضريبة القيمة المضافة 5% 5.00\nضريبة السياحة 10.00\nالاجمالي 115.00"
    );
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 115 });
  });
});

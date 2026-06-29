import { describe, expect, it } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";

describe("parseReceiptOcrText", () => {
  it("extracts common UAE tax invoice fields from OCR text", () => {
    const result = parseReceiptOcrText(
      [
        "ACME TRADING LLC",
        "Tax Invoice No INV-1007",
        "TRN 100000000000003",
        "Date 15/06/2026",
        "Subtotal AED 100.00",
        "VAT 5% AED 5.00",
        "Grand Total AED 105.00",
      ].join("\n"),
      { fallbackDate: "2026-06-29" }
    );

    expect(result.merchant).toBe("ACME TRADING LLC");
    expect(result.invoiceNumber).toBe("INV-1007");
    expect(result.date).toBe("2026-06-15");
    expect(result.subtotal).toBe(100);
    expect(result.vatAmount).toBe(5);
    expect(result.total).toBe(105);
    expect(result.currency).toBe("AED");
  });

  it("derives subtotal and VAT when only the total is readable", () => {
    const result = parseReceiptOcrText("Metro Supplies\nTotal AED 210.00", {
      fallbackDate: "2026-06-29",
    });

    expect(result.merchant).toBe("Metro Supplies");
    expect(result.subtotal).toBe(200);
    expect(result.vatAmount).toBe(10);
    expect(result.total).toBe(210);
  });
});

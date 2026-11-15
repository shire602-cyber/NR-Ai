import { describe, expect, it } from "vitest";
import { parseReceiptOcrText, validateUaeTrn } from "../../shared/receipt-ocr-parser";
import {
  normalizeMerchantKey,
  toAsciiDigits,
  tokenizeMerchantText,
} from "../../shared/arabic-text";
import { normalizeMerchant } from "../../server/services/receipt-classifier.service";
import {
  BAND_LABELS,
  bandRequiresReview,
  receiptReviewDecision,
} from "../../shared/receipt-confidence";

const FALLBACK = { fallbackDate: "2026-11-15" };

describe("R05-12 Arabic digits and decimal separator", () => {
  it("R05-12 parses the 'ard' case: Eastern digits give total and date (not today)", () => {
    const r = parseReceiptOcrText("سبينيس\nالتاريخ ١٠/١١/٢٠٢٦\nالإجمالي ١٠٥٫٠٠ د.إ", FALLBACK);
    expect(r.total).toBe(105);
    expect(r.date).toBe("2026-11-10");
    expect(r.merchant).toBe("سبينيس");
    expect(r.currency).toBe("AED");
  });

  it("R05-12 converts digits and separators", () => {
    expect(toAsciiDigits("١٬٢٣٤٫٥٠")).toBe("1,234.50");
    expect(toAsciiDigits("۱۲۳")).toBe("123");
  });
});

describe("R05-16 Arabic labels and bilingual lines", () => {
  const arabic = [
    "سبينيس ذ.م.م",
    "فاتورة ضريبية",
    "الرقم الضريبي 100123456700003",
    "التاريخ 10/11/2026",
    "المجموع الفرعي 100.00",
    "ضريبة القيمة المضافة 5% 5.00",
    "الإجمالي 105.00 د.إ",
  ].join("\n");

  it("R05-16 extracts total, subtotal, VAT, TRN and tax-invoice flag from Arabic labels", () => {
    const r = parseReceiptOcrText(arabic, FALLBACK);
    expect(r.merchant).toBe("سبينيس ذ.م.م");
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
    expect(r.supplierTrn).toBe("100123456700003");
    expect(r.isTaxInvoice).toBe(true);
    expect(r.simplifiedInvoice).toBe(false);
    expect(r.date).toBe("2026-11-10");
  });

  it("R05-16 parses bilingual line items", () => {
    const r = parseReceiptOcrText(
      [
        "Cafe Beirut مقهى بيروت",
        "Coffee قهوة 2 x 10.00 20.00",
        "3 x كعك Cake 7.50",
        "Total 27.50",
      ].join("\n"),
      FALLBACK
    );
    expect(r.lineItems).toHaveLength(2);
    expect(r.lineItems[0]).toMatchObject({ quantity: 2, unitPrice: 10, total: 20 });
    expect(r.lineItems[0].description).toContain("قهوة");
    expect(r.lineItems[1]).toMatchObject({ quantity: 3, total: 7.5, unitPrice: 2.5 });
  });
});

describe("R05-17 FTA tax-invoice signals", () => {
  it("R05-17 flags simplified tax invoices and validates TRN format", () => {
    const r = parseReceiptOcrText(
      "Shop One\nSimplified Tax Invoice\nTRN 100123456700003\nTotal AED 105.00",
      FALLBACK
    );
    expect(r.isTaxInvoice).toBe(true);
    expect(r.simplifiedInvoice).toBe(true);
    expect(r.supplierTrn).toBe("100123456700003");
  });

  it("R05-17 rejects malformed TRN and reports why", () => {
    const r = parseReceiptOcrText("Shop One\nTRN 12345\nTotal AED 105.00", FALLBACK);
    expect(r.supplierTrn).toBeNull();
    expect(validateUaeTrn("12345").valid).toBe(false);
    expect(validateUaeTrn("200123456700003").issue).toMatch(/100/);
    expect(validateUaeTrn("100 1234 5670 0003").valid).toBe(true);
  });

  it("R05-17 suggests reverse charge for foreign supplier without TRN or VAT line", () => {
    const r = parseReceiptOcrText("Acme Cloud Inc\nInvoice INV-77\nTotal USD 120.00", FALLBACK);
    expect(r.currency).toBe("USD");
    expect(r.reverseChargeSuggested).toBe(true);
    const local = parseReceiptOcrText("Shop One\nTRN 100123456700003\nTotal AED 105.00", FALLBACK);
    expect(local.reverseChargeSuggested).toBe(false);
  });

  it("R05-17 honours explicit reverse-charge wording", () => {
    const r = parseReceiptOcrText("Supplier\nReverse charge applies\nTotal AED 100.00", FALLBACK);
    expect(r.reverseChargeSuggested).toBe(true);
  });
});

describe("R05-13 Arabic-aware merchant normaliser", () => {
  it("R05-13 keeps Arabic letters instead of emptying the key", () => {
    expect(normalizeMerchant("سبينيس ذ.م.م")).toBe("سبينيس");
    expect(normalizeMerchant("سبينيس")).not.toBe("");
  });

  it("R05-13 normalises alef/yeh/teh marbuta and strips tatweel and diacritics", () => {
    const a = normalizeMerchantKey("أَبوظبي للتعاونيّة");
    const b = normalizeMerchantKey("ابوظبي للتعاونيه");
    expect(a).toBe(b);
    expect(normalizeMerchantKey("مـــطعم")).toBe(normalizeMerchantKey("مطعم"));
  });

  it("R05-13 keeps Latin behaviour unchanged", () => {
    expect(normalizeMerchant("Acme Trading LLC")).toBe("acme");
    expect(normalizeMerchant("  Spinneys  ")).toBe("spinneys");
  });

  it("R05-13 tokenizes Arabic words for the statistical classifier", () => {
    expect(tokenizeMerchantText("مطعم الشام Cafe")).toEqual(["مطعم", "الشام", "cafe"]);
  });
});

describe("R05-22 parser regression found by the eval harness", () => {
  it("R05-22 reads the VAT amount, not the '5%' label, when the line is 'VAT 5% AED 11.50'", () => {
    const r = parseReceiptOcrText(
      "Spinneys LLC\nTax Invoice\nTRN 100123456700003\nSubtotal AED 230.00\nVAT 5% AED 11.50\nGrand Total AED 241.50",
      FALLBACK
    );
    expect(r.vatAmount).toBe(11.5);
    expect(r.subtotal).toBe(230);
    expect(r.total).toBe(241.5);
  });
});

describe("R05-23 receipt review helpers (en + ar)", () => {
  it("R05-23 every band has an English and an Arabic label", () => {
    for (const band of ["high", "review", "low"] as const) {
      expect(BAND_LABELS[band].en.length).toBeGreaterThan(3);
      expect(BAND_LABELS[band].ar).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("R05-23 only low-confidence receipts are held for explicit review", () => {
    expect(bandRequiresReview("low")).toBe(true);
    expect(bandRequiresReview("review")).toBe(false);
    expect(bandRequiresReview("high")).toBe(false);
    expect(bandRequiresReview(undefined)).toBe(false);
  });

  it("R05-23 the audit decision is 'accepted' when unchanged and 'corrected' when edited", () => {
    const original = {
      merchant: "Spinneys",
      date: "2026-11-10",
      total: 105,
      vatAmount: 5,
      category: "Meals",
    };
    expect(receiptReviewDecision(original, { ...original })).toBe("accepted");
    expect(receiptReviewDecision(original, { ...original, total: 106 })).toBe("corrected");
    expect(receiptReviewDecision(original, { ...original, category: "Other" })).toBe("corrected");
    expect(receiptReviewDecision(undefined, original)).toBe("corrected");
  });
});

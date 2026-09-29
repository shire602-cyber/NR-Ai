import { describe, it, expect } from "vitest";
import {
  containsArabic,
  normalizeDigits,
  layoutBidiLine,
  prepareRtlText,
} from "../../server/services/pdf-rtl";

describe("containsArabic", () => {
  it("detects Arabic script", () => {
    expect(containsArabic("فاتورة")).toBe(true);
    expect(containsArabic("Invoice ١٢٣")).toBe(true);
  });
  it("is false for Latin, digits, empty and non-strings", () => {
    expect(containsArabic("Invoice 123")).toBe(false);
    expect(containsArabic("")).toBe(false);
    expect(containsArabic(null)).toBe(false);
    expect(containsArabic(undefined)).toBe(false);
    expect(containsArabic(42)).toBe(false);
  });
});

describe("normalizeDigits", () => {
  it("converts Arabic-Indic and Persian digits to Western digits", () => {
    expect(normalizeDigits("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
    expect(normalizeDigits("۱۲۳")).toBe("123");
  });
});

describe("prepareRtlText (left-to-right reading order of the drawn line)", () => {
  it("returns empty string for empty, null and undefined", () => {
    expect(prepareRtlText("")).toBe("");
    expect(prepareRtlText(null)).toBe("");
    expect(prepareRtlText(undefined)).toBe("");
  });

  it("leaves pure Latin text untouched", () => {
    expect(prepareRtlText("Acme Trading LLC")).toBe("Acme Trading LLC");
  });

  it("leaves a string of only digits untouched", () => {
    expect(prepareRtlText("100123456700003")).toBe("100123456700003");
    expect(prepareRtlText("1,050.00")).toBe("1,050.00");
  });

  it("puts the first Arabic word on the RIGHT for pure Arabic", () => {
    expect(prepareRtlText("فاتورة ضريبية")).toBe("ضريبية فاتورة");
  });

  it("keeps Latin, digits and TRN in reading order inside an Arabic sentence", () => {
    // RTL paragraph: the Arabic words are right-most, the Latin run and the TRN
    // sit to their left in their original left-to-right order.
    expect(prepareRtlText("شركة الخليج LLC 100123456700003")).toBe(
      "LLC 100123456700003 الخليج شركة"
    );
  });

  it("keeps an English-led bilingual label left-to-right with the Arabic on the right", () => {
    expect(prepareRtlText("Invoice # / رقم الفاتورة")).toBe("Invoice # / الفاتورة رقم");
    expect(prepareRtlText("TRN / الرقم الضريبي: 100123456700003")).toBe(
      "TRN / الضريبي الرقم: 100123456700003"
    );
  });

  it("mirrors parentheses and keeps punctuation attached in Arabic text", () => {
    const out = prepareRtlText("شركة (تجريبية)، الإمارات");
    // Reading right to left: شركة ( تجريبية ) ، الإمارات  -> mirrored brackets
    expect(out).toBe("الإمارات ،(تجريبية) شركة");
  });

  it("does not reorder digits that follow Arabic text", () => {
    expect(prepareRtlText("المبلغ 1,050.00 AED")).toBe("1,050.00 AED المبلغ");
  });

  it("keeps a currency + amount together in reading order inside Arabic text", () => {
    expect(prepareRtlText("الإجمالي AED 1,050.00")).toBe("AED 1,050.00 الإجمالي");
  });

  it("keeps dates, invoice numbers and e-mails intact", () => {
    expect(prepareRtlText("فاتورة INV-2026-0042 بتاريخ 12/03/2026")).toBe(
      "12/03/2026 بتاريخ INV-2026-0042 فاتورة"
    );
    expect(prepareRtlText("البريد info@example.ae")).toBe("info@example.ae البريد");
  });

  it("converts Arabic-Indic digits to Western digits", () => {
    expect(prepareRtlText("رقم ١٢٣")).toBe("123 رقم");
  });

  it("strips directional marks", () => {
    expect(prepareRtlText("‏فاتورة")).toBe("فاتورة");
  });
});

describe("layoutBidiLine units", () => {
  it("marks Arabic words as arabic and Latin/digits as not", () => {
    const { units } = layoutBidiLine("شركة LLC");
    const arabic = units.filter((u) => u.arabic).map((u) => u.text);
    const other = units.filter((u) => !u.arabic).map((u) => u.text);
    expect(arabic).toEqual(["شركة"]);
    expect(other.join("")).toContain("LLC");
  });

  it("reports an RTL base level for Arabic-led text and LTR otherwise", () => {
    expect(layoutBidiLine("فاتورة").baseLevel).toBe(1);
    expect(layoutBidiLine("Invoice فاتورة").baseLevel).toBe(0);
  });
});

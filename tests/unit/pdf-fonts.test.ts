import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { registerFonts, text, isArabic, measureWidth } from "../../server/services/pdf-fonts";
import { pdfToText, collectPdf } from "./pdf-test-helpers";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");

async function render(draw: (doc: unknown) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  registerFonts(doc);
  const done = collectPdf(doc);
  draw(doc);
  doc.end();
  return done;
}

describe("pdf-fonts (R03-09)", () => {
  it("R03-09 isArabic detects Arabic script only", () => {
    expect(isArabic("فاتورة ضريبية")).toBe(true);
    expect(isArabic("Tax Invoice 123")).toBe(false);
    expect(isArabic("Invoice فاتورة")).toBe(true);
    expect(isArabic("")).toBe(false);
    expect(isArabic(null)).toBe(false);
  });

  it("R03-09 Arabic and Latin text round-trips through the PDF", async () => {
    const pdf = await render((doc) => {
      text(doc, "Tax Invoice / فاتورة ضريبية", { x: 40, y: 40, width: 500, size: 14 });
      text(doc, "شركة النجمة للتجارة", { x: 40, y: 80, width: 500, size: 14 });
    });
    const out = await pdfToText(pdf);
    expect(out).toContain("Tax Invoice");
    expect(out).toContain("فاتورة ضريبية");
    expect(out).toContain("شركة النجمة للتجارة");
  });

  it("R03-09 measureWidth is positive for Arabic and Latin", async () => {
    const doc = new PDFDocument({ size: "A4" });
    registerFonts(doc);
    expect(measureWidth(doc, "مرحبا", { size: 12 })).toBeGreaterThan(10);
    expect(measureWidth(doc, "Hello", { size: 12 })).toBeGreaterThan(10);
    doc.end();
  });

  it("R03-09 wraps long Arabic paragraphs onto several lines", async () => {
    const pdf = await render((doc) => {
      const res = text(
        doc,
        "هذه فقرة طويلة جدا باللغة العربية يجب أن تلتف على عدة أسطر في الصندوق",
        {
          x: 40,
          y: 40,
          width: 120,
          size: 12,
        }
      );
      expect(res.lines).toBeGreaterThan(2);
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

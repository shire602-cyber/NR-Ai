import { describe, it, expect } from "vitest";
import { generateInvoicePDF } from "../../server/services/pdf-invoice.service";
import { generateQuotePDF } from "../../server/services/pdf-quote.service";
import { generateCreditNotePDF } from "../../server/services/pdf-credit-note.service";
import { pdfToText, pdfWords } from "./pdf-test-helpers";
import type { Company } from "../../shared/schema";

const company = {
  id: "c1",
  name: "Najma Trading LLC",
  locale: "en",
  trnVatNumber: "100123456700003",
  businessAddress: "Office 12, Business Bay, Dubai",
} as unknown as Company;

const line = { id: "l1", description: "Consulting", quantity: 2, unitPrice: 100, vatRate: 0.05 };
const base = {
  number: "X-1",
  customerName: "Acme",
  date: new Date("2026-03-10"),
  currency: "AED",
  subtotal: 200,
  vatAmount: 10,
  total: 210,
};

// Rotated text is extracted by poppler either as a whole word or one glyph per word.
async function stamps(pdf: Buffer): Promise<{ en: boolean; ar: boolean }> {
  const set = new Set((await pdfWords(pdf)).map((w) => w.text));
  const all = (letters: string[]) => letters.every((l) => set.has(l));
  const arabic = (await pdfToText(pdf)).normalize("NFKC").replace(/\s+/g, "");
  return {
    en: set.has("DRAFT") || all(["D", "R", "A", "F", "T"]),
    ar: arabic.includes("مسودة") || arabic.includes("ةدوسم"),
  };
}

// X6d: a draft PDF must carry the DRAFT / مسودة watermark; an issued one must not.
describe("X6d draft watermark on PDFs", { timeout: 60_000 }, () => {
  it("invoice: draft is watermarked, sent is not", async () => {
    const draft = await stamps(
      await generateInvoicePDF({ ...base, status: "draft" } as never, [line] as never, company)
    );
    const sent = await stamps(
      await generateInvoicePDF({ ...base, status: "sent" } as never, [line] as never, company)
    );
    expect(draft).toEqual({ en: true, ar: true });
    expect(sent).toEqual({ en: false, ar: false });
  });

  it("invoice: cancelled and void are stamped VOID / ملغاة, never DRAFT", async () => {
    for (const status of ["cancelled", "void"]) {
      const pdf = await generateInvoicePDF({ ...base, status } as never, [line] as never, company);
      const set = new Set((await pdfWords(pdf)).map((w) => w.text));
      const arabic = (await pdfToText(pdf)).normalize("NFKC").replace(/\s+/g, "");
      expect(set.has("VOID") || ["V", "O", "I", "D"].every((l) => set.has(l))).toBe(true);
      expect(arabic.includes("ملغاة") || arabic.includes("ةاغلم")).toBe(true);
      expect(set.has("DRAFT")).toBe(false);
    }
  });

  it("quote and credit note: draft watermarked, issued not", async () => {
    for (const [status, expected] of [
      ["draft", true],
      ["issued", false],
    ] as const) {
      const q = await stamps(
        await generateQuotePDF({ ...base, status } as never, [line] as never, company)
      );
      const c = await stamps(
        await generateCreditNotePDF({ ...base, status } as never, [line] as never, company)
      );
      expect(q).toEqual({ en: expected, ar: expected });
      expect(c).toEqual({ en: expected, ar: expected });
    }
  });
});

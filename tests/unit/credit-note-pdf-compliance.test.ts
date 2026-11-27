// Tax credit note PDF compliance: reference invoice, and for a foreign-currency credit note the
// posted booking rate and the VAT in AED (never a fresh rate lookup).
import { describe, expect, it } from "vitest";
import { generateCreditNotePDF } from "../../server/services/pdf-credit-note.service";
import { hasEnglishStamp, pdfToText, pdfWords } from "./pdf-test-helpers";
import type { Company, Invoice } from "../../shared/schema";

const company = (locale = "en") =>
  ({
    id: "c1",
    name: "Najma Trading LLC",
    locale,
    trnVatNumber: "100123456700003",
    businessAddress: "Office 12, Business Bay, Dubai",
  }) as unknown as Company;

const creditNote = (currency: string) =>
  ({
    id: "cn1",
    number: "CN-7",
    customerName: "Acme",
    customerAddress: "Shop 4, Deira, Dubai",
    date: new Date("2026-03-10"),
    reason: "Returned goods",
    status: "issued",
    currency,
    subtotal: 350,
    vatAmount: 17.5,
    total: 367.5,
  }) as never;
const line = { id: "l1", description: "Services", quantity: 1, unitPrice: 350, vatRate: 0.05 };
const original = {
  id: "i1",
  number: "INV-4242",
  date: new Date("2026-01-20"),
} as unknown as Invoice;
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("credit note PDF compliance", { timeout: 30_000 }, () => {
  it("AED credit note shows the reference invoice number and no FX rows", async () => {
    const text = flat(
      await pdfToText(
        await generateCreditNotePDF(creditNote("AED"), [line] as never, company(), original)
      )
    );
    expect(text).toContain("INV-4242");
    expect(text).toContain("20 Jan 2026");
    expect(text).toContain("Shop 4, Deira, Dubai");
    expect(text).not.toContain("Exchange rate");
    expect(text).not.toContain("VOID");
  });

  it("prints original, corrected and difference values (USD with the AED equivalents)", async () => {
    const text = flat(
      await pdfToText(
        await generateCreditNotePDF(
          creditNote("USD"),
          [line] as never,
          company(),
          original,
          { baseCurrency: "AED", exchangeRate: 3.6725, vatBase: 64.27 },
          {
            currency: "USD",
            originalNet: 700,
            correctedNet: 350,
            differenceNet: 350,
            base: {
              currency: "AED",
              originalNet: 2570.75,
              correctedNet: 1285.37,
              differenceNet: 1285.38,
            },
          }
        )
      )
    );
    expect(text).toContain("Original value of the supply");
    expect(text).toContain("USD 700.00 (AED 2,570.75)");
    expect(text).toContain("USD 350.00 (AED 1,285.37)");
    expect(text).toContain("USD 350.00 (AED 1,285.38)");
  });

  it("stamps a voided credit note VOID", async () => {
    const voided = { ...(creditNote("AED") as object), status: "void" } as never;
    const pdf = await generateCreditNotePDF(voided, [line] as never, company(), original);
    expect(await hasEnglishStamp(pdf, "VOID")).toBe(true);
    // The Arabic stamp agrees with the masculine noun (إشعار): ملغى. Rotated Arabic only extracts
    // reliably with poppler (CI); xpdf on a developer machine has no -bbox, so skip it there.
    if (
      await pdfWords(pdf).then(
        () => true,
        () => false
      )
    ) {
      const arabic = (await pdfToText(pdf)).normalize("NFKC").replace(/\s+/g, "");
      expect(arabic.includes("ملغى") || arabic.includes("ىغلم")).toBe(true);
      expect(arabic.includes("ملغاة") || arabic.includes("ةاغلم")).toBe(false);
    }
  });

  it("USD credit note shows the reference invoice, the posted rate and the AED VAT", async () => {
    const pdf = await generateCreditNotePDF(
      creditNote("USD"),
      [line] as never,
      company(),
      original,
      { baseCurrency: "AED", exchangeRate: 3.6725, vatBase: 64.27 }
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("INV-4242");
    expect(text).toContain("1 USD = 3.6725 AED");
    expect(text).toContain("AED 64.27");
    expect(text).toContain("VAT total (AED)");
    expect(text).toContain("Exchange rate");
  });

  // pdftotext returns shaped Arabic words letter by letter in visual order, so a whole label is
  // not searchable. The Arabic rows are proven by letters that appear only in them ("سعر الصرف"
  // has ص and ف; "إجمالي الضريبة" has ض): the foreign credit note must carry more of each than the
  // same credit note in AED.
  it("Arabic labels for the rate and AED VAT rows are present", async () => {
    const count = (text: string, ch: string) => text.split(ch).length - 1;
    const render = async (fx: boolean) =>
      pdfToText(
        await generateCreditNotePDF(
          creditNote(fx ? "USD" : "AED"),
          [line] as never,
          company("ar"),
          original,
          fx ? { baseCurrency: "AED", exchangeRate: 3.6725, vatBase: 64.27 } : null
        )
      );
    const [withFx, without] = [await render(true), await render(false)];
    expect(withFx).toContain("INV-4242");
    for (const ch of ["ص", "ف", "ض", "س"]) {
      expect(count(withFx, ch)).toBeGreaterThan(count(without, ch));
    }
    expect(count(withFx, "ج")).toBeGreaterThan(count(without, "ج"));
  });
});

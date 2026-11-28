import { describe, it, expect, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  generateInvoicePDF,
  computeInvoicePdfTotals,
  vatTreatmentForLine,
} from "../../server/services/pdf-invoice.service";
import { bilingual } from "../../server/services/pdf-fonts";
import { pdfToText, pdfWords } from "./pdf-test-helpers";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1",
    name: "Najma Trading LLC",
    locale: "en",
    trnVatNumber: "100123456700003",
    businessAddress: "Office 12, Business Bay, Dubai",
    companyType: "standard",
    ...overrides,
  } as unknown as Company;
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "i1",
    companyId: "c1",
    number: "INV-1001",
    customerName: "شركة النجمة للتجارة",
    customerTrn: "100999888700003",
    customerAddress: "دبي، الإمارات العربية المتحدة",
    date: new Date("2026-03-10T00:00:00Z"),
    dueDate: new Date("2026-04-09T00:00:00Z"),
    paymentTerms: "net30",
    currency: "AED",
    exchangeRate: 1,
    subtotal: 1500,
    vatAmount: 75,
    total: 1575,
    status: "sent",
    reverseCharge: false,
    ...overrides,
  } as unknown as Invoice;
}

function lines(): InvoiceLine[] {
  return [
    {
      id: "l1",
      invoiceId: "i1",
      description: "خدمات استشارية محاسبية",
      quantity: 1,
      unitPrice: 1000,
      vatRate: 0.05,
      vatSupplyType: "standard_rated",
    },
    {
      id: "l2",
      invoiceId: "i1",
      description: "Export consulting",
      quantity: 1,
      unitPrice: 500,
      vatRate: 0,
      vatSupplyType: "zero_rated",
    },
  ] as unknown as InvoiceLine[];
}

async function sellerPdfText(pdf: Buffer): Promise<string> {
  const document = getDocument({ data: Uint8Array.from(pdf) });
  try {
    const firstPage = await (await document.promise).getPage(1);
    const content = await firstPage.getTextContent();
    return content.items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join(" ")
      .replace(/\p{Cc}/gu, "")
      .replace(/\s+/g, " ");
  } finally {
    await document.destroy();
  }
}

// Arabic font embedding takes ~4 s per PDF under v8 coverage on a 4-core runner.
describe("pdf invoice content", { timeout: 30_000 }, () => {
  it("R03-09 Arabic customer, labels and line descriptions round-trip", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company());
    const text = await pdfToText(pdf);
    expect(text).toContain("Tax invoice");
    expect(text).not.toContain("Scan to view");
    expect(text).toContain("فاتورة ضريبية");
    expect(text).toContain("رقم الفاتورة");
    expect(text).toContain("شركة النجمة للتجارة");
    expect(text).toContain("خدمات استشارية محاسبية");
    const flat = text.replace(/\s+/g, " ");
    for (const word of ["دبي", "الإمارات", "العربية", "المتحدة"]) expect(flat).toContain(word);
  });

  it("R03-15 paid invoice shows Amount due 0.00 and a paid-in-full line", async () => {
    const pdf = await generateInvoicePDF(invoice({ status: "paid" }), lines(), company());
    const text = await pdfToText(pdf);
    expect(text.replace(/\s+/g, " ")).toMatch(/Amount due[^0-9]*AED 0\.00/);
    expect(text).toContain("Paid in full");
  });

  it("R03-15 partial payments reduce the amount due", () => {
    const totals = computeInvoicePdfTotals(invoice({ status: "partial" }), { amountPaid: 575 });
    expect(totals.amountDue).toBe(1000);
    expect(totals.paid).toBe(false);
    expect(computeInvoicePdfTotals(invoice({ status: "sent" })).amountDue).toBe(1575);
    expect(computeInvoicePdfTotals(invoice(), { amountPaid: 99999 }).amountDue).toBe(0);
  });

  it("R03-15 per-line VAT amount, rate and supply date are present", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company());
    const text = (await pdfToText(pdf)).replace(/\s+/g, " ");
    expect(text).toContain("VAT amount");
    expect(text).toContain("50.00"); // 5% of 1,000
    expect(text).toContain("5%");
    expect(text).toContain("0%");
    expect(text).toContain("Date of supply");
    // supply date falls back to the invoice date
    expect((text.match(/10 Mar 2026/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("R03-15 explicit supply date is printed", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company(), {
      supplyDate: new Date("2026-03-05T00:00:00Z"),
    });
    expect(await pdfToText(pdf)).toContain("5 Mar 2026");
  });

  it("R03-19 VAT treatment labels per line", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company());
    const text = (await pdfToText(pdf)).replace(/\s+/g, " ");
    expect(text).toContain("Standard rated");
    expect(text).toContain("Zero-rated");
    expect(vatTreatmentForLine({ vatRate: 0.05, vatSupplyType: "exempt" })).toBe("exempt");
    expect(vatTreatmentForLine({ vatRate: 0, vatSupplyType: "standard_rated" })).toBe("zero_rated");
    expect(vatTreatmentForLine({ vatRate: 0.05, vatSupplyType: null })).toBe("standard_rated");
    expect(vatTreatmentForLine({ vatRate: 0, vatSupplyType: "out_of_scope" })).toBe("out_of_scope");
    expect(vatTreatmentForLine({ vatRate: 0.05 }, true)).toBe("reverse_charge");
  });

  it("R03-19 foreign-currency invoice prints AED VAT total and customer fallbacks", async () => {
    const usd = invoice({
      currency: "USD",
      exchangeRate: 3.6725,
      customerAddress: null,
      customerTrn: null,
      subtotal: 100,
      vatAmount: 5,
      total: 105,
    });
    const pdf = await generateInvoicePDF(usd, lines().slice(0, 1), company(), {
      customer: { address: "Sheikh Zayed Road, Dubai", trn: "100555444400003" },
      postedVatAed: null,
    });
    const text = (await pdfToText(pdf)).replace(/\s+/g, " ");
    expect(text).toContain("VAT total (AED)");
    expect(text).toContain("AED 18.36");
    expect(text).toContain("USD 105.00");
    expect(text).toContain("Sheikh Zayed Road, Dubai");
    expect(text).toContain("100555444400003");
  });

  it("prints the POSTED AED VAT, not vat x rate, on a foreign-currency invoice", async () => {
    // 1.00 USD VAT at 3.6725 is 3.6725 -> 3.67 by rate, but the ledger posted 3.68 (line-level
    // rounding): the PDF must tie to the GL and the VAT 201.
    const usd = invoice({
      currency: "USD",
      exchangeRate: 3.6725,
      subtotal: 20,
      vatAmount: 1,
      total: 21,
    });
    expect(computeInvoicePdfTotals(usd, { postedVatAed: null }).vatAed).toBe(3.67);
    expect(computeInvoicePdfTotals(usd, { postedVatAed: 3.68 }).vatAed).toBe(3.68);
    const pdf = await generateInvoicePDF(usd, lines().slice(0, 1), company(), {
      postedVatAed: 3.68,
    });
    const text = (await pdfToText(pdf)).replace(/\s+/g, " ");
    expect(text).toContain("AED 3.68");
    expect(text).not.toContain("AED 3.67");
  });

  it("R03-19 reverse-charge invoice labels lines as reverse charge", async () => {
    const pdf = await generateInvoicePDF(invoice({ reverseCharge: true }), lines(), company());
    expect((await pdfToText(pdf)).replace(/\s+/g, " ")).toContain("Reverse charge");
  });

  it.each(["en", "ar"] as const)(
    "uses seller legal identity and a share QR in the %s layout",
    async (locale) => {
      const pdf = await generateInvoicePDF(
        invoice({ shareToken: "shared-invoice" }),
        lines(),
        company({
          name: "Seller Display Name",
          legalName: "Pearl Commercial LLC",
          legalNameAr: "شركة اللؤلؤة للتجارة",
          addressAr: "شارع السعادة",
          companyType: "client",
          trnVatNumber: null,
          locale,
        })
      );
      const text = await sellerPdfText(pdf);
      const compact = text.replace(/\s/g, "");
      for (const value of ["Pearl Commercial LLC", "شركة اللؤلؤة للتجارة", "شارع السعادة"]) {
        expect(compact.split(value.replace(/\s/g, "")), value).toHaveLength(3);
      }
      expect(text).not.toContain("Seller Display Name");
      expect(text).not.toContain("NAJMA AL RAEDA");
      expect(text).toContain("Scan to view");
    }
  );

  it("R14-21 ar-locale company gets Arabic-first labels and a mirrored table", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company({ locale: "ar" } as never));
    const text = (await pdfToText(pdf)).replace(/\s+/g, " ");
    expect(text).toContain("فاتورة ضريبية");
    expect(text).toContain("المبلغ المستحق");
    expect(bilingual("ar", "Tax Invoice", "فاتورة ضريبية")).toBe("فاتورة ضريبية / Tax Invoice");
    const words = await pdfWords(pdf);
    const description = words.find((w) => w.text.startsWith("Description"))!;
    const total = words.find(
      (w) => w.text.startsWith("Total") && Math.abs(w.yMin - description.yMin) < 3
    )!;
    expect(description.xMin).toBeGreaterThan(total.xMin);
  });

  it("R14-21 en-locale company keeps English-first labels and left-to-right table", async () => {
    const pdf = await generateInvoicePDF(invoice(), lines(), company());
    expect(bilingual("en", "Tax Invoice", "فاتورة ضريبية")).toBe("Tax Invoice / فاتورة ضريبية");
    const words = await pdfWords(pdf);
    const description = words.find((w) => w.text.startsWith("Description"))!;
    const total = words.find(
      (w) => w.text.startsWith("Total") && Math.abs(w.yMin - description.yMin) < 3
    )!;
    expect(description.xMin).toBeLessThan(total.xMin);
  });

  it("R03-09 NRA template renders an Arabic customer name", async () => {
    vi.stubEnv("NRA_INVOICE_ISSUER_COMPANY_ID", "firm-issuer");
    try {
      const pdf = await generateInvoicePDF(
        invoice({ companyId: "firm-issuer" }),
        lines(),
        company({ id: "firm-issuer", trnVatNumber: null })
      );
      const text = await sellerPdfText(pdf);
      expect(text).toContain("NAJMA AL RAEDA");
      expect(text.replace(/\s/g, "")).toContain("شركةالنجمةللتجارة");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Arabic seller identity on sales PDFs", { timeout: 60_000 }, () => {
  const arabicLetters = (value: string) => (value.match(/[ء-ي]/g) ?? []).length;
  const withArabic = () =>
    company({
      locale: "ar",
      legalName: "Najma Trading LLC",
      legalNameAr: "شركة النجمة للتجارة ذ.م.م",
      businessAddress: "Office 12, Business Bay, Dubai",
      addressAr: "مكتب 12، الخليج التجاري، دبي",
    } as never);
  const withoutArabic = () =>
    company({
      locale: "ar",
      legalName: "Najma Trading LLC",
      businessAddress: "Office 12, Business Bay, Dubai",
    } as never);

  it("sellerIdentity puts the Arabic name and address first on an Arabic document", async () => {
    const { sellerIdentity } = await import("../../server/services/pdf-ledger");
    const c = withArabic() as never as Parameters<typeof sellerIdentity>[0];
    expect(sellerIdentity(c, "ar")).toEqual({
      name: "شركة النجمة للتجارة ذ.م.م",
      otherNames: ["Najma Trading LLC"],
      addresses: ["مكتب 12، الخليج التجاري، دبي", "Office 12, Business Bay, Dubai"],
    });
    expect(sellerIdentity(c, "en").name).toBe("Najma Trading LLC");
  });

  it("delivery note prints the Arabic company name and address on an Arabic document", async () => {
    const { generateDeliveryNotePDF } = await import("../../server/services/pdf-invoice.service");
    const withAr = await sellerPdfText(
      await generateDeliveryNotePDF(invoice(), lines(), withArabic())
    );
    const without = await sellerPdfText(
      await generateDeliveryNotePDF(invoice(), lines(), withoutArabic())
    );
    // "شركة النجمة للتجارة ذ.م.م" + "مكتب 12، الخليج التجاري، دبي" add ~35 Arabic letters.
    expect(arabicLetters(withAr) - arabicLetters(without)).toBeGreaterThanOrEqual(30);
  });

  it("credit note and quote print the Arabic company name and address", async () => {
    const { generateCreditNotePDF } = await import("../../server/services/pdf-credit-note.service");
    const { generateQuotePDF } = await import("../../server/services/pdf-quote.service");
    const base = {
      number: "X-1",
      date: new Date("2026-03-10T00:00:00Z"),
      customerName: "عميل",
      currency: "AED",
      subtotal: 100,
      vatAmount: 5,
      total: 105,
      status: "issued",
    };
    const line = [{ description: "خدمة", quantity: 1, unitPrice: 100, vatRate: 0.05 }] as never;
    for (const generate of [generateCreditNotePDF, generateQuotePDF] as const) {
      const withAr = await sellerPdfText(await generate(base as never, line, withArabic()));
      const without = await sellerPdfText(await generate(base as never, line, withoutArabic()));
      expect(arabicLetters(withAr) - arabicLetters(without)).toBeGreaterThanOrEqual(30);
    }
  });
});

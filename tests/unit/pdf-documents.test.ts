import { describe, it, expect } from "vitest";
import { generateCreditNotePDF } from "../../server/services/pdf-credit-note.service";
import { generateQuotePDF } from "../../server/services/pdf-quote.service";
import { generatePurchaseOrderPDF } from "../../server/services/pdf-purchase-order.service";
import { pdfToText } from "./pdf-test-helpers";
import type { Company } from "../../shared/schema";

const company = (locale = "en") =>
  ({
    id: "c1",
    name: "Najma Trading LLC",
    locale,
    trnVatNumber: "100123456700003",
    businessAddress: "Office 12, Business Bay, Dubai",
    contactPhone: "+971500000000",
    contactEmail: "info@example.ae",
  }) as unknown as Company;

const line = {
  id: "l1",
  description: "خدمات استشارية محاسبية",
  quantity: 2,
  unitPrice: 100,
  vatRate: 0.05,
};

const flat = (s: string) => s.replace(/\s+/g, " ");

// Arabic font embedding takes ~4 s per PDF under v8 coverage on a 4-core runner.
describe("pdf credit note / quote / purchase order (R03-09, R14-21)", { timeout: 30_000 }, () => {
  it("R03-09 credit note renders Arabic customer, reason and line text", async () => {
    const pdf = await generateCreditNotePDF(
      {
        id: "cn1",
        number: "CN-1",
        customerName: "شركة النجمة للتجارة",
        customerTrn: "100999888700003",
        date: new Date("2026-03-10"),
        reason: "إرجاع بضاعة",
        status: "issued",
        currency: "AED",
        subtotal: 200,
        vatAmount: 10,
        total: 210,
      } as never,
      [line] as never,
      company()
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("CREDIT NOTE");
    expect(text).toContain("إشعار دائن");
    expect(text).toContain("شركة النجمة للتجارة");
    expect(text).toContain("إرجاع بضاعة");
    expect(text).toContain("خدمات استشارية محاسبية");
    expect(text).toContain("AED 210.00");
  });

  it("R03-09 quote renders Arabic customer, notes and line text", async () => {
    const pdf = await generateQuotePDF(
      {
        id: "q1",
        number: "Q-1",
        customerName: "مؤسسة الأفق",
        date: new Date("2026-03-10"),
        expiryDate: new Date("2026-04-10"),
        status: "sent",
        currency: "AED",
        subtotal: 200,
        vatAmount: 10,
        total: 210,
        notes: "الدفع خلال ثلاثين يوما",
      } as never,
      [line] as never,
      company()
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("QUOTATION");
    expect(text).toContain("عرض سعر");
    expect(text).toContain("مؤسسة الأفق");
    expect(text).toContain("الدفع خلال ثلاثين يوما");
    expect(text).toContain("خدمات استشارية محاسبية");
  });

  it("R03-09 purchase order renders Arabic vendor and line text", async () => {
    const pdf = await generatePurchaseOrderPDF(
      {
        id: "po1",
        number: "PO-1",
        vendorName: "مورد المواد الكهربائية",
        date: new Date("2026-03-10"),
        expectedDeliveryDate: new Date("2026-03-30"),
        status: "approved",
        currency: "AED",
        subtotal: 200,
        vatAmount: 10,
        total: 210,
      } as never,
      [line] as never,
      company()
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("PURCHASE ORDER");
    expect(text).toContain("أمر شراء");
    expect(text).toContain("مورد المواد الكهربائية");
    expect(text).toContain("خدمات استشارية محاسبية");
  });

  it("R14-21 ar-locale company gets Arabic-first quote title", async () => {
    const pdf = await generateQuotePDF(
      {
        id: "q1",
        number: "Q-1",
        customerName: "Customer",
        date: new Date("2026-03-10"),
        status: "sent",
        currency: "AED",
        subtotal: 0,
        vatAmount: 0,
        total: 0,
      } as never,
      [] as never,
      company("ar")
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("عرض سعر");
    expect(text).toContain("QUOTATION");
  });

  it("WP10: quote, purchase order and credit note print amounts with thousands separators", async () => {
    const bigLine = { ...line, quantity: 3, unitPrice: 4115.17 }; // 12,345.51
    const totals = { currency: "AED", subtotal: 12345.51, vatAmount: 617.28, total: 12962.79 };
    const docs = [
      await generateQuotePDF(
        {
          id: "q2",
          number: "Q-2",
          customerName: "C",
          date: new Date("2026-03-10"),
          status: "sent",
          ...totals,
        } as never,
        [bigLine] as never,
        company()
      ),
      await generatePurchaseOrderPDF(
        {
          id: "po2",
          number: "PO-2",
          vendorName: "V",
          date: new Date("2026-03-10"),
          status: "approved",
          ...totals,
        } as never,
        [bigLine] as never,
        company()
      ),
      await generateCreditNotePDF(
        {
          id: "cn2",
          number: "CN-2",
          customerName: "C",
          date: new Date("2026-03-10"),
          status: "issued",
          ...totals,
        } as never,
        [bigLine] as never,
        company()
      ),
    ];
    for (const pdf of docs) {
      const text = flat(await pdfToText(pdf));
      expect(text).toContain("AED 4,115.17");
      expect(text).toContain("AED 12,345.51");
      expect(text).toContain("AED 617.28");
      expect(text).toContain("AED 12,962.79");
      expect(text).not.toContain("12345.51");
    }
  });
});

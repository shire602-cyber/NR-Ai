import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { generateInvoicePDF } from "../../server/services/pdf-invoice.service";
import { generateQuotePDF } from "../../server/services/pdf-quote.service";
import { generatePurchaseOrderPDF } from "../../server/services/pdf-purchase-order.service";
import { renderPayslipPdf, type PayslipData } from "../../server/services/payroll/payslip";
import { renderReceiptPdf } from "../../server/services/pdf-receipt.service";
import { buildReportPdf } from "../../server/services/report-render/pdf";
import { ltr } from "../../server/services/pdf-fonts";
import { MM } from "../../server/services/pdf-ledger";
import { DOCUMENT_ACCENT_DEFAULT, resolveDocumentAccent } from "../../shared/document-accent";
import { pdfToText, pdfWords } from "./pdf-test-helpers";
import type { Company } from "../../shared/schema";

/**
 * WP-F: the "Ledger" PDF family. Fable's defects on customer documents: the amount-due box ran
 * past the right margin, quote/PO money was ungrouped ("AED 9500.00"), phone numbers were
 * bidi-scrambled ("0199 555 4 971+"), Arabic labels ran into Latin values, payslips printed
 * "09/2026", receipts used another font and printed OCR text.
 */

const company = (locale: "en" | "ar" = "en") =>
  ({
    id: "c1",
    name: "Al Noor Emirates General Trading and Contracting Company LLC",
    locale,
    trnVatNumber: "100123456700003",
    businessAddress: "Office 1404, Sheikh Zayed Road, Dubai",
    contactPhone: "+971 4 555 0199",
    contactEmail: "billing@alnoor.example",
    companyType: "standard",
  }) as unknown as Company;

const invoice = {
  id: "i1",
  companyId: "c1",
  number: "INV-2026-00038",
  customerName: "شركة النور للتجارة",
  customerTrn: "100211130000003",
  customerAddress: "الخليج التجاري، دبي",
  date: new Date("2026-10-15T00:00:00Z"),
  dueDate: new Date("2026-11-14T00:00:00Z"),
  paymentTerms: "net30",
  currency: "AED",
  exchangeRate: 1,
  subtotal: 14500,
  vatAmount: 725,
  total: 15225,
  status: "sent",
  reverseCharge: false,
};
const invoiceLines = [
  {
    id: "l1",
    description: "Point-of-sale integration",
    quantity: 1,
    unitPrice: 14500,
    vatRate: 0.05,
    vatSupplyType: "standard_rated",
  },
];

const flat = (s: string) => s.replace(/\s+/g, " ");
const A4_WIDTH = 595.28;
const MARGIN = 18 * MM;

function pdfFonts(pdf: Buffer): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-fonts-"));
  const file = path.join(dir, "doc.pdf");
  fs.writeFileSync(file, pdf);
  return new Promise<string[]>((resolve, reject) => {
    execFile("pdffonts", [file], (err, stdout) => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (err) return reject(err);
      resolve(
        stdout
          .split("\n")
          .slice(2)
          .map((l) => l.split(/\s+/)[0])
          .filter(Boolean)
      );
    });
  });
}

describe("WP-F Ledger PDF family", { timeout: 60_000 }, () => {
  it("invoice: the amount-due row and every word stay inside the 18 mm margins (en and ar)", async () => {
    for (const locale of ["en", "ar"] as const) {
      const pdf = await generateInvoicePDF(
        invoice as never,
        invoiceLines as never,
        company(locale),
        { amountPaid: 6090 }
      );
      const words = await pdfWords(pdf);
      const due = words.find((w) => w.text === "9,135.00");
      expect(due, `${locale}: amount due figure`).toBeDefined();
      // poppler reports each Arabic /ActualText span as a 1 pt-wide box at the run origin; those
      // markers carry no glyphs, so only real word boxes are checked against the margins.
      const ink = words.filter((x) => Math.abs(x.xMax - x.xMin - 1) > 0.01);
      for (const w of ink) {
        expect(w.xMax, `${locale}: "${w.text}"`).toBeLessThanOrEqual(A4_WIDTH - MARGIN + 0.5);
        expect(w.xMin, `${locale}: "${w.text}"`).toBeGreaterThanOrEqual(MARGIN - 0.5);
      }
      expect(flat(await pdfToText(pdf))).toContain("AED 9,135.00");
    }
  });

  it("invoice: no colour band — the header is white with a thin accent rule", async () => {
    const pdf = await generateInvoicePDF(invoice as never, invoiceLines as never, company());
    // The only accent-filled areas are the 2 pt rule and the amount-due row: no royal blue at all.
    const raw = pdf.toString("latin1");
    expect(raw).not.toMatch(/0\.11764\d* 0\.25098\d* 0\.68627\d* rg/); // #1E40AF
  });

  it("phone numbers keep their digit order next to Arabic labels (en and ar)", async () => {
    for (const locale of ["en", "ar"] as const) {
      const pdf = await generateInvoicePDF(
        invoice as never,
        invoiceLines as never,
        company(locale)
      );
      const text = flat(await pdfToText(pdf));
      expect(text, locale).toContain("+971 4 555 0199");
      expect(text, locale).not.toContain("0199 555 4");
    }
    expect(ltr("+971 4 555 0199")).toBe("⁦+971 4 555 0199⁩");
    expect(ltr(null)).toBe("");
  });

  it("quote and purchase order group every amount (AED 9,500.00, never AED 9500.00)", async () => {
    const quote = await generateQuotePDF(
      {
        id: "q1",
        number: "QT-1",
        customerName: "شركة النور للتجارة",
        date: new Date("2026-11-01"),
        expiryDate: new Date("2026-12-01"),
        currency: "AED",
        subtotal: 9500,
        vatAmount: 475,
        total: 9975,
        status: "converted",
      } as never,
      [{ id: "a", description: "Retainer", quantity: 1, unitPrice: 9500, vatRate: 0.05 }] as never,
      company()
    );
    const po = await generatePurchaseOrderPDF(
      {
        id: "p1",
        number: "PO-1",
        vendorName: "مورد المواد",
        date: new Date("2026-11-02"),
        expectedDeliveryDate: new Date("2026-12-08"),
        currency: "AED",
        subtotal: 9500,
        vatAmount: 475,
        total: 9975,
        status: "received",
      } as never,
      [
        { id: "a", description: "Cable trays", quantity: 50, unitPrice: 190, vatRate: 0.05 },
      ] as never,
      company()
    );
    for (const pdf of [quote, po]) {
      const text = flat(await pdfToText(pdf));
      expect(text).toContain("AED 9,500.00");
      expect(text).toContain("AED 9,975.00");
      expect(text).not.toMatch(/AED \d{4,}\.\d{2}/);
      // Raw status enums are not printed in capitals any more.
      expect(text).not.toContain("CONVERTED");
      expect(text).not.toContain("RECEIVED");
    }
    const poText = flat(await pdfToText(po));
    expect(poText).toContain("8 Dec 2026");
    expect(poText).not.toMatch(/التسليم\d/);
  });

  it("payslip prints the period as month and year in both languages and a grouped net pay", async () => {
    const data: PayslipData = {
      company: { id: "c1", name: "Najma Trading LLC", locale: "en" },
      run: { id: "r", periodMonth: 9, periodYear: 2026, status: "approved" },
      employee: {
        id: "e",
        name: "Fatima Al Mansoori",
        nameAr: "فاطمة المنصوري",
        employeeNumber: "EMP-7",
        designation: null,
        department: null,
        iban: "AE07…4567",
      },
      lines: {
        basic: "12000.00",
        housing: "4500.00",
        transport: "0.00",
        other: "0.00",
        overtime: "0.00",
        unpaidLeaveDeduction: "0.00",
        unpaidLeaveDays: 0,
        paidLeaveDays: 0,
        pensionEmployee: "0.00",
        deductions: "0.00",
        deductionNotes: null,
        gross: "16500.00",
        net: "16500.00",
        currency: "AED",
        exchangeRate: "1",
        netForeign: null,
        expenseReimbursement: "0.00",
        totalPaid: "16500.00",
      },
    };
    const text = flat(await pdfToText(await renderPayslipPdf(data)));
    expect(text).toContain("September 2026");
    expect(text).toContain("سبتمبر");
    expect(text).not.toContain("09/2026");
    expect(text).toContain("AED 16,500.00");
  });

  it("receipt: bilingual labels, formatted date, no OCR text, one font family", async () => {
    const pdf = await renderReceiptPdf(
      {
        id: "r1",
        merchant: "Carrefour",
        date: new Date("2026-11-05"),
        category: "Office supplies",
        currency: "AED",
        amount: 1240,
        vatAmount: 62,
        rawText: "CARREFOUR TOTAL 1302.00",
      } as never,
      company()
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("Expense receipt");
    expect(text).toContain("إيصال مصروف");
    expect(text).toContain("5 Nov 2026");
    expect(text).toContain("AED 1,302.00");
    expect(text).not.toContain("OCR");
    expect(text).not.toContain("05/11/2026");
    const fonts = await pdfFonts(pdf);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).toMatch(/\+NotoSans(Arabic)?-/);
  });

  it("statements: whole-day counts, formatted dates, a plain balance sentence, page x of y", async () => {
    const pdf = await buildReportPdf(
      { id: "c1", name: "Najma", legalName: null, trn: null, address: null, locale: "en" },
      [
        {
          id: "trial-balance",
          title: { en: "Trial balance", ar: "ميزان المراجعة" },
          period: "As of 31 Oct 2026",
          basis: "ledger",
          tables: [
            {
              columns: [
                { key: "date", header: { en: "Date", ar: "التاريخ" } },
                { key: "days", header: { en: "Days overdue", ar: "أيام التأخير" }, numeric: true },
                { key: "open", header: { en: "Open", ar: "المتبقي" }, numeric: true },
              ],
              rows: [{ cells: { date: "2026-11-17", days: 45, open: 9135 } }],
            },
          ],
          notes: [{ en: "Balanced.", ar: "متوازن." }],
        },
      ]
    );
    const text = flat(await pdfToText(pdf));
    expect(text).toContain("17 Nov 2026");
    expect(text).not.toContain("2026-11-17");
    expect(text).toMatch(/\b45\b/);
    expect(text).not.toContain("45.00");
    expect(text).toContain("9,135.00");
    expect(text).toContain("Debits equal credits");
    expect(text).not.toContain("Balanced.");
    expect(text).toContain("Page 1 of 1");
    // Column headers are stacked bilingual.
    expect(text).toContain("أيام التأخير");
  });

  it("document accent: emerald by default, presets kept, legacy blue defaults and light colours fall back", () => {
    expect(DOCUMENT_ACCENT_DEFAULT).toBe("#0B5F45");
    expect(resolveDocumentAccent(null)).toBe("#0B5F45");
    expect(resolveDocumentAccent("#1a56db")).toBe("#0B5F45");
    expect(resolveDocumentAccent("#1E40AF")).toBe("#0B5F45");
    expect(resolveDocumentAccent("#6b1f2a")).toBe("#6B1F2A");
    expect(resolveDocumentAccent("#FFE066")).toBe("#0B5F45");
    expect(resolveDocumentAccent("not-a-colour")).toBe("#0B5F45");
  });
});

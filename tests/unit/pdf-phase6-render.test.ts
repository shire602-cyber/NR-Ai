import { describe, it, expect } from "vitest";
import { generatePayslipPDF, maskIban } from "../../server/services/pdf-payslip.service";
import { generateStatementPDF } from "../../server/services/pdf-statement.service";
import { generateQuotePDF } from "../../server/services/pdf-quote.service";
import { generateDeliveryNotePDF } from "../../server/services/pdf-delivery-note.service";
import { computeCustomerStatement } from "../../server/services/customer-statement.service";
import * as F from "../fixtures/pdf-arabic-fixtures";
import { arabicGlyphCodes, extractPdfText, pdfPageCount } from "../fixtures/pdf-extract";

const IBAN = "AE070331234567890129876";

function expectArabic(buf: Buffer) {
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(buf.toString("latin1")).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansArabic/);
  const codes = arabicGlyphCodes(buf);
  expect(codes.length).toBeGreaterThan(15);
  expect(codes).not.toContain("0000");
}

describe("payslip PDF", () => {
  const input = {
    company: F.company,
    employee: {
      fullName: "Ahmed Khan",
      fullNameAr: "أحمد خان",
      employeeNumber: "EMP-007",
      designation: "Senior Accountant",
      iban: IBAN,
    },
    periodMonth: 8,
    periodYear: 2026,
    payDate: "2026-08-31T00:00:00Z",
    item: {
      basicSalary: 8000,
      housingAllowance: 3000,
      transportAllowance: 1000,
      otherAllowance: 500,
      overtime: 250,
      deductions: 120,
      deductionNotes: "Salary advance",
      pensionEmployee: 0,
      pensionEmployer: 0,
      gratuityAccrual: 333.33,
      netSalary: 12630,
    },
  };

  it("shows the slip content, masked IBAN and employer contributions", async () => {
    const buf = await generatePayslipPDF(input as any);
    const text = await extractPdfText(buf);
    for (const needle of [
      "PAYSLIP",
      "EMP-007",
      "Ahmed Khan",
      "Senior Accountant",
      "August 2026",
      "Basic Salary",
      "Housing Allowance",
      "Transport Allowance",
      "Gross Pay",
      "Total Deductions",
      "NET PAY",
      "Employer Contributions",
      "Gratuity Accrual",
      "8,000.00",
      "12,630.00",
      F.TRN,
    ]) {
      expect(text).toContain(needle);
    }
    expect(text).toContain("9876"); // last four of the IBAN
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain("0331234567890");
    expectArabic(buf);
  });

  it("masks an IBAN to its last four characters", () => {
    expect(maskIban(IBAN)).toBe("**** **** **** 9876");
    expect(maskIban(IBAN)).not.toContain("0331");
    expect(maskIban(null)).toBe("-");
    expect(maskIban("12")).toBe("**");
  });
});

describe("customer statement PDF", () => {
  const statement = {
    ...computeCustomerStatement({
      invoices: [
        { id: "i1", number: "INV-2026-0042", date: "2026-08-05", dueDate: "2026-09-04", total: 2310, baseCurrencyAmount: 2310, currency: "AED", exchangeRate: 1, status: "sent", invoiceType: "invoice" },
      ],
      payments: [{ id: "p1", invoiceId: "i1", amount: 310, date: "2026-08-15", reference: "TRF-9" }],
      refunds: [],
      from: "2026-08-01",
      to: "2026-08-31",
    }),
    contact: { id: "k1", name: F.ARABIC_CUSTOMER, trnNumber: "100987654300003", address: "Abu Dhabi" },
  };

  it("lists lines, balances and ageing in English and Arabic", async () => {
    const buf = await generateStatementPDF(statement, F.company);
    const text = await extractPdfText(buf);
    for (const needle of [
      "STATEMENT OF ACCOUNT",
      "Opening Balance",
      "Closing Balance",
      "INV-2026-0042",
      "TRF-9",
      "2,310.00",
      "2,000.00",
      "Current",
      "1-30",
      "31-60",
      "61-90",
      "90+",
    ]) {
      expect(text).toContain(needle);
    }
    expectArabic(buf);
  });

  it("flows onto more pages when there are many lines", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({
      date: "2026-08-10",
      type: "invoice" as const,
      reference: `INV-${i}`,
      currency: "AED",
      documentAmount: 10,
      debit: 10,
      credit: 0,
      balance: 10 * (i + 1),
    }));
    const buf = await generateStatementPDF({ ...statement, lines }, F.company);
    expect(await pdfPageCount(buf)).toBeGreaterThan(1);
    expect(await extractPdfText(buf)).toContain("INV-79");
  });
});

describe("proforma invoice PDF", () => {
  it("is titled Proforma Invoice and says it is not a tax invoice", async () => {
    const buf = await generateQuotePDF(F.quote, F.docLines, F.company, { variant: "proforma" });
    const text = await extractPdfText(buf);
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain("This is not a tax invoice");
    expect(text).not.toContain("QUOTATION");
    expectArabic(buf);
  });

  it("the plain quote is unchanged", async () => {
    const text = await extractPdfText(await generateQuotePDF(F.quote, F.docLines, F.company));
    expect(text).toContain("QUOTATION");
    expect(text).not.toContain("not a tax invoice");
  });
});

describe("delivery note PDF", () => {
  it("has quantities and a signature block but no prices, VAT or totals", async () => {
    const buf = await generateDeliveryNotePDF(F.invoice, F.invoiceLines, F.company);
    const text = await extractPdfText(buf);
    expect(text).toContain("DELIVERY NOTE");
    expect(text).toContain("INV-2026-0042");
    expect(text).toContain("Received by");
    expect(text).toContain("Signature");
    expect(text).toContain("Date");
    expect(text).toContain("Qty");
    for (const forbidden of ["Unit Price", "Price", "VAT:", "Subtotal", "TOTAL", "500.00", "1,200.00", "2,310.00", "2310.00", "110.00", "5%"]) {
      expect(text).not.toContain(forbidden);
    }
    expectArabic(buf);
  });
});

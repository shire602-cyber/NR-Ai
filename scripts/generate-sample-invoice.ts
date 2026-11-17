/**
 * X6d: regenerates the sample bilingual tax invoice linked from the public landing page.
 *
 *   npx tsx scripts/generate-sample-invoice.ts
 *
 * The document is produced by the real invoice PDF generator with obviously synthetic data (no
 * real company, customer, TRN or amounts), so what a visitor downloads is what the product
 * renders. Output: client/public/samples/muhasib-sample-invoice.pdf
 */
import fs from "node:fs";
import path from "node:path";
import { generateInvoicePDF } from "../server/services/pdf-invoice.service";
import type { Company, Invoice, InvoiceLine } from "../shared/schema";

const company = {
  id: "sample-company",
  name: "Sample Trading L.L.C.",
  legalName: "Sample Trading L.L.C.",
  locale: "en",
  trnVatNumber: "100000000000003",
  businessAddress: "Sample Tower, Business Bay, Dubai, United Arab Emirates",
  contactPhone: "+971 4 000 0000",
  contactEmail: "billing@example.com",
  baseCurrency: "AED",
} as unknown as Company;

const lines = [
  {
    id: "l1",
    description: "Monthly bookkeeping service / خدمة مسك الدفاتر الشهرية",
    quantity: 1,
    unitPrice: 4000,
    vatRate: 0.05,
  },
  {
    id: "l2",
    description: "VAT return preparation / إعداد الإقرار الضريبي",
    quantity: 1,
    unitPrice: 1500,
    vatRate: 0.05,
  },
  {
    id: "l3",
    description: "Export documentation (zero-rated) / مستندات التصدير (بنسبة صفر)",
    quantity: 2,
    unitPrice: 250,
    vatRate: 0,
  },
] as unknown as InvoiceLine[];

const subtotal = 4000 + 1500 + 500;
const vatAmount = (4000 + 1500) * 0.05;

const invoice = {
  id: "sample-invoice",
  companyId: company.id,
  number: "SAMPLE-0001",
  date: new Date("2026-03-15"),
  dueDate: new Date("2026-04-14"),
  customerName: "Sample Customer L.L.C. / شركة العميل النموذجي",
  customerTrn: "100000000000003",
  customerAddress: "Sample Street, Dubai, United Arab Emirates",
  currency: "AED",
  subtotal,
  vatAmount,
  total: subtotal + vatAmount,
  status: "sent",
  paymentTerms: "net30",
} as unknown as Invoice;

const out = path.resolve(process.cwd(), "client/public/samples/muhasib-sample-invoice.pdf");
fs.mkdirSync(path.dirname(out), { recursive: true });
const pdf = await generateInvoicePDF(invoice, lines, company, {
  locale: "en",
  branding: { footerText: "Sample document with synthetic data / مستند نموذجي ببيانات تجريبية" },
});
fs.writeFileSync(out, pdf);
console.log(`wrote ${out} (${pdf.length} bytes)`);

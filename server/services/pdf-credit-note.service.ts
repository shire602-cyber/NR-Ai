import { isDraftStatus, pdfLocale, stampDraftWatermark } from "./pdf-fonts";
import { bi, date, ltr, renderSimpleDocument } from "./pdf-ledger";
import { loadCompanyLogo } from "./pdf-logo";
import type { CreditNote, CreditNoteLine, Company, Invoice } from "../../shared/schema";

/**
 * Credit note PDF in the "Ledger" layout (server/services/pdf-ledger.ts).
 * The status is not printed (a draft carries the DRAFT watermark instead).
 */
export async function generateCreditNotePDF(
  creditNote: CreditNote,
  lines: CreditNoteLine[],
  company: Company,
  originalInvoice?: Invoice
): Promise<Buffer> {
  // S1 (R14-13): the uploaded company logo (companies.logo_path), never an inline data: URL.
  const logo = await loadCompanyLogo(company);
  const isVATRegistered = !!company.trnVatNumber;
  return renderSimpleDocument({
    locale: pdfLocale(company),
    info: { Title: `Credit Note ${creditNote.number}`, Author: company.name },
    company: {
      name: company.name,
      legalName: company.legalName,
      trn: company.trnVatNumber,
      address: company.businessAddress,
      phone: company.contactPhone,
      email: company.contactEmail,
    },
    logo,
    title: isVATRegistered
      ? bi("Tax credit note", "إشعار دائن ضريبي")
      : bi("Credit note", "إشعار دائن"),
    meta: [
      { label: bi("Credit note no.", "رقم الإشعار"), value: ltr(creditNote.number) },
      { label: bi("Date", "التاريخ"), value: date(creditNote.date) },
      {
        label: bi("Ref. invoice", "الفاتورة المرجعية"),
        value: originalInvoice ? ltr(originalInvoice.number) : null,
      },
    ],
    party: {
      label: bi("Credit to", "لصالح"),
      name: creditNote.customerName,
      trn: creditNote.customerTrn,
    },
    currency: creditNote.currency || "AED",
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatPercent: ((line.vatRate || 0.05) * 100).toFixed(0),
      amount: line.quantity * line.unitPrice,
    })),
    totals: {
      subtotal: creditNote.subtotal,
      vat: creditNote.vatAmount,
      total: creditNote.total,
      totalLabel: bi("Total credit", "إجمالي الدائن"),
    },
    notes: [{ label: bi("Reason", "السبب"), text: creditNote.reason }],
    footer: [
      bi(
        "This credit note reduces the amount owed on the referenced invoice.",
        "يخفض هذا الإشعار المبلغ المستحق على الفاتورة المرجعية."
      ),
      isVATRegistered
        ? bi(
            "This is a tax credit note. Please keep it for your records.",
            "هذا إشعار دائن ضريبي. يرجى الاحتفاظ به لسجلاتكم."
          )
        : null,
    ],
    beforeEnd: (doc) => {
      if (isDraftStatus(creditNote.status)) stampDraftWatermark(doc);
    },
  });
}

import { isDraftStatus, pdfLocale, stampDraftWatermark } from "./pdf-fonts";
import { bi, date, lineVatPercent, ltr, renderSimpleDocument } from "./pdf-ledger";
import { loadCompanyLogo } from "./pdf-logo";
import type { Quote, QuoteLine, Company } from "../../shared/schema";

/**
 * Quotation / estimate PDF in the "Ledger" layout (server/services/pdf-ledger.ts).
 * The status is not printed (a draft carries the DRAFT watermark instead).
 */
export async function generateQuotePDF(
  quote: Quote,
  lines: QuoteLine[],
  company: Company
): Promise<Buffer> {
  // S1 (R14-13): the uploaded company logo (companies.logo_path), never an inline data: URL.
  const logo = await loadCompanyLogo(company);
  const isVATRegistered = !!company.trnVatNumber;
  return renderSimpleDocument({
    locale: pdfLocale(company),
    info: { Title: `Quotation ${quote.number}`, Author: company.name },
    company: {
      name: company.name,
      legalName: company.legalName,
      legalNameAr: company.legalNameAr,
      addressAr: company.addressAr,
      trn: company.trnVatNumber,
      address: company.businessAddress,
      phone: company.contactPhone,
      email: company.contactEmail,
    },
    logo,
    title: bi("Quotation", "عرض سعر"),
    meta: [
      { label: bi("Quote no.", "رقم العرض"), value: ltr(quote.number) },
      { label: bi("Date", "التاريخ"), value: date(quote.date) },
      {
        label: bi("Valid until", "صالح حتى"),
        value: quote.expiryDate ? date(quote.expiryDate) : null,
      },
    ],
    party: {
      label: bi("Bill to", "إلى"),
      name: quote.customerName,
      trn: quote.customerTrn,
    },
    currency: quote.currency || "AED",
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatPercent: lineVatPercent(line),
      amount: line.quantity * line.unitPrice,
    })),
    totals: {
      subtotal: quote.subtotal,
      vat: quote.vatAmount,
      total: quote.total,
      totalLabel: bi("Total", "الإجمالي"),
    },
    notes: [{ label: bi("Notes", "ملاحظات"), text: quote.notes }],
    footer: [
      bi(
        "This quotation is valid for the period specified above.",
        "هذا العرض ساري للفترة المحددة أعلاه."
      ),
      isVATRegistered
        ? bi(
            "All amounts are inclusive of applicable VAT where stated.",
            "جميع المبالغ شاملة ضريبة القيمة المضافة حيثما ذُكر."
          )
        : null,
    ],
    beforeEnd: (doc) => {
      if (isDraftStatus(quote.status)) stampDraftWatermark(doc);
    },
  });
}

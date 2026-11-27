import { pdfLocale } from "./pdf-fonts";
import { bi, date, lineVatPercent, ltr, renderSimpleDocument } from "./pdf-ledger";
import { loadCompanyLogo } from "./pdf-logo";
import type { PurchaseOrder, PurchaseOrderLine, Company } from "../../shared/schema";

/**
 * Purchase order PDF in the "Ledger" layout (server/services/pdf-ledger.ts).
 * The status is not printed: the vendor needs the order, not our workflow state.
 */
export async function generatePurchaseOrderPDF(
  po: PurchaseOrder,
  lines: PurchaseOrderLine[],
  company: Company
): Promise<Buffer> {
  const logo = await loadCompanyLogo(company);
  const isVATRegistered = !!company.trnVatNumber;
  return renderSimpleDocument({
    locale: pdfLocale(company),
    info: { Title: `Purchase Order ${po.number}`, Author: company.name },
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
    title: bi("Purchase order", "أمر شراء"),
    meta: [
      { label: bi("PO no.", "رقم أمر الشراء"), value: ltr(po.number) },
      { label: bi("Date", "التاريخ"), value: date(po.date) },
      {
        label: bi("Delivery by", "موعد التسليم"),
        value: po.expectedDeliveryDate ? date(po.expectedDeliveryDate) : null,
      },
    ],
    party: { label: bi("Vendor", "المورّد"), name: po.vendorName, trn: po.vendorTrn },
    currency: po.currency || "AED",
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatPercent: lineVatPercent(line),
      amount: line.quantity * line.unitPrice,
    })),
    totals: {
      subtotal: po.subtotal,
      vat: po.vatAmount,
      total: po.total,
      totalLabel: bi("Total", "الإجمالي"),
    },
    notes: [{ label: bi("Notes", "ملاحظات"), text: po.notes }],
    footer: [
      bi("Please confirm receipt of this purchase order.", "يرجى تأكيد استلام أمر الشراء هذا."),
      isVATRegistered
        ? bi(
            "All amounts are inclusive of applicable VAT where stated.",
            "جميع المبالغ شاملة ضريبة القيمة المضافة حيثما ذُكر."
          )
        : null,
    ],
  });
}

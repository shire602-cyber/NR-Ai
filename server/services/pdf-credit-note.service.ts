import { isDraftStatus, isVoidedStatus, pdfLocale, stampDraftWatermark } from "./pdf-fonts";
import { bi, date, lineVatPercent, ltr, money, renderSimpleDocument } from "./pdf-ledger";
import { loadCompanyLogo } from "./pdf-logo";
import type { CreditNote, CreditNoteLine, Company, Invoice } from "../../shared/schema";

/**
 * Foreign-currency credit note: the booking rate and VAT in the base currency exactly as posted
 * (never a fresh rate lookup; a credit note never creates an FX gain or loss).
 */
export interface CreditNotePdfAdjustment {
  currency: string;
  /** Net value of the supply on the original tax invoice. */
  originalNet: number;
  /** Net value after every credit note on the invoice up to and including this one. */
  correctedNet: number;
  /** The net amount this credit note removes. */
  differenceNet: number;
  /** The same three figures in the base currency at the stored booking rate (foreign only). */
  base?: { currency: string; originalNet: number; correctedNet: number; differenceNet: number };
}

export interface CreditNotePdfFx {
  baseCurrency: string;
  /** Base currency per 1 unit of the document currency, as stored on the credit note. */
  exchangeRate: number;
  /** VAT in the base currency, from the posted journal (or the stored rate for a draft). */
  vatBase: number;
}

/**
 * Credit note PDF in the "Ledger" layout (server/services/pdf-ledger.ts).
 * The status is not printed (a draft carries the DRAFT watermark instead).
 */
export async function generateCreditNotePDF(
  creditNote: CreditNote,
  lines: CreditNoteLine[],
  company: Company,
  originalInvoice?: Invoice | null,
  fx?: CreditNotePdfFx | null,
  adjustment?: CreditNotePdfAdjustment | null
): Promise<Buffer> {
  const ar = pdfLocale(company) === "ar";
  const adjLine = (pick: "originalNet" | "correctedNet" | "differenceNet"): string => {
    if (!adjustment) return "";
    const doc = money(adjustment[pick], adjustment.currency);
    return adjustment.base
      ? `${doc} (${money(adjustment.base[pick], adjustment.base.currency)})`
      : doc;
  };
  // S1 (R14-13): the uploaded company logo (companies.logo_path), never an inline data: URL.
  const logo = await loadCompanyLogo(company);
  const isVATRegistered = !!company.trnVatNumber;
  return renderSimpleDocument({
    locale: pdfLocale(company),
    info: { Title: `Credit Note ${creditNote.number}`, Author: company.name },
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
      {
        label: bi("Ref. invoice date", "تاريخ الفاتورة المرجعية"),
        value: originalInvoice ? date(originalInvoice.date) : null,
      },
    ],
    party: {
      label: bi("Credit to", "لصالح"),
      name: creditNote.customerName,
      trn: creditNote.customerTrn,
      address: creditNote.customerAddress,
    },
    currency: creditNote.currency || "AED",
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatPercent: lineVatPercent(line),
      amount: line.quantity * line.unitPrice,
    })),
    totals: {
      subtotal: creditNote.subtotal,
      vat: creditNote.vatAmount,
      total: creditNote.total,
      totalLabel: bi("Total credit", "إجمالي الدائن"),
      extraRows: fx
        ? [
            {
              label: bi(`VAT total (${fx.baseCurrency})`, `إجمالي الضريبة (${fx.baseCurrency})`),
              value: money(fx.vatBase, fx.baseCurrency),
            },
            {
              label: bi("Exchange rate", "سعر الصرف"),
              value: ltr(
                `1 ${creditNote.currency || "AED"} = ${fx.exchangeRate.toFixed(4)} ${fx.baseCurrency}`
              ),
            },
          ]
        : undefined,
    },
    notes: [
      {
        label: bi("Reason", "السبب"),
        text: creditNote.reason || (ar ? "إشعار دائن للفاتورة" : "Invoice credit note"),
      },
      ...(adjustment
        ? [
            {
              label: bi("Original value of the supply (net)", "القيمة الأصلية للتوريد (الصافي)"),
              text: adjLine("originalNet"),
            },
            {
              label: bi("Corrected value of the supply (net)", "القيمة المصححة للتوريد (الصافي)"),
              text: adjLine("correctedNet"),
            },
            {
              label: bi("Difference (net credited)", "الفرق (الصافي المدين)"),
              text: adjLine("differenceNet"),
            },
          ]
        : []),
    ],
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
      else if (isVoidedStatus(creditNote.status)) stampDraftWatermark(doc, "void");
    },
  });
}

// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { loadCompanyLogo } from "./pdf-logo";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { UAE_VAT_RATE } from "../constants";
import { renderEInvoiceQrPng } from "./einvoice-qr.service";
import {
  bilingual,
  isArabic,
  pdfLocale,
  preparePdfDocument,
  type PdfDoc,
  type PdfLocale,
} from "./pdf-fonts";

const PAGE_WIDTH = 595.28;
const NR_GREEN = "#6F9E3A";
const BORDER = "#111111";
const HEADER_FILL = "#E6E6E6";

export type InvoicePdfTemplate = "standard" | "nra";

export interface GenerateInvoicePdfOptions {
  template?: InvoicePdfTemplate;
  /** Document language; defaults to the company's `locale` (en/ar). */
  locale?: PdfLocale;
  /** Payments received so far. Defaults to the full total for `paid` invoices, else 0. */
  amountPaid?: number;
  /** Date of supply; defaults to the invoice date when absent. */
  supplyDate?: Date | string | null;
  /** Customer details from the linked contact, used when the invoice has none stored. */
  customer?: { name?: string | null; trn?: string | null; address?: string | null };
  /** W3-A (R03-24): invoice-template branding applied to the standard layout. */
  branding?: InvoicePdfBranding | null;
}

export interface InvoicePdfBranding {
  primaryColor?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  termsText?: string | null;
  bankDetails?: string | null;
  /**
   * Legacy template logo (raster data: URL). The company's uploaded logo (companies.logo_path)
   * wins; nothing is fetched from the network while rendering.
   */
  logoUrl?: string | null;
  showLogo?: boolean | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function invoicePdfTemplateForCompany(company: Company): InvoicePdfTemplate {
  return company.companyType === "client" ? "nra" : "standard";
}

export async function generateInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: GenerateInvoicePdfOptions = {}
): Promise<Buffer> {
  const template = options.template ?? invoicePdfTemplateForCompany(company);
  if (template === "nra") {
    return generateNraInvoicePDF(invoice, lines);
  }

  return generateStandardInvoicePDF(invoice, lines, company, options);
}

export type VatTreatment =
  | "standard_rated"
  | "zero_rated"
  | "exempt"
  | "out_of_scope"
  | "reverse_charge";

const TREATMENT_LABELS: Record<VatTreatment, { en: string; ar: string }> = {
  standard_rated: { en: "Standard rated", ar: "خاضع للنسبة الأساسية" },
  zero_rated: { en: "Zero-rated", ar: "خاضع لنسبة الصفر" },
  exempt: { en: "Exempt", ar: "معفى" },
  out_of_scope: { en: "Out of scope", ar: "خارج النطاق" },
  reverse_charge: { en: "Reverse charge", ar: "الاحتساب العكسي" },
};

/**
 * VAT treatment of one invoice line (R03-19). Reads `line.vatSupplyType` when present and
 * consistent with the rate, otherwise derives it from the rate; a reverse-charge invoice marks
 * every taxable line as reverse charge.
 */
export function vatTreatmentForLine(
  line: Pick<InvoiceLine, "vatRate"> & { vatSupplyType?: string | null },
  reverseCharge = false
): VatTreatment {
  const rate = line.vatRate ?? UAE_VAT_RATE;
  const declared = (line.vatSupplyType ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const known: VatTreatment[] = [
    "standard_rated",
    "zero_rated",
    "exempt",
    "out_of_scope",
    "reverse_charge",
  ];
  let treatment: VatTreatment;
  if ((known as string[]).includes(declared) && !(declared === "standard_rated" && rate === 0)) {
    treatment = declared as VatTreatment;
  } else {
    treatment = rate > 0 ? "standard_rated" : "zero_rated";
  }
  if (reverseCharge && treatment === "standard_rated") return "reverse_charge";
  return treatment;
}

export interface InvoicePdfTotals {
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  paid: boolean;
  /** VAT in AED for foreign-currency invoices; null when the invoice is already in AED. */
  vatAed: number | null;
  exchangeRate: number;
}

/** Totals block (R03-15): amount due = total minus payments, never negative. */
export function computeInvoicePdfTotals(
  invoice: Invoice,
  options: Pick<GenerateInvoicePdfOptions, "amountPaid"> = {}
): InvoicePdfTotals {
  const currency = invoice.currency || "AED";
  const total = Number(invoice.total) || 0;
  const status = (invoice.status || "").toLowerCase();
  let amountPaid = options.amountPaid ?? (status === "paid" ? total : 0);
  amountPaid = Math.min(Math.max(amountPaid, 0), Math.max(total, 0));
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const exchangeRate = Number(invoice.exchangeRate) > 0 ? Number(invoice.exchangeRate) : 1;
  return {
    currency,
    subtotal: Number(invoice.subtotal) || 0,
    vat: Number(invoice.vatAmount) || 0,
    total,
    amountPaid,
    amountDue,
    paid: status === "paid" || (total > 0 && amountDue === 0),
    vatAed: currency === "AED" ? null : (Number(invoice.vatAmount) || 0) * exchangeRate,
    exchangeRate,
  };
}

async function generateStandardInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: GenerateInvoicePdfOptions = {}
): Promise<Buffer> {
  let qrPng: Buffer | null = null;
  if (company.trnVatNumber) {
    try {
      qrPng = await renderEInvoiceQrPng({
        sellerName: company.name,
        vatRegistrationNumber: company.trnVatNumber,
        timestamp: invoice.date instanceof Date ? invoice.date : new Date(invoice.date),
        invoiceTotalWithVat: invoice.total,
        vatAmount: invoice.vatAmount,
      });
    } catch {
      qrPng = null;
    }
  }

  const locale = options.locale ?? pdfLocale(company);
  const rtl = locale === "ar";
  const totals = computeInvoicePdfTotals(invoice, options);
  const customer = {
    name: invoice.customerName || options.customer?.name || "",
    trn: invoice.customerTrn || options.customer?.trn || null,
    address: invoice.customerAddress || options.customer?.address || null,
  };
  const supplyDate =
    options.supplyDate ??
    (invoice as Invoice & { supplyDate?: Date | string | null }).supplyDate ??
    invoice.date;

  // S1 (R14-13): the uploaded logo (companies.logo_path), template data: URL as legacy fallback.
  const logo = await loadCompanyLogo(company, {
    fallbackDataUrl: options.branding?.logoUrl ?? null,
    show: options.branding?.showLogo,
  });

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: company.name,
          Subject: "Tax Invoice",
          Creator: "Muhasib.ai",
        },
      });
      preparePdfDocument(doc);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 595.28;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;
      const START: "left" | "right" = rtl ? "right" : "left";
      const END: "left" | "right" = rtl ? "left" : "right";
      /** Mirror an x offset inside the content box for Arabic-first layouts. */
      const px = (x: number, w: number) => (rtl ? margin + contentWidth - (x - margin) - w : x);
      const L = (en: string, ar: string) => bilingual(locale, en, ar);

      const isVATRegistered = !!company.trnVatNumber;
      const invoiceTitle = isVATRegistered
        ? L("Tax Invoice", "فاتورة ضريبية")
        : L("Invoice", "فاتورة");

      const brand = options.branding ?? null;
      const bandColor =
        brand?.primaryColor && HEX_COLOR.test(brand.primaryColor) ? brand.primaryColor : "#1E40AF";

      // Header band
      doc.rect(0, 0, pageWidth, 110).fill(bandColor);
      if (logo) {
        try {
          doc.image(logo, px(margin, 60), 50, { fit: [60, 50] });
        } catch {
          // An undecodable logo must never break the tax invoice.
        }
      }
      if (brand?.headerText) {
        doc.fontSize(8).fillColor("#DBEAFE").font("Helvetica");
        doc.text(brand.headerText, px(margin + 70, contentWidth * 0.4), 92, {
          width: contentWidth * 0.4,
          align: START,
        });
      }

      doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, px(margin, contentWidth * 0.5), 20, {
        width: contentWidth * 0.5,
        align: START,
      });

      doc.fontSize(17).fillColor("#BFDBFE").font("Helvetica-Bold");
      doc.text(invoiceTitle, px(margin + contentWidth * 0.5, contentWidth * 0.5), 20, {
        width: contentWidth * 0.5,
        align: END,
      });

      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor("#BFDBFE").font("Helvetica");
        doc.text(
          `${L("TRN", "الرقم الضريبي")}: ${company.trnVatNumber}`,
          px(margin + contentWidth * 0.5, contentWidth * 0.5),
          46,
          { width: contentWidth * 0.5, align: END }
        );
      }

      doc.fontSize(8).fillColor("#DBEAFE").font("Helvetica");
      let headerY = 62;
      for (const detail of [
        company.businessAddress,
        company.contactPhone ? `${L("Tel", "هاتف")}: ${company.contactPhone}` : null,
        company.contactEmail,
      ]) {
        if (!detail) continue;
        doc.text(detail, px(margin + contentWidth * 0.4, contentWidth * 0.6), headerY, {
          width: contentWidth * 0.6,
          align: END,
        });
        headerY += 11;
      }

      let y = 125;
      if (invoice.reverseCharge) {
        const bannerH = 40;
        doc.rect(margin, y, contentWidth, bannerH).fill("#FEF3C7").stroke("#F59E0B");
        doc.fontSize(9).fillColor("#92400E").font("Helvetica-Bold");
        doc.text(L("REVERSE CHARGE", "آلية الاحتساب العكسي"), margin + 10, y + 7, {
          width: contentWidth - 20,
          align: START,
        });
        doc.fontSize(8).fillColor("#78350F").font("Helvetica");
        doc.text(
          rtl
            ? "تُحتسب ضريبة القيمة المضافة من قبل المستلم بموجب آلية الاحتساب العكسي (قانون ضريبة القيمة المضافة الإماراتي). VAT is to be accounted for by the recipient under the reverse-charge mechanism."
            : "VAT is to be accounted for by the recipient under the reverse-charge mechanism (UAE VAT law).",
          margin + 10,
          y + 21,
          { width: contentWidth - 20, align: START }
        );
        y += bannerH + 10;
      }

      // Meta box: number, issue date, supply date, due date, currency
      const metaBoxH = 58;
      doc.rect(margin, y, contentWidth, metaBoxH).fill("#F0F9FF").stroke("#BAE6FD");
      const metaFields = [
        { label: L("Invoice No", "رقم الفاتورة"), value: invoice.number },
        { label: L("Issue Date", "تاريخ الإصدار"), value: formatDate(invoice.date) },
        { label: L("Date of Supply", "تاريخ التوريد"), value: formatDate(supplyDate) },
        {
          label: L("Due Date", "تاريخ الاستحقاق"),
          value: invoice.dueDate
            ? formatDate(invoice.dueDate)
            : paymentTermsLabel(invoice.paymentTerms, invoice.date),
        },
        { label: L("Currency", "العملة"), value: totals.currency },
      ];
      const metaColW = contentWidth / metaFields.length;
      metaFields.forEach((field, i) => {
        const cx = px(margin + i * metaColW, metaColW) + 6;
        doc.fontSize(6.5).fillColor("#6B7280").font("Helvetica");
        doc.text(field.label, cx, y + 9, { width: metaColW - 10, align: START });
        doc.fontSize(9).fillColor("#111827").font("Helvetica-Bold");
        doc.text(String(field.value), cx, y + 32, { width: metaColW - 10, align: START });
      });
      y += metaBoxH + 16;

      // Parties
      const halfW = contentWidth / 2 - 8;
      const partiesTop = y;
      const drawParty = (
        x: number,
        heading: string,
        name: string,
        trn: string | null | undefined,
        address: string | null | undefined
      ): number => {
        let cy = partiesTop;
        doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold");
        doc.text(heading, x, cy, { width: halfW, align: START });
        cy += 13;
        doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold");
        doc.text(name, x, cy, { width: halfW, align: START });
        cy += doc.heightOfString(name, { width: halfW }) + 2;
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        if (trn) {
          doc.text(`${L("TRN", "الرقم الضريبي")}: ${trn}`, x, cy, { width: halfW, align: START });
          cy += 12;
        }
        if (address) {
          doc.text(address, x, cy, { width: halfW, align: START });
          cy += doc.heightOfString(address, { width: halfW }) + 2;
        }
        return cy;
      };
      const fromX = px(margin, halfW);
      const toX = px(margin + halfW + 16, halfW);
      const fromEnd = drawParty(
        fromX,
        L("SUPPLIER", "المورّد"),
        company.legalName || company.name,
        isVATRegistered ? company.trnVatNumber : null,
        company.businessAddress
      );
      const toEnd = drawParty(
        toX,
        L("CUSTOMER", "العميل"),
        customer.name,
        customer.trn,
        customer.address
      );
      y = Math.max(fromEnd, toEnd) + 10;

      // Line table
      const baseCols = [
        { key: "desc", w: 140, label: L("Description", "الوصف"), align: START },
        { key: "qty", w: 30, label: L("Qty", "الكمية"), align: "center" as const },
        { key: "price", w: 58, label: L("Unit Price", "سعر الوحدة"), align: END },
        { key: "net", w: 64, label: L("Amount (excl. VAT)", "المبلغ قبل الضريبة"), align: END },
        { key: "type", w: 62, label: L("VAT Treatment", "المعالجة الضريبية"), align: START },
        { key: "rate", w: 32, label: L("VAT %", "الضريبة %"), align: "center" as const },
        { key: "vat", w: 56, label: L("VAT Amount", "قيمة الضريبة"), align: END },
        { key: "total", w: 53, label: L("Total", "الإجمالي"), align: END },
      ];
      // Column geometry: lay out in logical order, mirrored for Arabic-first documents.
      let acc = margin;
      const cols = baseCols.map((c) => {
        const x = px(acc, c.w);
        acc += c.w;
        return { ...c, x };
      });
      const cell = (key: string) => cols.find((c) => c.key === key)!;

      const drawTableHeader = () => {
        const headerH = 38;
        doc.rect(margin, y, contentWidth, headerH).fill(bandColor);
        doc.fontSize(6.5).fillColor("#FFFFFF").font("Helvetica-Bold");
        for (const c of cols) {
          doc.text(c.label, c.x + 2, y + 5, { width: c.w - 4, align: c.align });
        }
        y += headerH;
      };
      drawTableHeader();

      lines.forEach((line, index) => {
        const treatment = vatTreatmentForLine(line, !!invoice.reverseCharge);
        const label = TREATMENT_LABELS[treatment];
        // Net after line + allocated document discount (W3-A); legacy rows
        // without net_amount fall back to quantity × unit price.
        const storedNet = (line as InvoiceLine & { netAmount?: number | null }).netAmount;
        const net =
          storedNet !== null && storedNet !== undefined
            ? Math.abs(Number(storedNet))
            : line.quantity * line.unitPrice;
        const rate = line.vatRate ?? UAE_VAT_RATE;
        const vat = net * rate;
        doc.fontSize(8).font("Helvetica");
        const descH = doc.heightOfString(line.description, { width: cell("desc").w - 6 });
        const rowH = Math.max(26, descH + 10);
        if (y + rowH > 730) {
          doc.addPage();
          y = 50;
          drawTableHeader();
        }
        doc.rect(margin, y, contentWidth, rowH).fill(index % 2 === 0 ? "#FFFFFF" : "#F8FAFC");
        doc.rect(margin, y, contentWidth, rowH).stroke("#E5E7EB");
        doc.fillColor("#1F2937").fontSize(8).font("Helvetica");
        const ty = y + 6;
        const put = (key: string, value: string) => {
          const c = cell(key);
          doc.text(value, c.x + 3, ty, { width: c.w - 6, align: c.align });
        };
        put("desc", line.description);
        put("qty", formatQuantity(line.quantity));
        put("price", formatNumber(line.unitPrice));
        put("net", formatNumber(net));
        doc.fontSize(6.5);
        put("type", `${rtl ? label.ar : label.en}\n${rtl ? label.en : label.ar}`);
        doc.fontSize(8);
        put("rate", `${(rate * 100).toFixed(0)}%`);
        put("vat", formatNumber(vat));
        put("total", formatNumber(net + vat));
        y += rowH;
      });
      doc
        .moveTo(margin, y)
        .lineTo(margin + contentWidth, y)
        .stroke("#E5E7EB");
      y += 14;

      // VAT breakdown by treatment and rate
      const buckets = aggregateVatBuckets(lines, !!invoice.reverseCharge);
      if (buckets.length > 1 || (buckets[0] && buckets[0].treatment !== "standard_rated")) {
        const breakdownH = 22 + buckets.length * 14 + 8;
        if (y + breakdownH > 730) {
          doc.addPage();
          y = 50;
        }
        doc.rect(margin, y, contentWidth, breakdownH).fill("#F8FAFC").stroke("#E5E7EB");
        doc.fontSize(8.5).fillColor("#1E40AF").font("Helvetica-Bold");
        doc.text(L("VAT Breakdown", "تفاصيل ضريبة القيمة المضافة"), margin + 8, y + 6, {
          width: contentWidth - 16,
          align: START,
        });
        const bw = (contentWidth - 16) / 4;
        const bx = (i: number) => px(margin + 8 + i * bw, bw);
        let by = y + 20;
        doc.fontSize(7).fillColor("#6B7280").font("Helvetica");
        [
          L("Treatment", "المعالجة"),
          L("Taxable Amount", "المبلغ الخاضع"),
          L("VAT", "الضريبة"),
          L("Inclusive Total", "الإجمالي"),
        ].forEach((h, i) =>
          doc.text(h, bx(i), by, { width: bw - 4, align: i === 0 ? START : END })
        );
        by += 11;
        doc.fontSize(8).fillColor("#1F2937");
        for (const b of buckets) {
          const lbl = TREATMENT_LABELS[b.treatment];
          [
            `${rtl ? lbl.ar : lbl.en} ${(b.rate * 100).toFixed(0)}%`,
            formatNumber(b.taxable),
            formatNumber(b.vat),
            formatNumber(b.taxable + b.vat),
          ].forEach((v, i) =>
            doc.text(v, bx(i), by, { width: bw - 4, align: i === 0 ? START : END })
          );
          by += 14;
        }
        y += breakdownH + 10;
      }

      // Totals
      if (y + 190 > 740) {
        doc.addPage();
        y = 50;
      }
      const qrReserve = 90;
      const totalsW = 270;
      const totalsX = px(margin + contentWidth - totalsW, totalsW);
      const labelW = 170;
      const valueW = 100;
      const labelX = rtl ? totalsX + valueW : totalsX;
      const valueX = rtl ? totalsX : totalsX + labelW;
      const totalsTop = y;
      const totalsRow = (label: string, value: string, bold = false) => {
        doc
          .fontSize(9)
          .fillColor("#374151")
          .font(bold ? "Helvetica-Bold" : "Helvetica");
        doc.text(label, labelX, y, { width: labelW, align: START });
        doc.text(value, valueX, y, { width: valueW, align: END });
        y += 15;
      };
      const money = (n: number) => `${totals.currency} ${formatNumber(n)}`;
      const discountAmount = Number(
        (invoice as Invoice & { discountAmount?: number | null }).discountAmount ?? 0
      );
      if (discountAmount > 0) {
        totalsRow(L("Discount", "الخصم"), `- ${money(discountAmount)}`);
      }
      totalsRow(L("Subtotal (excl. VAT)", "المجموع قبل الضريبة"), money(totals.subtotal));
      totalsRow(
        invoice.reverseCharge
          ? L("VAT (reverse charge)", "الضريبة (احتساب عكسي)")
          : L("VAT", "ضريبة القيمة المضافة"),
        money(totals.vat)
      );
      if (totals.vatAed !== null) {
        totalsRow(
          L("VAT total (AED)", "إجمالي الضريبة (درهم)"),
          `AED ${formatNumber(totals.vatAed)}`
        );
        doc.fontSize(7).fillColor("#6B7280").font("Helvetica");
        doc.text(
          `${L("Exchange rate", "سعر الصرف")}: 1 ${totals.currency} = ${totals.exchangeRate.toFixed(4)} AED`,
          totalsX,
          y - 3,
          { width: totalsW, align: START }
        );
        y += 10;
      }
      totalsRow(L("Total", "الإجمالي"), money(totals.total), true);
      if (totals.amountPaid > 0) {
        totalsRow(L("Payments received", "المدفوعات المستلمة"), `- ${money(totals.amountPaid)}`);
      }
      y += 4;
      doc.rect(totalsX - 6, y - 5, totalsW + 12, 28).fill(totals.paid ? "#15803D" : "#1E40AF");
      doc.fontSize(11).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(rtl ? "المبلغ المستحق / AMOUNT DUE" : "AMOUNT DUE / المبلغ المستحق", labelX, y + 3, {
        width: labelW,
        align: START,
      });
      doc.text(money(totals.amountDue), valueX, y + 3, { width: valueW, align: END });
      let totalsBottom = y + 28;
      if (totals.paid) {
        doc.fontSize(8).fillColor("#15803D").font("Helvetica-Bold");
        doc.text(L("PAID IN FULL", "مدفوعة بالكامل"), labelX, totalsBottom + 3, {
          width: labelW + valueW,
          align: END,
        });
        totalsBottom += 14;

        const stampX = px(margin, 160) + 4;
        const stampY = totalsTop + 36;
        doc.save();
        doc.rotate(-12, { origin: [stampX + 75, stampY + 19] });
        doc.lineWidth(2).strokeColor("#15803D");
        doc.roundedRect(stampX, stampY, 150, 38, 4).stroke();
        doc.fontSize(18).fillColor("#15803D").font("Helvetica-Bold");
        doc.text(L("PAID", "مدفوعة"), stampX, stampY + 9, { width: 150, align: "center" });
        doc.restore();
        doc.lineWidth(1);
      }

      y = totalsBottom + 14;

      if (invoice.paymentTerms) {
        doc.fontSize(8).fillColor("#374151").font("Helvetica");
        doc.text(
          `${L("Payment Terms", "شروط الدفع")}: ${paymentTermsText(invoice.paymentTerms)}`,
          margin,
          y,
          { width: contentWidth - qrReserve, align: START }
        );
        y += 14;
      }
      for (const extra of [brand?.termsText, brand?.bankDetails]) {
        if (!extra) continue;
        doc.fontSize(7.5).fillColor("#374151").font("Helvetica");
        doc.text(extra, margin, y, { width: contentWidth - qrReserve - 10, align: START });
        y += doc.heightOfString(extra, { width: contentWidth - qrReserve - 10 }) + 6;
      }

      const qrSize = 72;
      const qrX = px(margin + contentWidth - qrSize, qrSize);
      const qrY = Math.min(Math.max(y - 4, totalsBottom + 10), 650);
      if (qrPng) {
        doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
        doc.fontSize(6).fillColor("#6B7280").font("Helvetica");
        doc.text(L("Invoice QR (TLV)", "رمز الفاتورة QR"), qrX - 14, qrY + qrSize + 2, {
          width: qrSize + 28,
          align: "center",
        });
      } else {
        doc.rect(qrX, qrY, qrSize, qrSize).stroke("#D1D5DB");
        doc.fontSize(6).fillColor("#9CA3AF").font("Helvetica");
        doc.text("QR", qrX, qrY + qrSize / 2 - 6, { width: qrSize, align: "center" });
        doc.text("(N/A)", qrX, qrY + qrSize / 2 + 2, { width: qrSize, align: "center" });
      }

      const footerY = 765;
      doc
        .moveTo(margin, footerY - 8)
        .lineTo(margin + contentWidth, footerY - 8)
        .stroke("#E5E7EB");
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text(
        brand?.footerText || L("Thank you for your business.", "شكراً لتعاملكم معنا."),
        margin,
        footerY,
        {
          width: contentWidth,
          align: "center",
        }
      );
      if (isVATRegistered) {
        doc.fontSize(7).fillColor("#9CA3AF");
        doc.text(
          rtl
            ? "هذه فاتورة ضريبية صادرة إلكترونياً وصالحة بدون توقيع. This is a computer-generated tax invoice and is valid without a signature."
            : "This is a computer-generated tax invoice and is valid without a signature. هذه فاتورة ضريبية صادرة إلكترونياً وصالحة بدون توقيع.",
          margin,
          footerY + 12,
          { width: contentWidth, align: "center" }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function generateNraInvoicePDF(invoice: Invoice, lines: InvoiceLine[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: "Najma Al Raeda Accounting Services",
          Subject: "Invoice",
          Creator: "Muhasib.ai",
        },
      });

      if (isArabic(invoice.customerName) || lines.some((line) => isArabic(line.description))) {
        preparePdfDocument(doc);
      }

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      drawNraInvoiceTitle(doc);
      drawNraDateInvoiceBox(doc, invoice);
      drawNraHeader(doc);
      drawNraBillToBox(doc, invoice);
      drawNraLineItemsTable(doc, lines);
      drawNraTotalBox(doc, invoice);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawNraInvoiceTitle(doc: PdfDoc) {
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#000000");
  doc.text("Invoice", 0, 45, { width: PAGE_WIDTH, align: "center" });
}

function drawNraDateInvoiceBox(doc: PdfDoc, invoice: Invoice) {
  const x = 432;
  const y = 38;
  const w = 145;
  const h = 39;
  const colW = w / 2;
  const headerH = 15;

  doc.lineWidth(1).strokeColor(BORDER).fillColor("#FFFFFF");
  doc.rect(x, y, w, h).stroke();
  doc
    .moveTo(x + colW, y)
    .lineTo(x + colW, y + h)
    .stroke();
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  doc.text("Date", x, y + 3, { width: colW, align: "center" });
  doc.text("Invoice #", x + colW, y + 3, { width: colW, align: "center" });

  doc.font("Times-Roman").fontSize(10.5);
  doc.text(formatNraInvoiceDate(invoice.date), x, y + 24, { width: colW, align: "center" });
  drawNraSingleLineCellText(doc, invoice.number, x + colW, y + 24, colW);
}

function drawNraHeader(doc: PdfDoc) {
  const centerX = PAGE_WIDTH / 2;
  const logoTop = 70;

  doc.save();
  doc.strokeColor(NR_GREEN).fillColor(NR_GREEN).lineWidth(4).lineJoin("miter").lineCap("butt");

  doc
    .moveTo(centerX - 83, logoTop + 50)
    .lineTo(centerX - 30, logoTop + 50)
    .lineTo(centerX - 7, logoTop + 25)
    .lineTo(centerX + 17, logoTop + 50)
    .lineTo(centerX + 75, logoTop - 18)
    .stroke();

  doc
    .path(
      `M ${centerX + 75} ${logoTop - 18} L ${centerX + 64} ${logoTop + 2} L ${centerX + 89} ${logoTop - 29} Z`
    )
    .fill(NR_GREEN);

  doc.lineWidth(2);
  doc
    .moveTo(centerX - 83, logoTop + 50)
    .lineTo(centerX + 85, logoTop + 50)
    .stroke();
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(21).fillColor(NR_GREEN);
  doc.text("NAJMA AL RAEDA", 0, 131, { width: PAGE_WIDTH, align: "center" });

  doc.lineWidth(1.4).strokeColor(NR_GREEN);
  doc
    .moveTo(centerX - 83, 158)
    .lineTo(centerX + 83, 158)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NR_GREEN);
  doc.text("A C C O U N T I N G   S E R V I C E S", 0, 166, {
    width: PAGE_WIDTH,
    align: "center",
  });

  doc.font("Times-Roman").fontSize(12).fillColor("#000000");
  doc.text("Al Futtaim Tower, 202", 0, 183, { width: PAGE_WIDTH, align: "center" });
  doc.text("Baniyas Square,", 0, 198, { width: PAGE_WIDTH, align: "center" });
  doc.text("Dubai, U.A.E.", 0, 213, { width: PAGE_WIDTH, align: "center" });
  doc.text("971-50-7042270", 0, 228, { width: PAGE_WIDTH, align: "center" });
}

function drawNraBillToBox(doc: PdfDoc, invoice: Invoice) {
  const x = 370;
  const y = 220;
  const w = 185;
  const h = 96;
  const headerH = 24;

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10.5).fillColor("#000000");
  doc.text("Bill To", x + 12, y + 8, { width: w - 24 });

  doc.font("Times-Roman").fontSize(9.5).fillColor("#222222");
  doc.text(invoice.customerName, x + 4, y + headerH + 5, {
    width: w - 4,
    height: h - headerH - 8,
  });
}

function drawNraLineItemsTable(doc: PdfDoc, lines: InvoiceLine[]) {
  const x = 36;
  const y = 345;
  const w = 523;
  const h = 398;
  const headerH = 20;
  const widths = [46, 150, 190, 74, 63];
  const headers = ["Quantity", "Item Code", "Description", "Price Each", "Amount"];
  const colX = widths.reduce<number[]>(
    (acc, width) => {
      acc.push(acc[acc.length - 1] + width);
      return acc;
    },
    [x]
  );

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc.rect(x, y, w, headerH).fillAndStroke(HEADER_FILL, BORDER);

  for (let i = 1; i < colX.length - 1; i += 1) {
    doc
      .moveTo(colX[i], y)
      .lineTo(colX[i], y + h)
      .stroke();
  }
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  headers.forEach((header, index) => {
    doc.text(header, colX[index] + 2, y + 5, {
      width: widths[index] - 4,
      align: "center",
    });
  });

  let rowY = y + headerH + 5;
  doc.font("Times-Roman").fontSize(10).fillColor("#111111");
  for (const line of lines) {
    if (rowY > y + h - 18) break;
    const parsed = splitLineDescription(line.description);
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0);

    doc.text(formatNraQuantity(line.quantity), colX[0] + 3, rowY, {
      width: widths[0] - 6,
      align: "center",
    });
    doc.text(parsed.itemCode, colX[1] + 3, rowY, { width: widths[1] - 6 });
    doc.text(parsed.description, colX[2] + 3, rowY, { width: widths[2] - 6 });
    doc.text(formatNraPlainAmount(Number(line.unitPrice || 0)), colX[3] + 3, rowY, {
      width: widths[3] - 8,
      align: "right",
    });
    doc.text(formatNraPlainAmount(amount), colX[4] + 3, rowY, {
      width: widths[4] - 8,
      align: "right",
    });

    rowY += Math.max(
      17,
      nraTextHeight(doc, parsed.itemCode, widths[1] - 6),
      nraTextHeight(doc, parsed.description, widths[2] - 6)
    );
  }
}

function drawNraTotalBox(doc: PdfDoc, invoice: Invoice) {
  const x = 36;
  const y = 748;
  const w = 523;
  const h = 40;
  const splitX = 414;

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc
    .moveTo(splitX, y)
    .lineTo(splitX, y + h)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#000000");
  doc.text("Total", splitX + 13, y + 13, { width: 95 });

  doc.font("Times-Roman").fontSize(10.5);
  doc.text(
    formatNraTotalAmount(Number(invoice.total || 0), invoice.currency),
    splitX + 72,
    y + 17,
    {
      width: x + w - splitX - 84,
      align: "right",
    }
  );
}

type VatBucket = { treatment: VatTreatment; rate: number; taxable: number; vat: number };

function aggregateVatBuckets(lines: InvoiceLine[], reverseCharge: boolean): VatBucket[] {
  const buckets = new Map<string, VatBucket>();
  for (const line of lines) {
    const rate = line.vatRate ?? UAE_VAT_RATE;
    const treatment = vatTreatmentForLine(line, reverseCharge);
    const storedNet = (line as InvoiceLine & { netAmount?: number | null }).netAmount;
    const taxable =
      storedNet !== null && storedNet !== undefined
        ? Math.abs(Number(storedNet))
        : line.quantity * line.unitPrice;
    const vat = taxable * rate;
    const key = `${treatment}:${rate}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.taxable += taxable;
      existing.vat += vat;
    } else {
      buckets.set(key, { treatment, rate, taxable, vat });
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) => a.rate - b.rate || a.treatment.localeCompare(b.treatment)
  );
}

function formatNumber(amount: number): string {
  return Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
}

function splitLineDescription(description: string): { itemCode: string; description: string } {
  const lines = description
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    return { itemCode: lines[0], description: lines.slice(1).join(" ") };
  }

  const dashMatch = description.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    return { itemCode: dashMatch[1].trim(), description: dashMatch[2].trim() };
  }

  return { itemCode: description, description: "" };
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function paymentTermsLabel(terms: string | null | undefined, invoiceDate: Date | string): string {
  if (!terms) return "—";
  const days = paymentTermsDays(terms);
  if (days === null) return formatPaymentTerms(terms);
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + days);
  return formatDate(due);
}

function paymentTermsDays(terms: string): number | null {
  const map: Record<string, number> = {
    net7: 7,
    net14: 14,
    net30: 30,
    net60: 60,
    net90: 90,
    immediate: 0,
    cod: 0,
  };
  return map[terms.toLowerCase()] ?? null;
}

function formatPaymentTerms(terms: string): string {
  const labels: Record<string, string> = {
    net7: "Net 7 days",
    net14: "Net 14 days",
    net30: "Net 30 days",
    net60: "Net 60 days",
    net90: "Net 90 days",
    immediate: "Due Immediately",
    cod: "Cash on Delivery",
  };
  return labels[terms.toLowerCase()] || terms;
}

function paymentTermsText(terms: string): string {
  return formatPaymentTerms(terms);
}

function nraTextHeight(doc: PdfDoc, text: string, width: number): number {
  return doc.heightOfString(text || " ", { width }) + 4;
}

function drawNraSingleLineCellText(doc: PdfDoc, text: string, x: number, y: number, width: number) {
  let fontSize = 10.5;
  doc.font("Times-Roman").fontSize(fontSize);
  while (fontSize > 7 && doc.widthOfString(text) > width - 6) {
    fontSize -= 0.5;
    doc.fontSize(fontSize);
  }
  doc.text(text, x, y + (10.5 - fontSize) / 3, {
    width,
    align: "center",
    lineBreak: false,
  });
}

function formatNraInvoiceDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}/${d.getFullYear()}`;
}

function formatNraQuantity(quantity: number): string {
  if (quantity === 1) return "";
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

function formatNraPlainAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNraTotalAmount(amount: number, currency: string = "AED"): string {
  return `${currency} ${formatNraPlainAmount(amount)}`;
}

/**
 * Delivery note derived from an invoice (W3-A, R03-24): goods and quantities
 * only — no prices or VAT — with receiver signature boxes. Not a tax document.
 */
export async function generateDeliveryNotePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: { locale?: PdfLocale } = {}
): Promise<Buffer> {
  const locale = options.locale ?? pdfLocale(company);
  const rtl = locale === "ar";
  const L = (en: string, ar: string) => bilingual(locale, en, ar);
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Delivery Note ${invoice.number}`,
          Author: company.name,
          Creator: "Muhasib.ai",
        },
      });
      preparePdfDocument(doc);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const margin = 50;
      const contentWidth = PAGE_WIDTH - 2 * margin;
      const START: "left" | "right" = rtl ? "right" : "left";
      const END: "left" | "right" = rtl ? "left" : "right";

      doc.fontSize(18).fillColor("#111827").font("Helvetica-Bold");
      doc.text(L("Delivery Note", "إشعار تسليم"), margin, 50, { width: contentWidth, align: END });
      doc.fontSize(12).text(company.legalName || company.name, margin, 50, {
        width: contentWidth / 2,
        align: START,
      });
      doc.fontSize(9).font("Helvetica").fillColor("#374151");
      let y = 80;
      for (const [label, value] of [
        [L("Reference invoice", "الفاتورة المرجعية"), invoice.number],
        [L("Date", "التاريخ"), formatDate(invoice.supplyDate ?? invoice.date)],
        [L("Deliver to", "التسليم إلى"), invoice.customerName],
        [L("Address", "العنوان"), invoice.customerAddress || "—"],
      ] as Array<[string, string]>) {
        doc.text(`${label}: ${value}`, margin, y, { width: contentWidth, align: START });
        y += 14;
      }
      y += 10;
      doc.rect(margin, y, contentWidth, 22).fill(HEADER_FILL);
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9);
      doc.text("#", margin + 6, y + 6, { width: 24, align: START });
      doc.text(L("Description", "الوصف"), margin + 34, y + 6, {
        width: contentWidth - 140,
        align: START,
      });
      doc.text(L("Quantity", "الكمية"), margin + contentWidth - 100, y + 6, {
        width: 94,
        align: END,
      });
      y += 26;
      doc.font("Helvetica").fontSize(9);
      lines.forEach((line, i) => {
        const h = Math.max(
          18,
          doc.heightOfString(line.description, { width: contentWidth - 140 }) + 6
        );
        if (y + h > 700) {
          doc.addPage();
          y = 50;
        }
        doc.text(String(i + 1), margin + 6, y, { width: 24, align: START });
        doc.text(line.description, margin + 34, y, { width: contentWidth - 140, align: START });
        doc.text(formatQuantity(Math.abs(line.quantity)), margin + contentWidth - 100, y, {
          width: 94,
          align: END,
        });
        y += h;
        doc
          .moveTo(margin, y - 2)
          .lineTo(margin + contentWidth, y - 2)
          .stroke("#E5E7EB");
      });
      y = Math.max(y + 40, 620);
      const boxW = contentWidth / 2 - 10;
      for (const [i, label] of [
        L("Delivered by", "سُلّم بواسطة"),
        L("Received by (name, signature, date)", "استلم بواسطة (الاسم، التوقيع، التاريخ)"),
      ].entries()) {
        const x = margin + i * (boxW + 20);
        doc.rect(x, y, boxW, 70).stroke(BORDER);
        doc
          .fontSize(8)
          .fillColor("#6B7280")
          .text(label, x + 6, y + 6, { width: boxW - 12, align: START });
      }
      doc
        .fontSize(7)
        .fillColor("#9CA3AF")
        .text(
          L("This delivery note is not a tax invoice.", "إشعار التسليم هذا ليس فاتورة ضريبية."),
          margin,
          y + 90,
          { width: contentWidth, align: "center" }
        );
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

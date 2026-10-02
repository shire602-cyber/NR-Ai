import { createPdfDocument } from "./pdf-fonts";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { UAE_VAT_RATE } from "../constants";
import { renderEInvoiceQrPng } from "./einvoice-qr.service";
import { fitFontSize } from "./pdf-layout";
import { formatUnitPriceCurrency, formatUnitPrice } from "../../shared/format-unit-price";
import { advanceTitles, buildPdfRows, SALES_ROW_LABELS } from "./pdf-sales-rows";
import { pdfFieldsFor } from "./custom-fields.service";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { customerContacts, invoices } from "../../shared/schema";

const PAGE_WIDTH = 595.28;
const NR_GREEN = "#6F9E3A";
const BORDER = "#111111";
const HEADER_FILL = "#E6E6E6";
type PdfDoc = any;

export type InvoicePdfTemplate = "standard" | "nra";

export interface PdfCustomField {
  labelEn: string;
  labelAr: string;
  value: string;
}

export interface GenerateInvoicePdfOptions {
  template?: InvoicePdfTemplate;
  /** Custom fields flagged for PDFs; loaded from the database when omitted. */
  customFields?: PdfCustomField[];
}

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

  let customFields = options.customFields;
  if (!customFields) {
    try {
      customFields = await pdfFieldsFor(invoice.companyId, "invoice", invoice.id);
    } catch {
      customFields = []; // a PDF must never fail because a custom-field read did
    }
  }
  return generateStandardInvoicePDF(invoice, lines, company, customFields, await loadPdfContext(invoice));
}

/** What the page needs beyond the invoice row: the invoice a credit note corrects, and the customer's own details. */
interface PdfContext {
  original: { number: string; date: Date | string } | null;
  buyerTrn: string | null;
  buyerAddress: string | null;
}

async function loadPdfContext(invoice: Invoice): Promise<PdfContext> {
  const ctx: PdfContext = { original: null, buyerTrn: null, buyerAddress: null };
  try {
    if (invoice.invoiceType === "credit_note" && invoice.originalInvoiceId) {
      const [orig] = await db
        .select({ number: invoices.number, date: invoices.date })
        .from(invoices)
        .where(and(eq(invoices.id, invoice.originalInvoiceId), eq(invoices.companyId, invoice.companyId)));
      ctx.original = orig ?? null;
    }
    if (invoice.contactId) {
      const [c] = await db
        .select()
        .from(customerContacts)
        .where(and(eq(customerContacts.id, invoice.contactId), eq(customerContacts.companyId, invoice.companyId)));
      if (c) {
        ctx.buyerTrn = c.trnNumber ?? null;
        const parts = [c.address, c.city, c.country].map((x) => (x ?? "").trim()).filter(Boolean);
        ctx.buyerAddress = parts.length ? parts.join(", ") : null;
      }
    }
  } catch {
    // a PDF must never fail because a lookup did: it prints what the invoice itself holds
  }
  return ctx;
}

async function generateStandardInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  customFields: PdfCustomField[] = [],
  ctx: PdfContext = { original: null, buyerTrn: null, buyerAddress: null }
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

  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: company.name,
          Subject: "Tax Invoice",
          Creator: "Muhasib.ai",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 595.28;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      const isVATRegistered = !!company.trnVatNumber;
      const advanceTitle = advanceTitles(invoice.invoiceType, lines as any);
      // A credit note is a TAX CREDIT NOTE (Art. 60); an opening-balance item is not a supply at all: it prints as the
      // balance brought forward, with no VAT wording.
      const isCreditNote = invoice.invoiceType === "credit_note";
      const isOpeningBalance = !!(invoice as any).isOpeningBalance;
      const sign = isCreditNote ? -1 : 1;
      const invoiceLabelEn = isOpeningBalance
        ? "OPENING BALANCE"
        : isCreditNote
          ? isVATRegistered ? "TAX CREDIT NOTE" : "CREDIT NOTE"
          : advanceTitle ? advanceTitle.en : isVATRegistered ? "TAX INVOICE" : "INVOICE";
      const invoiceLabelAr = isOpeningBalance
        ? "رصيد افتتاحي"
        : isCreditNote
          ? isVATRegistered ? "إشعار دائن ضريبي" : "إشعار دائن"
          : advanceTitle ? advanceTitle.ar : isVATRegistered ? "فاتورة ضريبية" : "فاتورة";
      const showVat = !isOpeningBalance;

      doc.rect(0, 0, pageWidth, 110).fill("#1E40AF");

      // The name is fitted to one line (22pt down to 12pt): a long legal name used to wrap onto the TRN line below it.
      doc.font("Helvetica-Bold");
      doc.fontSize(fitFontSize(doc, company.name, contentWidth * 0.65, 22, 12)).fillColor("#FFFFFF");
      doc.text(company.name, margin, 24, { width: contentWidth * 0.65, align: "left" });

      doc.fontSize(18).fillColor("#BFDBFE").font("Helvetica-Bold");
      doc.text(invoiceLabelEn, margin, 24, { width: contentWidth, align: "right" });
      doc.fontSize(11).fillColor("#DBEAFE").font("Helvetica");
      doc.text(invoiceLabelAr, margin, 46, { width: contentWidth, align: "right" });

      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor("#BFDBFE").font("Helvetica");
        doc.text(`TRN / الرقم الضريبي - ${company.trnVatNumber}`, margin, 56, {
          width: contentWidth * 0.65,
          align: "left",
        });
      }

      doc.fontSize(8).fillColor("#DBEAFE").font("Helvetica");
      let headerRightY = 70;
      if (company.businessAddress) {
        doc.text(company.businessAddress, margin, headerRightY, {
          width: contentWidth,
          align: "right",
        });
        headerRightY += 11 * countLines(company.businessAddress);
      }
      if (company.contactPhone) {
        doc.text(`Tel: ${company.contactPhone}`, margin, headerRightY, {
          width: contentWidth,
          align: "right",
        });
        headerRightY += 11;
      }
      if (company.contactEmail) {
        doc.text(company.contactEmail, margin, headerRightY, {
          width: contentWidth,
          align: "right",
        });
      }

      let y = 125;
      if (invoice.reverseCharge) {
        const bannerH = 38;
        doc.rect(margin, y, contentWidth, bannerH).fill("#FEF3C7").stroke("#F59E0B");
        doc.fontSize(9).fillColor("#92400E").font("Helvetica-Bold");
        doc.text("REVERSE CHARGE / آلية الاحتساب العكسي", margin + 10, y + 7, {
          width: contentWidth - 20,
        });
        doc.fontSize(8).fillColor("#78350F").font("Helvetica");
        doc.text(
          "VAT is to be accounted for by the recipient under the reverse-charge mechanism (UAE VAT law).",
          margin + 10,
          y + 21,
          { width: contentWidth - 20 }
        );
        y += bannerH + 10;
      }

      const metaBoxH = 55;
      doc.rect(margin, y, contentWidth, metaBoxH).fill("#F0F9FF").stroke("#BAE6FD");

      // An advance (deposit) invoice has no payment terms and no due date: it is paid when issued.
      const isAdvanceInvoice = invoice.invoiceType === "advance";
      const metaFields = [
        { label: isCreditNote ? "Credit Note # / رقم الإشعار" : "Invoice # / رقم الفاتورة", value: invoice.number },
        { label: "Issue Date / تاريخ الإصدار", value: formatDate(invoice.date) },
        // A credit note names the tax invoice it corrects, by number and date (Art. 60).
        ...(isCreditNote
          ? [
              {
                label: "Original Tax Invoice / الفاتورة الأصلية",
                value: ctx.original ? `${ctx.original.number} (${formatDate(ctx.original.date)})` : "-",
              },
            ]
          : []),
        ...(isAdvanceInvoice || isCreditNote
          ? []
          : [
              {
                label: "Due Date / تاريخ الاستحقاق",
                value: invoice.dueDate
                  ? formatDate(invoice.dueDate)
                  : paymentTermsLabel(invoice.paymentTerms, invoice.date),
              },
            ]),
        { label: "Status / الحالة", value: (invoice.status || "draft").toUpperCase() },
      ];

      const metaColWidth = contentWidth / metaFields.length;
      metaFields.forEach((field, i) => {
        const x = margin + i * metaColWidth + 8;
        doc.fontSize(7).fillColor("#6B7280").font("Helvetica");
        doc.text(field.label, x, y + 10, { width: metaColWidth - 10 });
        doc.fontSize(9).fillColor("#111827").font("Helvetica-Bold");
        doc.text(field.value, x, y + 26, { width: metaColWidth - 10 });
      });

      y += metaBoxH + 16;

      const halfW = contentWidth / 2 - 8;
      const partiesTop = y;

      doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold");
      doc.text("FROM / من", margin, partiesTop);
      let fromY = partiesTop + 13;
      doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold");
      doc.text(company.name, margin, fromY, { width: halfW });
      fromY += Math.max(15, doc.heightOfString(company.name, { width: halfW }) + 2);
      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        doc.text(`TRN: ${company.trnVatNumber}`, margin, fromY, { width: halfW });
        fromY += 12;
      }
      if (company.businessAddress) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        doc.text(company.businessAddress, margin, fromY, { width: halfW });
        fromY += Math.max(
          12 * countLines(company.businessAddress),
          doc.heightOfString(company.businessAddress, { width: halfW })
        );
      }

      const toX = margin + halfW + 16;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold");
      doc.text("BILL TO / إلى", toX, partiesTop);
      let toY = partiesTop + 13;
      doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold");
      doc.text(invoice.customerName, toX, toY, { width: halfW });
      toY += Math.max(15, doc.heightOfString(invoice.customerName, { width: halfW }) + 2);
      // The recipient's TRN and address come from the invoice, else from the customer contact (Art. 59(1)(d)).
      const buyerTrn = invoice.customerTrn || ctx.buyerTrn;
      const buyerAddress = invoice.customerAddress || ctx.buyerAddress;
      if (buyerTrn && !isOpeningBalance) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        doc.text(`TRN: ${buyerTrn}`, toX, toY, { width: halfW });
        toY += 12;
      }
      if (buyerAddress) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        doc.text(buyerAddress, toX, toY, { width: halfW });
        toY += Math.max(12 * countLines(buyerAddress), doc.heightOfString(buyerAddress, { width: halfW }));
      }

      y = Math.max(fromY, toY) + 10;

      // Custom fields flagged "show on PDF": both labels, e.g. "PO Number / رقم أمر الشراء: PO-7781".
      if (customFields.length > 0) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        for (const field of customFields) {
          const text = `${field.labelEn} / ${field.labelAr}: ${field.value}`;
          doc.text(text, margin, y, { width: contentWidth });
          y += Math.max(12, doc.heightOfString(text, { width: contentWidth }) + 2);
        }
        y += 6;
      }

      const tableTop = y;
      const rowH = 22;
      const colX = {
        desc: margin + 5,
        qty: margin + 222,
        price: margin + 258,
        disc: margin + 318,
        vat: margin + 362,
        amount: pageWidth - margin - 5,
      };
      const colWidths = {
        desc: 215,
        qty: 36,
        price: 58,
        disc: 44,
        vat: 44,
        amount: 78,
      };

      doc.rect(margin, tableTop, contentWidth, rowH).fill("#1E40AF");
      doc.fontSize(8).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("Description", colX.desc, tableTop + 7);
      doc.text("Qty", colX.qty, tableTop + 7, { width: colWidths.qty, align: "center" });
      doc.text("Unit Price", colX.price, tableTop + 7, { width: colWidths.price, align: "right" });
      doc.text(SALES_ROW_LABELS.discountColumn.en, colX.disc, tableTop + 7, { width: colWidths.disc, align: "right" });
      if (showVat) doc.text("VAT %", colX.vat, tableTop + 7, { width: colWidths.vat, align: "center" });
      doc.text("Amount", colX.amount - colWidths.amount - 1, tableTop + 7, {
        width: colWidths.amount,
        align: "right",
      });

      y = tableTop + rowH;

      doc.font("Helvetica").fillColor("#1F2937").fontSize(9);
      // Line discounts print on their item (Disc. column, net amount); document discounts, delivery and the
      // advances deducted get a row of their own (see pdf-sales-rows.ts).
      const printRows = buildPdfRows(lines as any[]);
      printRows.forEach((row, index) => {
        const bgColor = index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        doc.rect(margin, y, contentWidth, rowH).fill(bgColor);
        doc.rect(margin, y, contentWidth, rowH).stroke("#E5E7EB");

        const vatPercent = (row.vatRate * 100).toFixed(0);
        const description =
          row.kind === "discount"
            ? `${SALES_ROW_LABELS.discount.en} / ${SALES_ROW_LABELS.discount.ar}`
            : row.kind === "shipping"
              ? `${row.description || SALES_ROW_LABELS.shipping.en} / ${SALES_ROW_LABELS.shipping.ar}`
              : row.description;

        doc.fillColor("#1F2937").fontSize(9);
        if (row.kind === "advance") {
          // "Less advance ADV-2026-00001 (INV-2026-00007)": one line, shrunk to the column when long.
          doc.fontSize(fitFontSize(doc, description, colWidths.desc, 9));
          doc.text(description, colX.desc, y + 7, { width: colWidths.desc, lineBreak: false });
          doc.fontSize(9);
        } else {
          doc.text(description, colX.desc, y + 7, { width: colWidths.desc });
        }
        if (row.quantity !== null) {
          doc.text(Math.abs(row.quantity).toString(), colX.qty, y + 7, { width: colWidths.qty, align: "center" });
        }
        if (row.unitPrice !== null) {
          const unitPriceText = formatUnitPriceCurrency(row.unitPrice, invoice.currency);
          doc.fontSize(fitFontSize(doc, unitPriceText, colWidths.price, 9));
          doc.text(unitPriceText, colX.price, y + 7, {
            width: colWidths.price,
            align: "right",
            lineBreak: false,
          });
          doc.fontSize(9);
        }
        if (row.discountLabel) {
          doc.text(row.discountLabel, colX.disc, y + 7, { width: colWidths.disc, align: "right", lineBreak: false });
        }
        if (showVat) doc.text(`${vatPercent}%`, colX.vat, y + 7, { width: colWidths.vat, align: "center" });
        // A credit note's lines are stored negative; it prints positive amounts (a discount line then shows negative).
        doc.text(
          formatAmount(row.amount * sign === 0 ? 0 : row.amount * sign, invoice.currency),
          colX.amount - colWidths.amount - 1,
          y + 7,
          { width: colWidths.amount, align: "right" }
        );

        y += rowH;
      });

      doc
        .moveTo(margin, y)
        .lineTo(margin + contentWidth, y)
        .stroke("#E5E7EB");

      y += 16;

      const vatBuckets = showVat
        ? aggregateVatByRate(lines).map((b) => ({ ...b, taxable: b.taxable * sign, vat: b.vat * sign }))
        : [];
      if (vatBuckets.length > 1) {
        const breakdownTop = y;
        const breakdownH = 18 + vatBuckets.length * 16 + 6;
        doc.rect(margin, breakdownTop, contentWidth, breakdownH).fill("#F8FAFC").stroke("#E5E7EB");

        doc.fontSize(9).fillColor("#1E40AF").font("Helvetica-Bold");
        doc.text("VAT Breakdown / تفاصيل ضريبة القيمة المضافة", margin + 8, breakdownTop + 6);

        const cols = {
          rate: margin + 8,
          taxable: margin + 120,
          vat: margin + 260,
        };
        const breakdownRowY = breakdownTop + 22;
        doc.fontSize(7).fillColor("#6B7280").font("Helvetica");
        doc.text("Rate", cols.rate, breakdownRowY);
        doc.text("Taxable Amount", cols.taxable, breakdownRowY);
        doc.text("VAT", cols.vat, breakdownRowY);
        doc.text("Inclusive Total", margin + contentWidth - 100 - 8, breakdownRowY, {
          width: 100,
          align: "right",
        });

        let bRowY = breakdownRowY + 10;
        doc.fontSize(9).fillColor("#1F2937").font("Helvetica");
        for (const bucket of vatBuckets) {
          doc.text(`${(bucket.rate * 100).toFixed(0)}%`, cols.rate, bRowY);
          doc.text(formatAmount(bucket.taxable, invoice.currency), cols.taxable, bRowY);
          doc.text(formatAmount(bucket.vat, invoice.currency), cols.vat, bRowY);
          doc.text(
            formatAmount(bucket.taxable + bucket.vat, invoice.currency),
            margin + contentWidth - 100 - 8,
            bRowY,
            { width: 100, align: "right" }
          );
          bRowY += 14;
        }

        y = breakdownTop + breakdownH + 10;
      }

      const totalsX = margin + contentWidth - 200;
      const labelW = 120;
      const valueW = 80;

      doc.fontSize(9).fillColor("#374151").font("Helvetica");
      if (showVat) {
        doc.text("Subtotal:", totalsX, y, { width: labelW });
        doc.text(formatAmount(Math.abs(invoice.subtotal), invoice.currency), totalsX + labelW, y, {
          width: valueW,
          align: "right",
        });
        y += 16;

        const vatLabel = invoice.reverseCharge
          ? "VAT (reverse charge):"
          : vatBuckets.length === 1
            ? `VAT (${(vatBuckets[0].rate * 100).toFixed(0)}%):`
            : "VAT:";
        doc.text(vatLabel, totalsX, y, { width: labelW });
        doc.text(formatAmount(Math.abs(invoice.vatAmount), invoice.currency), totalsX + labelW, y, {
          width: valueW,
          align: "right",
        });
        y += 10;
      }

      doc
        .moveTo(totalsX, y)
        .lineTo(totalsX + labelW + valueW, y)
        .stroke("#D1D5DB");
      y += 8;

      doc.rect(totalsX - 8, y - 6, labelW + valueW + 16, 28).fill("#1E40AF");
      doc.fontSize(12).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(isCreditNote ? "Credit amount:" : isOpeningBalance ? "Balance:" : "TOTAL DUE:", totalsX, y + 2, { width: labelW });
      doc.text(formatAmount(Math.abs(invoice.total), invoice.currency), totalsX + labelW, y + 2, {
        width: valueW,
        align: "right",
        lineBreak: false,
      });

      y += 40;

      if (invoice.paymentTerms && invoice.invoiceType !== "advance" && !isCreditNote) {
        doc.fontSize(8).fillColor("#374151").font("Helvetica-Bold");
        doc.text("Payment Terms:", margin, y);
        doc.font("Helvetica").fillColor("#6B7280");
        doc.text(paymentTermsText(invoice.paymentTerms), margin + 90, y);
        y += 16;
      }

      const qrSize = 72;
      const qrX = pageWidth - margin - qrSize;
      const qrY = y - 16;
      if (qrPng) {
        doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
        doc.fontSize(6).fillColor("#6B7280").font("Helvetica");
        doc.text("Invoice summary", qrX, qrY + qrSize + 2, { width: qrSize, align: "center" });
      } else {
        doc.rect(qrX, qrY, qrSize, qrSize).stroke("#D1D5DB");
        doc.fontSize(6).fillColor("#9CA3AF").font("Helvetica");
        doc.text("QR CODE", qrX, qrY + qrSize / 2 - 6, { width: qrSize, align: "center" });
        doc.text("(N/A)", qrX, qrY + qrSize / 2 + 2, { width: qrSize, align: "center" });
      }

      const footerY = 760;
      doc
        .moveTo(margin, footerY - 8)
        .lineTo(margin + contentWidth, footerY - 8)
        .stroke("#E5E7EB");

      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text("Thank you for your business.", margin, footerY, {
        width: contentWidth,
        align: "center",
      });

      if (isOpeningBalance) {
        doc.fontSize(7).fillColor("#9CA3AF");
        doc.text("Opening balance brought forward from the previous system. This is not a tax invoice.", margin, footerY + 12, {
          width: contentWidth,
          align: "center",
        });
      } else if (isVATRegistered) {
        doc.fontSize(7).fillColor("#9CA3AF");
        doc.text(
          isCreditNote
            ? "This is a computer-generated tax credit note and is valid without a signature."
            : "This is a computer-generated tax invoice and is valid without a signature.",
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
      const doc = createPdfDocument({
        size: "A4",
        margin: 0,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: "Najma Al Raeda Accounting Services",
          Subject: "Invoice",
          Creator: "Muhasib.ai",
        },
      });

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
    doc.text(formatUnitPrice(Number(line.unitPrice || 0), { grouping: true }), colX[3] + 3, rowY, {
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
  doc.text(formatNraTotalAmount(Number(invoice.total || 0), invoice.currency), splitX + 72, y + 17, {
    width: x + w - splitX - 84,
    align: "right",
  });
}

type VatBucket = { rate: number; taxable: number; vat: number };

function aggregateVatByRate(lines: InvoiceLine[]): VatBucket[] {
  const buckets = new Map<number, VatBucket>();
  for (const line of lines) {
    const rate = line.vatRate ?? UAE_VAT_RATE;
    const taxable = line.quantity * line.unitPrice;
    const vat = taxable * rate;
    const existing = buckets.get(rate);
    if (existing) {
      existing.taxable += taxable;
      existing.vat += vat;
    } else {
      buckets.set(rate, { rate, taxable, vat });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.rate - b.rate);
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

function countLines(text: string): number {
  return Math.max(1, text.split("\n").length);
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

function formatAmount(amount: number, currency: string = "AED"): string {
  return `${currency} ${amount.toFixed(2)}`;
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

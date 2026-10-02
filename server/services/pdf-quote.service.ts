import { createPdfDocument } from "./pdf-fonts";
import type { Quote, QuoteLine, Company } from "../../shared/schema";
import { fitFontSize } from "./pdf-layout";
import { formatUnitPriceCurrency } from "../../shared/format-unit-price";
import { buildPdfRows, SALES_ROW_LABELS } from "./pdf-sales-rows";
import { pdfFieldsFor } from "./custom-fields.service";
import { getSignature } from "./quote-acceptance.service";

/**
 * Generate a professional quotation/estimate PDF on the server side using PDFKit.
 * Returns a Buffer containing the PDF data.
 */
export async function generateQuotePDF(
  quote: Quote,
  lines: QuoteLine[],
  company: Company,
  options: {
    variant?: "quote" | "proforma";
    customFields?: Array<{ labelEn: string; labelAr: string; value: string }>;
    signature?: { action: string; signerName: string; signedAt: Date | string } | null;
  } = {}
): Promise<Buffer> {
  const isProforma = options.variant === "proforma";
  let customFields = options.customFields;
  if (!customFields) {
    try {
      customFields = await pdfFieldsFor(quote.companyId, "quote", quote.id);
    } catch {
      customFields = [];
    }
  }
  let signature = options.signature;
  if (signature === undefined) {
    try {
      signature = (await getSignature(quote.companyId, quote.id)).current;
    } catch {
      signature = null;
    }
  }
  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `${isProforma ? "Proforma Invoice" : "Quotation"} ${quote.number}`,
          Author: company.name,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 595.28; // A4 width in points
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      // --- Header: Blue background bar ---
      doc.rect(0, 0, pageWidth, 100).fill("#1E40AF");

      // Company Name
      doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, margin, 30, { width: contentWidth * 0.6, align: "left" });

      // Quote Type Label
      const quoteLabel = isProforma ? "PROFORMA INVOICE" : "QUOTATION";
      doc.fontSize(16).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(quoteLabel, margin, 35, {
        width: contentWidth,
        align: "right",
      });
      doc.fontSize(11).fillColor("#DBEAFE").font("Helvetica");
      doc.text(isProforma ? "فاتورة مبدئية" : "عرض سعر", margin, 57, { width: contentWidth, align: "right" });

      if (isProforma) {
        doc.fontSize(9).fillColor("#B91C1C").font("Helvetica-Bold");
        doc.text("This is not a tax invoice", margin, 103, { width: contentWidth / 2, align: "left" });
        doc.text("هذه ليست فاتورة ضريبية", margin + contentWidth / 2, 103, {
          width: contentWidth / 2,
          align: "right",
        });
      }

      // --- Quote Details Box ---
      let y = 120;
      const detailBoxHeight = quote.expiryDate ? 68 : 50;
      doc.rect(margin, y, contentWidth, detailBoxHeight).fill("#F9FAFB").stroke("#E5E7EB");

      doc.fontSize(10).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(isProforma ? "Proforma #:" : "Quote #:", margin + 10, y + 12);
      doc.font("Helvetica").text(quote.number, margin + 75, y + 12);

      doc.font("Helvetica-Bold").text("Date:", margin + 10, y + 30);
      doc.font("Helvetica").text(
        new Date(quote.date).toLocaleDateString("en-AE", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        margin + 75,
        y + 30
      );

      if (quote.expiryDate) {
        doc.font("Helvetica-Bold").text("Valid Until:", margin + 10, y + 48);
        doc.font("Helvetica").text(
          new Date(quote.expiryDate).toLocaleDateString("en-AE", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          margin + 75,
          y + 48
        );
      }

      // TRN on right side
      const isVATRegistered = !!company.trnVatNumber;
      if (isVATRegistered && company.trnVatNumber) {
        doc.font("Helvetica-Bold").text("TRN:", margin + contentWidth - 170, y + 12);
        doc.font("Helvetica").text(company.trnVatNumber, margin + contentWidth - 135, y + 12);
      }

      // Status on right side
      if (quote.status) {
        doc.font("Helvetica-Bold").text("Status:", margin + contentWidth - 170, y + 30);
        doc.font("Helvetica").text(quote.status.toUpperCase(), margin + contentWidth - 125, y + 30);
      }

      // --- Company Details ---
      y = 120 + detailBoxHeight + 15;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      if (company.businessAddress) {
        doc.text(company.businessAddress, margin, y, { width: 200, align: "left" });
        y += 12;
      }
      if (company.contactPhone) {
        doc.text(`Phone: ${company.contactPhone}`, margin, y);
        y += 10;
      }
      if (company.contactEmail) {
        doc.text(`Email: ${company.contactEmail}`, margin, y);
        y += 10;
      }

      y = Math.max(y + 10, 220);

      // --- Bill To Section ---
      doc.fontSize(12).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text("BILL TO / إلى", margin, y);
      y += 18;

      doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(quote.customerName, margin, y, { width: contentWidth, align: "left" });
      y += Math.max(16, doc.heightOfString(quote.customerName, { width: contentWidth }) + 2);

      if (quote.customerTrn) {
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica");
        doc.text(`TRN: ${quote.customerTrn}`, margin, y);
        y += 14;
      }

      if (customFields && customFields.length > 0) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        for (const field of customFields) {
          const text = `${field.labelEn} / ${field.labelAr}: ${field.value}`;
          doc.text(text, margin, y, { width: contentWidth });
          y += Math.max(12, doc.heightOfString(text, { width: contentWidth }) + 2);
        }
      }

      y += 10;

      // --- Line Items Table ---
      const tableTop = y;
      const colX = {
        description: margin + 5,
        qty: margin + 222,
        price: margin + 258,
        disc: margin + 318,
        vat: margin + 366,
        amount: margin + contentWidth - 10,
      };
      const rowHeight = 25;

      // Table Header
      doc.rect(margin, tableTop, contentWidth, rowHeight).fill("#1E40AF");
      doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("Description", colX.description, tableTop + 8);
      doc.text("Qty", colX.qty, tableTop + 8, { width: 36, align: "center" });
      doc.text("Price", colX.price, tableTop + 8, { width: 58, align: "center" });
      doc.text(SALES_ROW_LABELS.discountColumn.en, colX.disc, tableTop + 8, { width: 44, align: "right" });
      doc.text("VAT", colX.vat, tableTop + 8, { width: 40, align: "center" });
      doc.text("Amount", colX.amount - 60, tableTop + 8, { width: 60, align: "right" });

      y = tableTop + rowHeight;

      // Table Rows
      doc.font("Helvetica").fillColor("#1F2937").fontSize(9);
      const printRows = buildPdfRows(lines as any[]);
      printRows.forEach((row, index) => {
        const bgColor = index % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
        doc.rect(margin, y, contentWidth, rowHeight).fill(bgColor);

        const vatPercent = (row.vatRate * 100).toFixed(0);
        const description =
          row.kind === "discount"
            ? `${SALES_ROW_LABELS.discount.en} / ${SALES_ROW_LABELS.discount.ar}`
            : row.kind === "shipping"
              ? `${row.description || SALES_ROW_LABELS.shipping.en} / ${SALES_ROW_LABELS.shipping.ar}`
              : row.description;

        doc.fillColor("#1F2937");
        doc.text(description, colX.description, y + 8, { width: 212 });
        if (row.quantity !== null) doc.text(row.quantity.toString(), colX.qty, y + 8, { width: 36, align: "center" });
        if (row.unitPrice !== null) {
          const unitPriceText = formatUnitPriceCurrency(row.unitPrice, quote.currency);
          doc.fontSize(fitFontSize(doc, unitPriceText, 58, 9));
          doc.text(unitPriceText, colX.price, y + 8, { width: 58, align: "center", lineBreak: false });
          doc.fontSize(9);
        }
        if (row.discountLabel) doc.text(row.discountLabel, colX.disc, y + 8, { width: 44, align: "right", lineBreak: false });
        doc.text(`${vatPercent}%`, colX.vat, y + 8, { width: 40, align: "center" });
        doc.text(formatAmount(row.amount, quote.currency), colX.amount - 60, y + 8, {
          width: 60,
          align: "right",
        });

        y += rowHeight;
      });

      // Table border
      doc.rect(margin, tableTop, contentWidth, y - tableTop).stroke("#E5E7EB");

      y += 15;

      // --- Totals ---
      const totalsX = margin + contentWidth - 170;
      const totalsValueX = margin + contentWidth - 10;

      doc.fontSize(10).fillColor("#1F2937").font("Helvetica");
      doc.text("Subtotal:", totalsX, y);
      doc.text(formatAmount(quote.subtotal, quote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });
      y += 18;

      doc.text("VAT:", totalsX, y);
      doc.text(formatAmount(quote.vatAmount, quote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });
      y += 22;

      // Total with blue background
      doc.rect(totalsX - 10, y - 7, 180, 28).fill("#1E40AF");
      doc.fontSize(13).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("TOTAL:", totalsX, y);
      doc.text(formatAmount(quote.total, quote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });

      // --- Notes ---
      if (quote.notes) {
        y += 45;
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica-Bold");
        doc.text("Notes:", margin, y);
        y += 14;
        doc.font("Helvetica").fontSize(8);
        doc.text(quote.notes, margin, y, { width: contentWidth });
      }

      // --- Acceptance record (who answered, when) ---
      if (signature) {
        y += 40;
        const accepted = signature.action === "accepted";
        doc.fontSize(9).fillColor(accepted ? "#166534" : "#991B1B").font("Helvetica-Bold");
        doc.text(
          `${accepted ? "Accepted" : "Declined"} by ${signature.signerName} on ${new Date(signature.signedAt).toLocaleDateString("en-AE", { year: "numeric", month: "short", day: "numeric" })}`,
          margin,
          y,
          { width: contentWidth }
        );
      }

      // --- Footer ---
      const footerY = 770;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text(
        isProforma
          ? "A tax invoice will be issued on supply or payment."
          : "This quotation is valid for the period specified above.",
        margin,
        footerY,
        { width: contentWidth, align: "center" }
      );

      if (isVATRegistered && !isProforma) {
        doc.fontSize(7);
        doc.text("All amounts are inclusive of applicable VAT where stated", margin, footerY + 12, {
          width: contentWidth,
          align: "center",
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function formatAmount(amount: number, currency: string = "AED"): string {
  return `${currency} ${amount.toFixed(2)}`;
}

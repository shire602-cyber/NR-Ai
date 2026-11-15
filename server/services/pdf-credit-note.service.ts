// @ts-ignore - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { bilingual, pdfLocale, preparePdfDocument } from "./pdf-fonts";
import type { CreditNote, CreditNoteLine, Company, Invoice } from "../../shared/schema";

/**
 * Generate a professional credit note PDF on the server side using PDFKit.
 * Returns a Buffer containing the PDF data.
 */
export async function generateCreditNotePDF(
  creditNote: CreditNote,
  lines: CreditNoteLine[],
  company: Company,
  originalInvoice?: Invoice
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Credit Note ${creditNote.number}`,
          Author: company.name,
        },
      });

      preparePdfDocument(doc);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 595.28; // A4 width in points
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;
      const locale = pdfLocale(company);
      const L = (en: string, ar: string) => bilingual(locale, en, ar);

      // --- Header: Blue background bar ---
      doc.rect(0, 0, pageWidth, 100).fill("#1E40AF");

      // Company Name
      doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, margin, 30, { width: contentWidth * 0.6 });

      // Credit Note Label
      doc.fontSize(16).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(L("CREDIT NOTE", "إشعار دائن"), margin, 35, {
        width: contentWidth,
        align: "right",
      });

      // --- Credit Note Details Box ---
      let y = 120;
      const hasOriginalInvoice = !!originalInvoice;
      const hasReason = !!creditNote.reason;
      const detailBoxHeight = 50 + (hasOriginalInvoice ? 18 : 0) + (hasReason ? 18 : 0);
      doc.rect(margin, y, contentWidth, detailBoxHeight).fill("#F9FAFB").stroke("#E5E7EB");

      doc.fontSize(10).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(`${L("Credit Note #", "رقم الإشعار")}`, margin + 10, y + 12);
      doc.font("Helvetica").text(creditNote.number, margin + 150, y + 12);

      doc.font("Helvetica-Bold").text(`${L("Date", "التاريخ")}`, margin + 10, y + 30);
      doc.font("Helvetica").text(
        new Date(creditNote.date).toLocaleDateString("en-AE", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        margin + 150,
        y + 30
      );

      let detailY = y + 48;

      if (hasOriginalInvoice && originalInvoice) {
        doc
          .font("Helvetica-Bold")
          .text(`${L("Ref. Invoice", "الفاتورة المرجعية")}`, margin + 10, detailY);
        doc.font("Helvetica").text(originalInvoice.number, margin + 150, detailY);
        detailY += 18;
      }

      if (hasReason && creditNote.reason) {
        doc.font("Helvetica-Bold").text(`${L("Reason", "السبب")}`, margin + 10, detailY);
        doc
          .font("Helvetica")
          .text(creditNote.reason, margin + 150, detailY, { width: 200, align: "left" });
      }

      // TRN on right side
      const isVATRegistered = !!company.trnVatNumber;
      if (isVATRegistered && company.trnVatNumber) {
        doc
          .font("Helvetica-Bold")
          .text(`${L("TRN", "الرقم الضريبي")}`, margin + contentWidth - 250, y + 12);
        doc.font("Helvetica").text(company.trnVatNumber, margin + contentWidth - 140, y + 12);
      }

      // Status on right side
      if (creditNote.status) {
        doc
          .font("Helvetica-Bold")
          .text(`${L("Status", "الحالة")}`, margin + contentWidth - 250, y + 30);
        doc
          .font("Helvetica")
          .text(creditNote.status.toUpperCase(), margin + contentWidth - 140, y + 30);
      }

      // --- Company Details ---
      y = 120 + detailBoxHeight + 15;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      if (company.businessAddress) {
        doc.text(company.businessAddress, margin, y, { width: 200 });
        y += 12;
      }
      if (company.contactPhone) {
        doc.text(`${L("Phone", "هاتف")}: ${company.contactPhone}`, margin, y);
        y += 10;
      }
      if (company.contactEmail) {
        doc.text(`${L("Email", "البريد")}: ${company.contactEmail}`, margin, y);
        y += 10;
      }

      y = Math.max(y + 10, 220);

      // --- Bill To Section ---
      doc.fontSize(12).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text(`${L("BILL TO", "إلى")}`, margin, y);
      y += 18;

      doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(creditNote.customerName, margin, y);
      y += 16;

      if (creditNote.customerTrn) {
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica");
        doc.text(`${L("TRN", "الرقم الضريبي")}: ${creditNote.customerTrn}`, margin, y);
        y += 14;
      }

      y += 10;

      // --- Line Items Table ---
      const tableTop = y;
      const colX = {
        description: margin + 5,
        qty: margin + 250,
        price: margin + 310,
        vat: margin + 380,
        amount: margin + contentWidth - 10,
      };
      const rowHeight = 25;

      // Table Header
      doc.rect(margin, tableTop, contentWidth, rowHeight).fill("#1E40AF");
      doc.fontSize(7.5).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(L("Description", "الوصف"), colX.description, tableTop + 5, { width: 230 });
      doc.text(L("Qty", "الكمية"), colX.qty, tableTop + 5, { width: 50, align: "center" });
      doc.text(L("Price", "السعر"), colX.price, tableTop + 5, { width: 60, align: "center" });
      doc.text(L("VAT", "الضريبة"), colX.vat, tableTop + 5, { width: 50, align: "center" });
      doc.text(L("Amount", "المبلغ"), colX.amount - 60, tableTop + 5, {
        width: 60,
        align: "right",
      });

      y = tableTop + rowHeight;

      // Table Rows
      doc.font("Helvetica").fillColor("#1F2937").fontSize(9);
      lines.forEach((line, index) => {
        const bgColor = index % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
        doc.rect(margin, y, contentWidth, rowHeight).fill(bgColor);

        const lineTotal = line.quantity * line.unitPrice;
        const vatPercent = ((line.vatRate || 0.05) * 100).toFixed(0);

        doc.fillColor("#1F2937");
        doc.text(line.description, colX.description, y + 8, { width: 230 });
        doc.text(line.quantity.toString(), colX.qty, y + 8, { width: 50, align: "center" });
        doc.text(formatAmount(line.unitPrice, creditNote.currency), colX.price, y + 8, {
          width: 60,
          align: "center",
        });
        doc.text(`${vatPercent}%`, colX.vat, y + 8, { width: 40, align: "center" });
        doc.text(formatAmount(lineTotal, creditNote.currency), colX.amount - 60, y + 8, {
          width: 60,
          align: "right",
        });

        y += rowHeight;
      });

      // Table border
      doc.rect(margin, tableTop, contentWidth, y - tableTop).stroke("#E5E7EB");

      y += 15;

      // --- Totals ---
      const totalsX = margin + contentWidth - 215;
      const totalsValueX = margin + contentWidth - 10;

      doc.fontSize(10).fillColor("#1F2937").font("Helvetica");
      doc.text(`${L("Subtotal", "المجموع")}`, totalsX, y);
      doc.text(formatAmount(creditNote.subtotal, creditNote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });
      y += 18;

      doc.text(`${L("VAT", "الضريبة")}`, totalsX, y);
      doc.text(formatAmount(creditNote.vatAmount, creditNote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });
      y += 22;

      // Total with blue background
      doc.rect(totalsX - 10, y - 7, 225, 28).fill("#1E40AF");
      doc.fontSize(11).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(`${L("TOTAL CREDIT", "إجمالي الدائن")}`, totalsX, y, { width: 135 });
      doc.text(formatAmount(creditNote.total, creditNote.currency), totalsValueX - 80, y, {
        width: 80,
        align: "right",
      });

      // --- Footer ---
      const footerY = 770;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text(
        L(
          "This credit note reduces the amount owed on the referenced invoice.",
          "يخفض هذا الإشعار المبلغ المستحق على الفاتورة المرجعية."
        ),
        margin,
        footerY,
        {
          width: contentWidth,
          align: "center",
        }
      );

      if (isVATRegistered) {
        doc.fontSize(7);
        doc.text(
          L(
            "This is a tax credit note - Please keep for your records",
            "هذا إشعار دائن ضريبي - يرجى الاحتفاظ به لسجلاتكم"
          ),
          margin,
          footerY + 12,
          {
            width: contentWidth,
            align: "center",
          }
        );
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

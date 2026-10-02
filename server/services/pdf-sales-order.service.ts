import { createPdfDocument } from "./pdf-fonts";
import type { Company, SalesOrder, SalesOrderLine } from "../../shared/schema";
import { fitFontSize } from "./pdf-layout";
import { formatUnitPriceCurrency } from "../../shared/format-unit-price";
import { buildPdfRows, SALES_ROW_LABELS } from "./pdf-sales-rows";
import { formatPdfDate } from "./pdf-format";

/**
 * Sales order PDF (Phase 8 D1): the order as agreed with the customer, with ordered quantities, prices, discounts
 * and delivery, and what is still open to invoice. Not a tax document.
 */
export async function generateSalesOrderPDF(
  order: SalesOrder,
  lines: SalesOrderLine[],
  company: Company,
  options: { customFields?: Array<{ labelEn: string; labelAr: string; value: string }> } = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        margin: 50,
        info: { Title: `Sales Order ${order.number}`, Author: company.name, Creator: "Muhasib.ai" },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 595.28;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      doc.rect(0, 0, pageWidth, 100).fill("#1E40AF");
      doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, margin, 30, { width: contentWidth * 0.6, align: "left" });
      doc.fontSize(16).text("SALES ORDER", margin, 35, { width: contentWidth, align: "right" });
      doc.fontSize(11).fillColor("#DBEAFE").font("Helvetica");
      doc.text("أمر بيع", margin, 57, { width: contentWidth, align: "right" });

      let y = 120;
      doc.rect(margin, y, contentWidth, order.expectedDate ? 68 : 50).fill("#F9FAFB").stroke("#E5E7EB");
      doc.fontSize(10).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text("Order #:", margin + 10, y + 12);
      doc.font("Helvetica").text(order.number, margin + 75, y + 12);
      doc.font("Helvetica-Bold").text("Date:", margin + 10, y + 30);
      doc.font("Helvetica").text(formatPdfDate(order.date), margin + 75, y + 30);
      if (order.expectedDate) {
        doc.font("Helvetica-Bold").text("Expected:", margin + 10, y + 48);
        doc.font("Helvetica").text(formatPdfDate(order.expectedDate), margin + 75, y + 48);
      }
      if (company.trnVatNumber) {
        doc.font("Helvetica-Bold").text("TRN:", margin + contentWidth - 170, y + 12);
        doc.font("Helvetica").text(company.trnVatNumber, margin + contentWidth - 135, y + 12);
      }
      doc.font("Helvetica-Bold").text("Status:", margin + contentWidth - 170, y + 30);
      doc.font("Helvetica").text(order.status.toUpperCase(), margin + contentWidth - 125, y + 30);

      y += (order.expectedDate ? 68 : 50) + 20;
      doc.fontSize(12).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text("CUSTOMER / العميل", margin, y);
      y += 18;
      doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(order.customerName, margin, y, { width: contentWidth });
      y += Math.max(16, doc.heightOfString(order.customerName, { width: contentWidth }) + 2);
      if (order.customerTrn) {
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica");
        doc.text(`TRN: ${order.customerTrn}`, margin, y);
        y += 14;
      }
      for (const field of options.customFields ?? []) {
        doc.fontSize(9).fillColor("#374151").font("Helvetica");
        const text = `${field.labelEn} / ${field.labelAr}: ${field.value}`;
        doc.text(text, margin, y, { width: contentWidth });
        y += Math.max(12, doc.heightOfString(text, { width: contentWidth }) + 2);
      }
      y += 10;

      const rowHeight = 25;
      const colX = { desc: margin + 5, qty: margin + 222, price: margin + 258, disc: margin + 318, vat: margin + 366, amount: margin + contentWidth - 10 };
      doc.rect(margin, y, contentWidth, rowHeight).fill("#1E40AF");
      doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("Description", colX.desc, y + 8);
      doc.text("Qty", colX.qty, y + 8, { width: 36, align: "center" });
      doc.text("Price", colX.price, y + 8, { width: 58, align: "center" });
      doc.text(SALES_ROW_LABELS.discountColumn.en, colX.disc, y + 8, { width: 44, align: "right" });
      doc.text("VAT", colX.vat, y + 8, { width: 40, align: "center" });
      doc.text("Amount", colX.amount - 60, y + 8, { width: 60, align: "right" });
      const tableTop = y;
      y += rowHeight;

      doc.font("Helvetica").fillColor("#1F2937").fontSize(9);
      buildPdfRows(lines as any[]).forEach((row, index) => {
        doc.rect(margin, y, contentWidth, rowHeight).fill(index % 2 === 0 ? "#FFFFFF" : "#F9FAFB");
        const description =
          row.kind === "discount"
            ? `${SALES_ROW_LABELS.discount.en} / ${SALES_ROW_LABELS.discount.ar}`
            : row.kind === "shipping"
              ? `${row.description || SALES_ROW_LABELS.shipping.en} / ${SALES_ROW_LABELS.shipping.ar}`
              : row.description;
        doc.fillColor("#1F2937");
        doc.text(description, colX.desc, y + 8, { width: 212 });
        if (row.quantity !== null) doc.text(row.quantity.toString(), colX.qty, y + 8, { width: 36, align: "center" });
        if (row.unitPrice !== null) {
          const t = formatUnitPriceCurrency(row.unitPrice, order.currency);
          doc.fontSize(fitFontSize(doc, t, 58, 9));
          doc.text(t, colX.price, y + 8, { width: 58, align: "center", lineBreak: false });
          doc.fontSize(9);
        }
        if (row.discountLabel) doc.text(row.discountLabel, colX.disc, y + 8, { width: 44, align: "right", lineBreak: false });
        doc.text(`${(row.vatRate * 100).toFixed(0)}%`, colX.vat, y + 8, { width: 40, align: "center" });
        doc.text(`${order.currency} ${row.amount.toFixed(2)}`, colX.amount - 60, y + 8, { width: 60, align: "right" });
        y += rowHeight;
      });
      doc.rect(margin, tableTop, contentWidth, y - tableTop).stroke("#E5E7EB");
      y += 15;

      const totalsX = margin + contentWidth - 170;
      const valueX = margin + contentWidth - 10;
      doc.fontSize(10).fillColor("#1F2937").font("Helvetica");
      doc.text("Subtotal:", totalsX, y);
      doc.text(`${order.currency} ${Number(order.subtotal).toFixed(2)}`, valueX - 80, y, { width: 80, align: "right" });
      y += 18;
      doc.text("VAT:", totalsX, y);
      doc.text(`${order.currency} ${Number(order.vatAmount).toFixed(2)}`, valueX - 80, y, { width: 80, align: "right" });
      y += 22;
      doc.rect(totalsX - 10, y - 7, 180, 28).fill("#1E40AF");
      doc.fontSize(13).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("TOTAL:", totalsX, y);
      doc.text(`${order.currency} ${Number(order.total).toFixed(2)}`, valueX - 80, y, { width: 80, align: "right" });

      if (order.notes) {
        y += 45;
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica-Bold").text("Notes:", margin, y);
        doc.font("Helvetica").fontSize(8).text(order.notes, margin, y + 14, { width: contentWidth });
      }
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text("This sales order is not a tax invoice. Tax invoices are issued when goods or services are supplied.", margin, 770, { width: contentWidth, align: "center" });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

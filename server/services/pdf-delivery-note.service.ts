import { createPdfDocument } from "./pdf-fonts";
import type { Company, Invoice, InvoiceLine } from "../../shared/schema";
import { formatPdfDate } from "./pdf-format";

const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const ROW_HEIGHT = 25;
const BOTTOM = 700; // leaves room for the signature block on the last page

/**
 * Delivery note built from an invoice: same header, customer and line
 * descriptions, but no unit prices, VAT or totals; quantities and a
 * received-by / signature / date block instead.
 */
export async function generateDeliveryNotePDF(
  invoice: Invoice,
  allLines: InvoiceLine[],
  company: Company,
  options: { referenceLabel?: string; title?: string } = {}
): Promise<Buffer> {
  // Goods only: discounts, delivery charges and advance deductions are money lines, not things handed over.
  const lines = allLines.filter((l) => !l.lineKind || l.lineKind === "item");
  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        margin: MARGIN,
        info: { Title: `${options.title ?? "Delivery Note"} ${invoice.number}`, Author: company.name },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Header ---
      doc.rect(0, 0, PAGE_WIDTH, 100).fill("#1E40AF");
      doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, MARGIN, 30, { width: CONTENT_WIDTH * 0.55, align: "left" });
      doc.fontSize(16).text("DELIVERY NOTE", MARGIN, 35, { width: CONTENT_WIDTH, align: "right" });
      doc.fontSize(11).fillColor("#DBEAFE").font("Helvetica");
      doc.text("مذكرة تسليم", MARGIN, 57, { width: CONTENT_WIDTH, align: "right" });

      // --- Details box ---
      let y = 120;
      doc.rect(MARGIN, y, CONTENT_WIDTH, 50).fill("#F9FAFB").stroke("#E5E7EB");
      doc.fontSize(10).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(options.referenceLabel ?? "Ref. Invoice:", MARGIN + 10, y + 12);
      doc.font("Helvetica").text(invoice.number, MARGIN + 85, y + 12);
      doc.font("Helvetica-Bold").text("Date:", MARGIN + 10, y + 30);
      doc.font("Helvetica").text(formatPdfDate(invoice.date), MARGIN + 85, y + 30);
      if (company.trnVatNumber) {
        doc.font("Helvetica-Bold").text("TRN:", MARGIN + CONTENT_WIDTH - 170, y + 12);
        doc.font("Helvetica").text(company.trnVatNumber, MARGIN + CONTENT_WIDTH - 135, y + 12);
      }

      // --- Company details ---
      y = 120 + 50 + 15;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      if (company.businessAddress) {
        doc.text(company.businessAddress, MARGIN, y, { width: 200 });
        y += 12;
      }
      if (company.contactPhone) {
        doc.text(`Phone: ${company.contactPhone}`, MARGIN, y);
        y += 10;
      }
      y = Math.max(y + 10, 220);

      // --- Deliver to ---
      doc.fontSize(12).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text("DELIVER TO / التسليم إلى", MARGIN, y);
      y += 18;
      doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(invoice.customerName, MARGIN, y, { width: CONTENT_WIDTH, align: "left" });
      y += Math.max(16, doc.heightOfString(invoice.customerName, { width: CONTENT_WIDTH }) + 2);
      if (invoice.customerAddress) {
        doc.fontSize(9).fillColor("#6B7280").font("Helvetica");
        doc.text(invoice.customerAddress, MARGIN, y, { width: CONTENT_WIDTH });
        y += doc.heightOfString(invoice.customerAddress, { width: CONTENT_WIDTH }) + 4;
      }
      y += 10;

      // --- Items table: number, description, quantity ---
      const colNo = MARGIN + 8;
      const colDescription = MARGIN + 40;
      const colQty = MARGIN + CONTENT_WIDTH - 90;
      const drawHeader = () => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill("#1E40AF");
        doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold");
        doc.text("#", colNo, y + 8, { width: 25 });
        doc.text("Description / الوصف", colDescription, y + 8, { width: 300 });
        doc.text("Qty / الكمية", colQty, y + 8, { width: 80, align: "right" });
        y += ROW_HEIGHT;
      };
      const tableTop = y;
      drawHeader();
      let segmentTop = tableTop;
      lines.forEach((line, index) => {
        if (y + ROW_HEIGHT > BOTTOM) {
          doc.rect(MARGIN, segmentTop, CONTENT_WIDTH, y - segmentTop).stroke("#E5E7EB");
          doc.addPage();
          y = MARGIN;
          segmentTop = y;
          drawHeader();
        }
        doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill(index % 2 === 0 ? "#FFFFFF" : "#F9FAFB");
        doc.fontSize(9).fillColor("#1F2937").font("Helvetica");
        doc.text(String(index + 1), colNo, y + 8, { width: 25 });
        doc.text(line.description, colDescription, y + 8, { width: 300, align: "left", lineBreak: false });
        doc.text(String(line.quantity), colQty, y + 8, { width: 80, align: "right" });
        y += ROW_HEIGHT;
      });
      doc.rect(MARGIN, segmentTop, CONTENT_WIDTH, y - segmentTop).stroke("#E5E7EB");

      // --- Receipt block ---
      y = Math.max(y + 40, 640);
      if (y > 730) {
        doc.addPage();
        y = 120;
      }
      doc.fontSize(9).fillColor("#6B7280").font("Helvetica");
      doc.text("Goods received in good condition. / استلمت البضاعة بحالة جيدة.", MARGIN, y - 22, {
        width: CONTENT_WIDTH,
      });
      const fields: Array<[string, string]> = [
        ["Received by", "المستلم"],
        ["Signature", "التوقيع"],
        ["Date", "التاريخ"],
      ];
      const fieldWidth = (CONTENT_WIDTH - 2 * 20) / 3;
      fields.forEach(([en, ar], i) => {
        const x = MARGIN + i * (fieldWidth + 20);
        doc.moveTo(x, y + 30).lineTo(x + fieldWidth, y + 30).stroke("#9CA3AF");
        doc.fontSize(9).fillColor("#1F2937").font("Helvetica-Bold");
        doc.text(en, x, y + 36, { width: fieldWidth, lineBreak: false });
        doc.font("Helvetica").fillColor("#6B7280");
        doc.text(ar, x, y + 36, { width: fieldWidth, align: "right", lineBreak: false });
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** A delivery recorded against a sales order: same layout, no prices. */
export async function generateSalesOrderDeliveryPDF(args: {
  delivery: { number: string; date: Date | string; notes?: string | null };
  salesOrder: { number: string; customerName: string; customerTrn?: string | null };
  lines: Array<{ description: string; quantity: number | string }>;
  company: Company;
}): Promise<Buffer> {
  const pseudoInvoice = {
    number: args.delivery.number,
    date: args.delivery.date,
    customerName: args.salesOrder.customerName,
    customerTrn: args.salesOrder.customerTrn ?? null,
    customerAddress: null,
  } as unknown as Invoice;
  const pseudoLines = args.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), lineKind: "item" })) as unknown as InvoiceLine[];
  return generateDeliveryNotePDF(pseudoInvoice, pseudoLines, args.company, {
    referenceLabel: `Order ${args.salesOrder.number} /`,
    title: "Delivery Note",
  });
}

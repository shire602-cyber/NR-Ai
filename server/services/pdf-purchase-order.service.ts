// @ts-ignore - pdfkit has no type declarations
import PDFDocument from 'pdfkit';
import type { PurchaseOrder, PurchaseOrderLine, Company } from '../../shared/schema';

/**
 * Generate a professional purchase order PDF on the server side using PDFKit.
 * Returns a Buffer containing the PDF data.
 */
export async function generatePurchaseOrderPDF(
  po: PurchaseOrder,
  lines: PurchaseOrderLine[],
  company: Company
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Purchase Order ${po.number}`,
          Author: company.name,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 595.28; // A4 width in points
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      // --- Header: Blue background bar ---
      doc.rect(0, 0, pageWidth, 100).fill('#1E40AF');

      // Company Name
      doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text(company.name, margin, 30, { width: contentWidth * 0.6 });

      // Purchase Order Label
      doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('PURCHASE ORDER', margin, 35, {
        width: contentWidth,
        align: 'right',
      });

      // --- PO Details Box ---
      let y = 120;
      const hasDeliveryDate = !!po.expectedDeliveryDate;
      const detailBoxHeight = 50 + (hasDeliveryDate ? 18 : 0);
      doc.rect(margin, y, contentWidth, detailBoxHeight).fill('#F9FAFB').stroke('#E5E7EB');

      doc.fontSize(10).fillColor('#1F2937').font('Helvetica-Bold');
      doc.text('PO #:', margin + 10, y + 12);
      doc.font('Helvetica').text(po.number, margin + 75, y + 12);

      doc.font('Helvetica-Bold').text('Date:', margin + 10, y + 30);
      doc.font('Helvetica').text(
        new Date(po.date).toLocaleDateString('en-AE', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        margin + 75,
        y + 30
      );

      if (hasDeliveryDate && po.expectedDeliveryDate) {
        doc.font('Helvetica-Bold').text('Delivery By:', margin + 10, y + 48);
        doc.font('Helvetica').text(
          new Date(po.expectedDeliveryDate).toLocaleDateString('en-AE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          margin + 80,
          y + 48
        );
      }

      // TRN on right side
      const isVATRegistered = !!company.trnVatNumber;
      if (isVATRegistered && company.trnVatNumber) {
        doc.font('Helvetica-Bold').text('TRN:', margin + contentWidth - 170, y + 12);
        doc.font('Helvetica').text(company.trnVatNumber, margin + contentWidth - 135, y + 12);
      }

      // Status on right side
      if (po.status) {
        doc.font('Helvetica-Bold').text('Status:', margin + contentWidth - 170, y + 30);
        doc.font('Helvetica').text(po.status.toUpperCase(), margin + contentWidth - 125, y + 30);
      }

      // --- Company Details ---
      y = 120 + detailBoxHeight + 15;
      doc.fontSize(8).fillColor('#6B7280').font('Helvetica');
      if (company.businessAddress) {
        doc.text(company.businessAddress, margin, y, { width: 200 });
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

      // --- Vendor Section ---
      doc.fontSize(12).fillColor('#1E40AF').font('Helvetica-Bold');
      doc.text('VENDOR:', margin, y);
      y += 18;

      doc.fontSize(11).fillColor('#1F2937').font('Helvetica-Bold');
      doc.text(po.vendorName, margin, y);
      y += 16;

      if (po.vendorTrn) {
        doc.fontSize(9).fillColor('#6B7280').font('Helvetica');
        doc.text(`TRN: ${po.vendorTrn}`, margin, y);
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
      doc.rect(margin, tableTop, contentWidth, rowHeight).fill('#1E40AF');
      doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('Description', colX.description, tableTop + 8);
      doc.text('Qty', colX.qty, tableTop + 8, { width: 50, align: 'center' });
      doc.text('Price', colX.price, tableTop + 8, { width: 60, align: 'center' });
      doc.text('VAT', colX.vat, tableTop + 8, { width: 40, align: 'center' });
      doc.text('Amount', colX.amount - 60, tableTop + 8, { width: 60, align: 'right' });

      y = tableTop + rowHeight;

      // Table Rows
      doc.font('Helvetica').fillColor('#1F2937').fontSize(9);
      lines.forEach((line, index) => {
        const bgColor = index % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(margin, y, contentWidth, rowHeight).fill(bgColor);

        const lineTotal = line.quantity * line.unitPrice;
        const vatPercent = ((line.vatRate || 0.05) * 100).toFixed(0);

        doc.fillColor('#1F2937');
        doc.text(line.description, colX.description, y + 8, { width: 230 });
        doc.text(line.quantity.toString(), colX.qty, y + 8, { width: 50, align: 'center' });
        doc.text(formatAmount(line.unitPrice, po.currency), colX.price, y + 8, { width: 60, align: 'center' });
        doc.text(`${vatPercent}%`, colX.vat, y + 8, { width: 40, align: 'center' });
        doc.text(formatAmount(lineTotal, po.currency), colX.amount - 60, y + 8, { width: 60, align: 'right' });

        y += rowHeight;
      });

      // Table border
      doc.rect(margin, tableTop, contentWidth, y - tableTop).stroke('#E5E7EB');

      y += 15;

      // --- Totals ---
      const totalsX = margin + contentWidth - 170;
      const totalsValueX = margin + contentWidth - 10;

      doc.fontSize(10).fillColor('#1F2937').font('Helvetica');
      doc.text('Subtotal:', totalsX, y);
      doc.text(formatAmount(po.subtotal, po.currency), totalsValueX - 80, y, { width: 80, align: 'right' });
      y += 18;

      doc.text('VAT:', totalsX, y);
      doc.text(formatAmount(po.vatAmount, po.currency), totalsValueX - 80, y, { width: 80, align: 'right' });
      y += 22;

      // Total with blue background
      doc.rect(totalsX - 10, y - 7, 180, 28).fill('#1E40AF');
      doc.fontSize(13).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('TOTAL:', totalsX, y);
      doc.text(formatAmount(po.total, po.currency), totalsValueX - 80, y, { width: 80, align: 'right' });

      // --- Notes ---
      if (po.notes) {
        y += 45;
        doc.fontSize(9).fillColor('#6B7280').font('Helvetica-Bold');
        doc.text('Notes:', margin, y);
        y += 14;
        doc.font('Helvetica').fontSize(8);
        doc.text(po.notes, margin, y, { width: contentWidth });
      }

      // --- Footer ---
      const footerY = 770;
      doc.fontSize(8).fillColor('#6B7280').font('Helvetica');
      doc.text('Please confirm receipt of this purchase order.', margin, footerY, {
        width: contentWidth,
        align: 'center',
      });

      if (isVATRegistered) {
        doc.fontSize(7);
        doc.text(
          'All amounts are inclusive of applicable VAT where stated',
          margin,
          footerY + 12,
          { width: contentWidth, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function formatAmount(amount: number, currency: string = 'AED'): string {
  return `${currency} ${amount.toFixed(2)}`;
}

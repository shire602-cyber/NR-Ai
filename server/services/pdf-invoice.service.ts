// @ts-ignore - pdfkit has no type declarations
import PDFDocument from 'pdfkit';
import type { Invoice, InvoiceLine, Company } from '../../shared/schema';
import { UAE_VAT_RATE } from '../constants';

export async function generateInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: company.name,
          Subject: 'Tax Invoice',
          Creator: 'Muhasib.ai',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 595.28;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;

      const isVATRegistered = !!company.trnVatNumber;
      const invoiceLabel = isVATRegistered ? 'TAX INVOICE' : 'INVOICE';

      // ── Header bar ──────────────────────────────────────────────────────────
      doc.rect(0, 0, pageWidth, 110).fill('#1E40AF');

      // Company name
      doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text(company.name, margin, 28, { width: contentWidth * 0.65 });

      // Invoice type label (top-right)
      doc.fontSize(18).fillColor('#BFDBFE').font('Helvetica-Bold');
      doc.text(invoiceLabel, margin, 28, { width: contentWidth, align: 'right' });

      // Company TRN under name
      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor('#BFDBFE').font('Helvetica');
        doc.text(`TRN: ${company.trnVatNumber}`, margin, 56, { width: contentWidth * 0.65 });
      }

      // Company contact (right side of header)
      doc.fontSize(8).fillColor('#DBEAFE').font('Helvetica');
      let headerRightY = 56;
      if (company.businessAddress) {
        doc.text(company.businessAddress, margin, headerRightY, { width: contentWidth, align: 'right' });
        headerRightY += 11;
      }
      if (company.contactPhone) {
        doc.text(`Tel: ${company.contactPhone}`, margin, headerRightY, { width: contentWidth, align: 'right' });
        headerRightY += 11;
      }
      if (company.contactEmail) {
        doc.text(company.contactEmail, margin, headerRightY, { width: contentWidth, align: 'right' });
      }

      // ── Invoice metadata box ─────────────────────────────────────────────────
      let y = 125;
      const metaBoxH = 55;
      doc.rect(margin, y, contentWidth, metaBoxH).fill('#F0F9FF').stroke('#BAE6FD');

      const metaColW = contentWidth / 4;
      const metaFields = [
        { label: 'Invoice #', value: invoice.number },
        { label: 'Issue Date', value: formatDate(invoice.date) },
        { label: 'Due Date', value: invoice.dueDate ? formatDate(invoice.dueDate) : paymentTermsLabel(invoice.paymentTerms, invoice.date) },
        { label: 'Status', value: (invoice.status || 'draft').toUpperCase() },
      ];

      metaFields.forEach((field, i) => {
        const x = margin + i * metaColW + 8;
        doc.fontSize(7).fillColor('#6B7280').font('Helvetica');
        doc.text(field.label, x, y + 10, { width: metaColW - 10 });
        doc.fontSize(9).fillColor('#111827').font('Helvetica-Bold');
        doc.text(field.value, x, y + 22, { width: metaColW - 10 });
      });

      y += metaBoxH + 16;

      // ── Bill From / Bill To ──────────────────────────────────────────────────
      const halfW = contentWidth / 2 - 8;

      // FROM
      doc.fontSize(8).fillColor('#6B7280').font('Helvetica-Bold');
      doc.text('FROM:', margin, y);
      y += 13;
      doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold');
      doc.text(company.name, margin, y, { width: halfW });
      y += 15;
      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(`TRN: ${company.trnVatNumber}`, margin, y, { width: halfW });
        y += 12;
      }
      if (company.businessAddress) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(company.businessAddress, margin, y, { width: halfW });
      }

      // TO (reset y to same start)
      const toStartY = y - 15 - (isVATRegistered && company.trnVatNumber ? 12 : 0) - (company.businessAddress ? 12 : 0) - 13;
      const toX = margin + halfW + 16;

      doc.fontSize(8).fillColor('#6B7280').font('Helvetica-Bold');
      doc.text('BILL TO:', toX, toStartY);
      doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold');
      doc.text(invoice.customerName, toX, toStartY + 13, { width: halfW });
      if (invoice.customerTrn) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(`TRN: ${invoice.customerTrn}`, toX, toStartY + 28, { width: halfW });
      }

      // Recalculate y based on content
      y = Math.max(y + 20, toStartY + 55);

      // ── Line Items Table ─────────────────────────────────────────────────────
      const tableTop = y;
      const rowH = 22;
      const colX = {
        desc: margin + 5,
        qty: margin + 248,
        price: margin + 308,
        vat: margin + 376,
        amount: pageWidth - margin - 5,
      };
      const colWidths = {
        desc: 238,
        qty: 55,
        price: 63,
        vat: 60,
        amount: 65,
      };

      // Table header
      doc.rect(margin, tableTop, contentWidth, rowH).fill('#1E40AF');
      doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('Description', colX.desc, tableTop + 7);
      doc.text('Qty', colX.qty, tableTop + 7, { width: colWidths.qty, align: 'center' });
      doc.text('Unit Price', colX.price, tableTop + 7, { width: colWidths.price, align: 'right' });
      doc.text('VAT %', colX.vat, tableTop + 7, { width: colWidths.vat, align: 'center' });
      doc.text('Amount', colX.amount - colWidths.amount + 5, tableTop + 7, { width: colWidths.amount, align: 'right' });

      y = tableTop + rowH;

      doc.font('Helvetica').fillColor('#1F2937').fontSize(9);
      lines.forEach((line, index) => {
        const bgColor = index % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        doc.rect(margin, y, contentWidth, rowH).fill(bgColor);
        doc.rect(margin, y, contentWidth, rowH).stroke('#E5E7EB');

        const lineTotal = line.quantity * line.unitPrice;
        const vatPercent = ((line.vatRate ?? UAE_VAT_RATE) * 100).toFixed(0);

        doc.fillColor('#1F2937').fontSize(9);
        doc.text(line.description, colX.desc, y + 7, { width: colWidths.desc });
        doc.text(line.quantity.toString(), colX.qty, y + 7, { width: colWidths.qty, align: 'center' });
        doc.text(formatAmount(line.unitPrice, invoice.currency), colX.price, y + 7, { width: colWidths.price, align: 'right' });
        doc.text(`${vatPercent}%`, colX.vat, y + 7, { width: colWidths.vat, align: 'center' });
        doc.text(formatAmount(lineTotal, invoice.currency), colX.amount - colWidths.amount + 5, y + 7, { width: colWidths.amount, align: 'right' });

        y += rowH;
      });

      // Bottom border for table
      doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#E5E7EB');

      y += 16;

      // ── Totals ───────────────────────────────────────────────────────────────
      const totalsX = margin + contentWidth - 200;
      const labelW = 120;
      const valueW = 80;

      doc.fontSize(9).fillColor('#374151').font('Helvetica');
      doc.text('Subtotal:', totalsX, y, { width: labelW });
      doc.text(formatAmount(invoice.subtotal, invoice.currency), totalsX + labelW, y, { width: valueW, align: 'right' });
      y += 16;

      doc.text('VAT (5%):', totalsX, y, { width: labelW });
      doc.text(formatAmount(invoice.vatAmount, invoice.currency), totalsX + labelW, y, { width: valueW, align: 'right' });
      y += 10;

      // Divider
      doc.moveTo(totalsX, y).lineTo(totalsX + labelW + valueW, y).stroke('#D1D5DB');
      y += 8;

      // Grand total
      doc.rect(totalsX - 8, y - 6, labelW + valueW + 16, 28).fill('#1E40AF');
      doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text('TOTAL DUE:', totalsX, y + 2, { width: labelW });
      doc.text(formatAmount(invoice.total, invoice.currency), totalsX + labelW, y + 2, { width: valueW, align: 'right' });

      y += 40;

      // ── Payment Terms ────────────────────────────────────────────────────────
      if (invoice.paymentTerms) {
        doc.fontSize(8).fillColor('#374151').font('Helvetica-Bold');
        doc.text('Payment Terms:', margin, y);
        doc.font('Helvetica').fillColor('#6B7280');
        doc.text(paymentTermsText(invoice.paymentTerms), margin + 90, y);
        y += 16;
      }

      // ── QR Code placeholder (e-invoicing readiness) ──────────────────────────
      const qrSize = 60;
      const qrX = pageWidth - margin - qrSize;
      const qrY = y - 16;
      doc.rect(qrX, qrY, qrSize, qrSize).stroke('#D1D5DB');
      doc.fontSize(6).fillColor('#9CA3AF').font('Helvetica');
      doc.text('QR CODE', qrX, qrY + qrSize / 2 - 6, { width: qrSize, align: 'center' });
      doc.text('(e-Invoice)', qrX, qrY + qrSize / 2 + 2, { width: qrSize, align: 'center' });

      // ── Footer ───────────────────────────────────────────────────────────────
      const footerY = 760;
      doc.moveTo(margin, footerY - 8).lineTo(margin + contentWidth, footerY - 8).stroke('#E5E7EB');

      doc.fontSize(8).fillColor('#6B7280').font('Helvetica');
      doc.text('Thank you for your business.', margin, footerY, { width: contentWidth, align: 'center' });

      if (isVATRegistered) {
        doc.fontSize(7).fillColor('#9CA3AF');
        doc.text(
          'This is a computer-generated tax invoice and is valid without a signature.',
          margin, footerY + 12,
          { width: contentWidth, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-AE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function paymentTermsLabel(terms: string | null | undefined, invoiceDate: Date | string): string {
  if (!terms) return '—';
  const days = paymentTermsDays(terms);
  if (days === null) return formatPaymentTerms(terms);
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + days);
  return formatDate(due);
}

function paymentTermsDays(terms: string): number | null {
  const map: Record<string, number> = {
    net7: 7, net14: 14, net30: 30, net60: 60, net90: 90,
    immediate: 0, cod: 0,
  };
  return map[terms.toLowerCase()] ?? null;
}

function formatPaymentTerms(terms: string): string {
  const labels: Record<string, string> = {
    net7: 'Net 7 days', net14: 'Net 14 days', net30: 'Net 30 days',
    net60: 'Net 60 days', net90: 'Net 90 days',
    immediate: 'Due Immediately', cod: 'Cash on Delivery',
  };
  return labels[terms.toLowerCase()] || terms;
}

function paymentTermsText(terms: string): string {
  return formatPaymentTerms(terms);
}

function formatAmount(amount: number, currency: string = 'AED'): string {
  return `${currency} ${amount.toFixed(2)}`;
}

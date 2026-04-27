// @ts-ignore - pdfkit has no type declarations
import PDFDocument from 'pdfkit';
import type { Invoice, InvoiceLine, Company } from '../../shared/schema';
import { UAE_VAT_RATE } from '../constants';
import { renderEInvoiceQrPng } from './einvoice-qr.service';

export async function generateInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company
): Promise<Buffer> {
  // Pre-render the e-invoice QR png so the PDF stream — which is synchronous
  // once started — can simply embed the buffer. We only render when the
  // company is VAT registered, since the QR must encode the seller's TRN.
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
      // Fall back to placeholder if QR generation fails — PDF must still render.
      qrPng = null;
    }
  }

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
      // FTA Article 59 requires bilingual presentation on tax invoices issued
      // in the UAE. We pair the English label with its Arabic counterpart so
      // either reader can identify the document type at a glance.
      const invoiceLabelEn = isVATRegistered ? 'TAX INVOICE' : 'INVOICE';
      const invoiceLabelAr = isVATRegistered ? 'فاتورة ضريبية' : 'فاتورة';

      // ── Header bar ──────────────────────────────────────────────────────────
      doc.rect(0, 0, pageWidth, 110).fill('#1E40AF');

      // Company name
      doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text(company.name, margin, 24, { width: contentWidth * 0.65 });

      // Invoice type label (top-right) — English over Arabic.
      doc.fontSize(18).fillColor('#BFDBFE').font('Helvetica-Bold');
      doc.text(invoiceLabelEn, margin, 24, { width: contentWidth, align: 'right' });
      doc.fontSize(11).fillColor('#DBEAFE').font('Helvetica');
      doc.text(invoiceLabelAr, margin, 46, { width: contentWidth, align: 'right' });

      // Company TRN under name
      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor('#BFDBFE').font('Helvetica');
        doc.text(`TRN / الرقم الضريبي: ${company.trnVatNumber}`, margin, 56, { width: contentWidth * 0.65 });
      }

      // Company contact (right side of header)
      doc.fontSize(8).fillColor('#DBEAFE').font('Helvetica');
      let headerRightY = 70;
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

      // ── Reverse-charge banner (FTA: recipient self-assesses VAT) ────────────
      let y = 125;
      if (invoice.reverseCharge) {
        const bannerH = 38;
        doc.rect(margin, y, contentWidth, bannerH).fill('#FEF3C7').stroke('#F59E0B');
        doc.fontSize(9).fillColor('#92400E').font('Helvetica-Bold');
        doc.text('REVERSE CHARGE / آلية الاحتساب العكسي', margin + 10, y + 7, { width: contentWidth - 20 });
        doc.fontSize(8).fillColor('#78350F').font('Helvetica');
        doc.text(
          'VAT is to be accounted for by the recipient under the reverse-charge mechanism (UAE VAT law).',
          margin + 10, y + 21,
          { width: contentWidth - 20 },
        );
        y += bannerH + 10;
      }

      // ── Invoice metadata box ─────────────────────────────────────────────────
      const metaBoxH = 55;
      doc.rect(margin, y, contentWidth, metaBoxH).fill('#F0F9FF').stroke('#BAE6FD');

      const metaColW = contentWidth / 4;
      const metaFields = [
        { label: 'Invoice # / رقم الفاتورة', value: invoice.number },
        { label: 'Issue Date / تاريخ الإصدار', value: formatDate(invoice.date) },
        { label: 'Due Date / تاريخ الاستحقاق', value: invoice.dueDate ? formatDate(invoice.dueDate) : paymentTermsLabel(invoice.paymentTerms, invoice.date) },
        { label: 'Status / الحالة', value: (invoice.status || 'draft').toUpperCase() },
      ];

      metaFields.forEach((field, i) => {
        const x = margin + i * metaColW + 8;
        doc.fontSize(7).fillColor('#6B7280').font('Helvetica');
        doc.text(field.label, x, y + 10, { width: metaColW - 10 });
        doc.fontSize(9).fillColor('#111827').font('Helvetica-Bold');
        doc.text(field.value, x, y + 26, { width: metaColW - 10 });
      });

      y += metaBoxH + 16;

      // ── Bill From / Bill To ──────────────────────────────────────────────────
      const halfW = contentWidth / 2 - 8;
      const partiesTop = y;

      // FROM (seller)
      doc.fontSize(8).fillColor('#6B7280').font('Helvetica-Bold');
      doc.text('FROM / من:', margin, partiesTop);
      let fromY = partiesTop + 13;
      doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold');
      doc.text(company.name, margin, fromY, { width: halfW });
      fromY += 15;
      if (isVATRegistered && company.trnVatNumber) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(`TRN: ${company.trnVatNumber}`, margin, fromY, { width: halfW });
        fromY += 12;
      }
      if (company.businessAddress) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(company.businessAddress, margin, fromY, { width: halfW });
        fromY += 12 * countLines(company.businessAddress);
      }

      // TO (buyer)
      const toX = margin + halfW + 16;
      doc.fontSize(8).fillColor('#6B7280').font('Helvetica-Bold');
      doc.text('BILL TO / إلى:', toX, partiesTop);
      let toY = partiesTop + 13;
      doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold');
      doc.text(invoice.customerName, toX, toY, { width: halfW });
      toY += 15;
      if (invoice.customerTrn) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(`TRN: ${invoice.customerTrn}`, toX, toY, { width: halfW });
        toY += 12;
      }
      if (invoice.customerAddress) {
        doc.fontSize(9).fillColor('#374151').font('Helvetica');
        doc.text(invoice.customerAddress, toX, toY, { width: halfW });
        toY += 12 * countLines(invoice.customerAddress);
      }

      y = Math.max(fromY, toY) + 10;

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

      // ── Per-rate VAT breakdown (FTA Article 59: a tax invoice must show
      //    the VAT amount for each rate applied) ────────────────────────────
      const vatBuckets = aggregateVatByRate(lines);
      if (vatBuckets.length > 1) {
        const breakdownTop = y;
        const breakdownH = 18 + vatBuckets.length * 16 + 6;
        doc.rect(margin, breakdownTop, contentWidth, breakdownH).fill('#F8FAFC').stroke('#E5E7EB');

        doc.fontSize(9).fillColor('#1E40AF').font('Helvetica-Bold');
        doc.text('VAT Breakdown / تفاصيل ضريبة القيمة المضافة', margin + 8, breakdownTop + 6);

        const cols = {
          rate: margin + 8,
          taxable: margin + 120,
          vat: margin + 260,
          incl: margin + contentWidth - 8,
        };
        const breakdownRowY = breakdownTop + 22;
        doc.fontSize(7).fillColor('#6B7280').font('Helvetica');
        doc.text('Rate', cols.rate, breakdownRowY);
        doc.text('Taxable Amount', cols.taxable, breakdownRowY);
        doc.text('VAT', cols.vat, breakdownRowY);
        doc.text('Inclusive Total', margin + contentWidth - 100 - 8, breakdownRowY, { width: 100, align: 'right' });

        let bRowY = breakdownRowY + 10;
        doc.fontSize(9).fillColor('#1F2937').font('Helvetica');
        for (const bucket of vatBuckets) {
          doc.text(`${(bucket.rate * 100).toFixed(0)}%`, cols.rate, bRowY);
          doc.text(formatAmount(bucket.taxable, invoice.currency), cols.taxable, bRowY);
          doc.text(formatAmount(bucket.vat, invoice.currency), cols.vat, bRowY);
          doc.text(formatAmount(bucket.taxable + bucket.vat, invoice.currency), margin + contentWidth - 100 - 8, bRowY, { width: 100, align: 'right' });
          bRowY += 14;
        }

        y = breakdownTop + breakdownH + 10;
      }

      // ── Totals ───────────────────────────────────────────────────────────────
      const totalsX = margin + contentWidth - 200;
      const labelW = 120;
      const valueW = 80;

      doc.fontSize(9).fillColor('#374151').font('Helvetica');
      doc.text('Subtotal:', totalsX, y, { width: labelW });
      doc.text(formatAmount(invoice.subtotal, invoice.currency), totalsX + labelW, y, { width: valueW, align: 'right' });
      y += 16;

      // VAT label: when reverse-charge applies, the supplier collects no VAT —
      // make that clear in the totals so the reader doesn't expect a 5% line.
      const vatLabel = invoice.reverseCharge
        ? 'VAT (reverse charge):'
        : vatBuckets.length === 1
          ? `VAT (${(vatBuckets[0].rate * 100).toFixed(0)}%):`
          : 'VAT:';
      doc.text(vatLabel, totalsX, y, { width: labelW });
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

      // ── e-Invoice QR Code (UAE FTA Phase 2 / ZATCA TLV format) ──────────────
      const qrSize = 72;
      const qrX = pageWidth - margin - qrSize;
      const qrY = y - 16;
      if (qrPng) {
        doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
        doc.fontSize(6).fillColor('#6B7280').font('Helvetica');
        doc.text('FTA e-Invoice', qrX, qrY + qrSize + 2, { width: qrSize, align: 'center' });
      } else {
        // Non-VAT-registered (or QR generation failed) — keep an empty box so
        // the layout stays stable for non-tax-invoice receipts.
        doc.rect(qrX, qrY, qrSize, qrSize).stroke('#D1D5DB');
        doc.fontSize(6).fillColor('#9CA3AF').font('Helvetica');
        doc.text('QR CODE', qrX, qrY + qrSize / 2 - 6, { width: qrSize, align: 'center' });
        doc.text('(N/A)', qrX, qrY + qrSize / 2 + 2, { width: qrSize, align: 'center' });
      }

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

function countLines(text: string): number {
  return Math.max(1, text.split('\n').length);
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

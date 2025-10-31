import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { formatCurrency, formatDate } from './format';

export interface InvoicePDFData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerTRN?: string;
  companyName: string;
  companyTRN?: string;
  companyAddress?: string;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
  }[];
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  locale: 'en' | 'ar';
}

export async function generateInvoicePDF(data: InvoicePDFData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const isRTL = data.locale === 'ar';

  // Color scheme - professional UAE colors
  const primaryColor = '#1E40AF'; // Blue
  const secondaryColor = '#059669'; // Green
  const textDark = '#1F2937';
  const textLight = '#6B7280';
  const borderColor = '#E5E7EB';

  let yPosition = margin;

  // Header Section with gradient background
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 50, 'F');

  // Company Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(data.companyName, isRTL ? pageWidth - margin : margin, yPosition + 15);

  // Invoice Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  const invoiceLabel = isRTL ? 'فاتورة' : 'INVOICE';
  doc.text(invoiceLabel, isRTL ? margin : pageWidth - margin, yPosition + 15, {
    align: isRTL ? 'left' : 'right',
  });

  yPosition = 60;

  // Invoice Details Box
  doc.setFillColor(249, 250, 251);
  doc.rect(margin, yPosition, pageWidth - 2 * margin, 30, 'F');
  doc.setDrawColor(229, 231, 235);
  doc.rect(margin, yPosition, pageWidth - 2 * margin, 30, 'S');

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');

  const invoiceNumLabel = isRTL ? 'رقم الفاتورة:' : 'Invoice #:';
  const dateLabel = isRTL ? 'التاريخ:' : 'Date:';

  doc.text(invoiceNumLabel, margin + 5, yPosition + 10);
  doc.setFont('helvetica', 'normal');
  doc.text(data.invoiceNumber, margin + 35, yPosition + 10);

  doc.setFont('helvetica', 'bold');
  doc.text(dateLabel, margin + 5, yPosition + 20);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDate(new Date(data.date), data.locale), margin + 35, yPosition + 20);

  // Company Details
  if (data.companyTRN) {
    doc.setFont('helvetica', 'bold');
    const trnLabel = isRTL ? 'الرقم الضريبي:' : 'TRN:';
    doc.text(trnLabel, pageWidth - margin - 60, yPosition + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(data.companyTRN, pageWidth - margin - 5, yPosition + 10, { align: 'right' });
  }

  yPosition += 45;

  // Bill To Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 64, 175);
  const billToLabel = isRTL ? 'الفاتورة إلى:' : 'BILL TO:';
  doc.text(billToLabel, margin, yPosition);

  yPosition += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(31, 41, 55);
  doc.text(data.customerName, margin, yPosition);

  if (data.customerTRN) {
    yPosition += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    const custTrnLabel = isRTL ? `الرقم الضريبي: ${data.customerTRN}` : `TRN: ${data.customerTRN}`;
    doc.text(custTrnLabel, margin, yPosition);
  }

  yPosition += 15;

  // Table Header
  const tableTop = yPosition;
  const col1X = margin;
  const col2X = margin + 80;
  const col3X = margin + 110;
  const col4X = margin + 135;
  const col5X = margin + 160;

  doc.setFillColor(30, 64, 175);
  doc.rect(margin, tableTop, pageWidth - 2 * margin, 10, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');

  const headers = isRTL
    ? ['المبلغ', 'ض.ق.م', 'السعر', 'الكمية', 'الوصف']
    : ['Description', 'Qty', 'Price', 'VAT', 'Amount'];

  if (isRTL) {
    doc.text(headers[4], pageWidth - col1X - 5, tableTop + 7, { align: 'right' });
    doc.text(headers[3], pageWidth - col2X, tableTop + 7, { align: 'center' });
    doc.text(headers[2], pageWidth - col3X, tableTop + 7, { align: 'center' });
    doc.text(headers[1], pageWidth - col4X, tableTop + 7, { align: 'center' });
    doc.text(headers[0], pageWidth - col5X - 5, tableTop + 7, { align: 'right' });
  } else {
    doc.text(headers[0], col1X + 2, tableTop + 7);
    doc.text(headers[1], col2X, tableTop + 7, { align: 'center' });
    doc.text(headers[2], col3X, tableTop + 7, { align: 'center' });
    doc.text(headers[3], col4X, tableTop + 7, { align: 'center' });
    doc.text(headers[4], col5X + 25, tableTop + 7, { align: 'right' });
  }

  yPosition = tableTop + 15;

  // Table Rows
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  data.lines.forEach((line, index) => {
    const rowBg: [number, number, number] = index % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
    doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
    doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, 8, 'F');

    const lineTotal = line.quantity * line.unitPrice;
    const vatPercent = (line.vatRate * 100).toFixed(0);

    if (isRTL) {
      doc.text(line.description, pageWidth - col1X - 5, yPosition, { align: 'right', maxWidth: 70 });
      doc.text(line.quantity.toString(), pageWidth - col2X, yPosition, { align: 'center' });
      doc.text(formatCurrency(line.unitPrice, data.currency, data.locale), pageWidth - col3X, yPosition, { align: 'center' });
      doc.text(`${vatPercent}%`, pageWidth - col4X, yPosition, { align: 'center' });
      doc.text(formatCurrency(lineTotal, data.currency, data.locale), pageWidth - col5X - 5, yPosition, { align: 'right' });
    } else {
      doc.text(line.description, col1X + 2, yPosition, { maxWidth: 70 });
      doc.text(line.quantity.toString(), col2X, yPosition, { align: 'center' });
      doc.text(formatCurrency(line.unitPrice, data.currency, data.locale), col3X, yPosition, { align: 'center' });
      doc.text(`${vatPercent}%`, col4X, yPosition, { align: 'center' });
      doc.text(formatCurrency(lineTotal, data.currency, data.locale), col5X + 25, yPosition, { align: 'right' });
    }

    yPosition += 10;
  });

  // Border around table
  doc.setDrawColor(229, 231, 235);
  doc.rect(margin, tableTop, pageWidth - 2 * margin, yPosition - tableTop - 5, 'S');

  yPosition += 10;

  // Totals Section
  const totalsX = pageWidth - margin - 60;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const subtotalLabel = isRTL ? 'المجموع الفرعي:' : 'Subtotal:';
  const vatLabel = isRTL ? 'ضريبة القيمة المضافة:' : 'VAT (5%):';
  const totalLabel = isRTL ? 'المجموع الكلي:' : 'TOTAL:';

  doc.text(subtotalLabel, totalsX, yPosition);
  doc.text(formatCurrency(data.subtotal, data.currency, data.locale), pageWidth - margin - 5, yPosition, { align: 'right' });

  yPosition += 8;
  doc.text(vatLabel, totalsX, yPosition);
  doc.text(formatCurrency(data.vatAmount, data.currency, data.locale), pageWidth - margin - 5, yPosition, { align: 'right' });

  yPosition += 10;
  doc.setFillColor(30, 64, 175);
  doc.rect(totalsX - 5, yPosition - 6, 65, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(totalLabel, totalsX, yPosition);
  doc.text(formatCurrency(data.total, data.currency, data.locale), pageWidth - margin - 5, yPosition, { align: 'right' });

  // QR Code for payment (optional)
  try {
    const qrData = `Invoice: ${data.invoiceNumber}\nAmount: ${data.total} ${data.currency}\nCompany: ${data.companyName}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 200,
      margin: 1,
    });
    
    doc.addImage(qrCodeDataUrl, 'PNG', margin, pageHeight - margin - 35, 35, 35);
  } catch (error) {
    console.error('Failed to generate QR code:', error);
  }

  // Footer
  doc.setTextColor(107, 114, 128);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const footerText = isRTL
    ? 'شكراً لتعاملكم معنا'
    : 'Thank you for your business';
  doc.text(footerText, pageWidth / 2, pageHeight - margin - 15, { align: 'center' });

  doc.setFontSize(7);
  const taxNote = isRTL
    ? 'هذه فاتورة ضريبية - يرجى الاحتفاظ بها لسجلاتكم'
    : 'This is a tax invoice - Please keep for your records';
  doc.text(taxNote, pageWidth / 2, pageHeight - margin - 10, { align: 'center' });

  return doc;
}

export async function downloadInvoicePDF(data: InvoicePDFData, filename?: string) {
  const pdf = await generateInvoicePDF(data);
  const name = filename || `invoice-${data.invoiceNumber}.pdf`;
  pdf.save(name);
}

export async function getInvoicePDFBlob(data: InvoicePDFData): Promise<Blob> {
  const pdf = await generateInvoicePDF(data);
  return pdf.output('blob');
}

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
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyLogo?: string;
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
  // Invoice customization settings
  showLogo?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showWebsite?: boolean;
  customTitle?: string;
  footerNote?: string;
  isVATRegistered?: boolean;
  // Bank details for professional invoices
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIBAN?: string;
  bankSwiftCode?: string;
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
  const contentWidth = pageWidth - 2 * margin;
  const isRTL = data.locale === 'ar';

  // Color scheme - professional UAE colors
  const primaryRGB: [number, number, number] = [30, 64, 175]; // #1E40AF Blue
  const primaryDarkRGB: [number, number, number] = [22, 48, 138]; // Darker blue for gradient
  const accentRGB: [number, number, number] = [5, 150, 105]; // #059669 Green
  const headerLightBgRGB: [number, number, number] = [219, 234, 254]; // #DBEAFE Light blue for table headers
  const altRowRGB: [number, number, number] = [239, 246, 255]; // #EFF6FF Very light blue for alternating rows
  const textDarkRGB: [number, number, number] = [31, 41, 55];
  const textMutedRGB: [number, number, number] = [107, 114, 128];
  const borderRGB: [number, number, number] = [209, 213, 219]; // #D1D5DB Slightly darker border
  const whiteRGB: [number, number, number] = [255, 255, 255];
  const bgLightRGB: [number, number, number] = [249, 250, 251];

  let yPosition = 0;

  // ============================================================
  // 1. PROFESSIONAL HEADER BAND
  // ============================================================
  const headerHeight = 55;

  // Primary header band
  doc.setFillColor(...primaryRGB);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');

  // Subtle darker accent strip at the very top (2mm)
  doc.setFillColor(...primaryDarkRGB);
  doc.rect(0, 0, pageWidth, 3, 'F');

  // Thin accent line at the bottom of the header
  doc.setFillColor(...accentRGB);
  doc.rect(0, headerHeight, pageWidth, 1.5, 'F');

  // Company Logo (if enabled and provided)
  let logoOffset = 0;
  if (data.showLogo && data.companyLogo) {
    try {
      const logoX = isRTL ? pageWidth - margin - 35 : margin;
      doc.addImage(data.companyLogo, 'PNG', logoX, 10, 35, 22);
      logoOffset = 40;
    } catch (error) {
      console.error('Failed to add logo to PDF:', error);
    }
  }

  // Company Name - larger, bolder typography
  doc.setTextColor(...whiteRGB);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  const companyNameX = logoOffset > 0
    ? (isRTL ? pageWidth - margin - logoOffset - 5 : margin + logoOffset)
    : (isRTL ? pageWidth - margin : margin);
  doc.text(data.companyName, companyNameX, 25, {
    align: isRTL ? 'right' : 'left',
  });

  // Company TRN displayed under company name in the header (small, white)
  if (data.isVATRegistered && data.companyTRN) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 220, 255); // Light blue-white
    const trnText = isRTL ? `الرقم الضريبي: ${data.companyTRN}` : `TRN: ${data.companyTRN}`;
    doc.text(trnText, companyNameX, 33, {
      align: isRTL ? 'right' : 'left',
    });
  }

  // Invoice Title - prominent, right-aligned
  doc.setTextColor(...whiteRGB);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  let invoiceLabel: string;
  if (data.customTitle) {
    invoiceLabel = data.customTitle;
  } else if (data.isVATRegistered) {
    invoiceLabel = isRTL ? 'فاتورة ضريبية' : 'TAX INVOICE';
  } else {
    invoiceLabel = isRTL ? 'فاتورة' : 'INVOICE';
  }
  doc.text(invoiceLabel, isRTL ? margin : pageWidth - margin, 22, {
    align: isRTL ? 'left' : 'right',
  });

  // Invoice number in the header, under the title
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 220, 255);
  const headerInvNum = isRTL ? `# ${data.invoiceNumber}` : `# ${data.invoiceNumber}`;
  doc.text(headerInvNum, isRTL ? margin : pageWidth - margin, 30, {
    align: isRTL ? 'left' : 'right',
  });

  // Date in the header
  doc.setFontSize(9);
  doc.text(formatDate(new Date(data.date), data.locale), isRTL ? margin : pageWidth - margin, 37, {
    align: isRTL ? 'left' : 'right',
  });

  yPosition = headerHeight + 8;

  // ============================================================
  // 2. COMPANY DETAILS BAR (below header)
  // ============================================================
  doc.setFillColor(...bgLightRGB);
  doc.rect(0, headerHeight + 1.5, pageWidth, 18, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...textMutedRGB);

  let detailsX = margin;
  const detailsY = headerHeight + 10;
  const detailParts: string[] = [];

  if (data.showAddress && data.companyAddress) {
    detailParts.push(data.companyAddress);
  }
  if (data.showPhone && data.companyPhone) {
    detailParts.push(isRTL ? `هاتف: ${data.companyPhone}` : `Tel: ${data.companyPhone}`);
  }
  if (data.showEmail && data.companyEmail) {
    detailParts.push(data.companyEmail);
  }
  if (data.showWebsite && data.companyWebsite) {
    detailParts.push(data.companyWebsite);
  }

  if (detailParts.length > 0) {
    const detailsLine = detailParts.join('  |  ');
    doc.text(detailsLine, pageWidth / 2, detailsY, {
      align: 'center',
      maxWidth: contentWidth,
    });
  }

  yPosition = headerHeight + 24;

  // ============================================================
  // 3. INVOICE META & BILL TO - Two column layout
  // ============================================================
  const metaBoxY = yPosition;

  // Left column: Bill To
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...primaryRGB);
  const billToLabel = isRTL ? 'الفاتورة إلى' : 'BILL TO';
  doc.text(billToLabel, margin, metaBoxY + 5);

  // Underline for section header
  doc.setDrawColor(...primaryRGB);
  doc.setLineWidth(0.5);
  doc.line(margin, metaBoxY + 7, margin + 25, metaBoxY + 7);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textDarkRGB);
  doc.text(data.customerName, margin, metaBoxY + 15);

  if (data.customerTRN) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...textMutedRGB);
    const custTrnLabel = isRTL ? `الرقم الضريبي: ${data.customerTRN}` : `TRN: ${data.customerTRN}`;
    doc.text(custTrnLabel, margin, metaBoxY + 21);
  }

  // Right column: Invoice details box
  const detailBoxX = pageWidth - margin - 65;
  const detailBoxW = 65;
  doc.setFillColor(...bgLightRGB);
  doc.roundedRect(detailBoxX, metaBoxY, detailBoxW, 24, 2, 2, 'F');
  doc.setDrawColor(...borderRGB);
  doc.roundedRect(detailBoxX, metaBoxY, detailBoxW, 24, 2, 2, 'S');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textMutedRGB);

  const invoiceNumLabel = isRTL ? 'رقم الفاتورة' : 'INVOICE NO.';
  const dateLabel = isRTL ? 'التاريخ' : 'DATE';

  doc.text(invoiceNumLabel, detailBoxX + 5, metaBoxY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...textDarkRGB);
  doc.text(data.invoiceNumber, detailBoxX + 5, metaBoxY + 11);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textMutedRGB);
  doc.text(dateLabel, detailBoxX + 5, metaBoxY + 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...textDarkRGB);
  doc.text(formatDate(new Date(data.date), data.locale), detailBoxX + 5, metaBoxY + 22);

  yPosition = metaBoxY + 32;

  // ============================================================
  // 4. IMPROVED LINE ITEMS TABLE
  // ============================================================
  const tableTop = yPosition;
  const tableWidth = contentWidth;

  // Column positions - improved spacing
  const col1X = margin;            // Description
  const col2X = margin + 85;       // Qty
  const col3X = margin + 105;      // Unit Price
  const col4X = margin + 135;      // VAT %
  const col5X = margin + 155;      // Amount
  const tableRight = margin + tableWidth;
  const rowHeight = 9;

  // Table header with colored background (light blue)
  doc.setFillColor(...primaryRGB);
  doc.roundedRect(margin, tableTop, tableWidth, 10, 1, 1, 'F');

  doc.setTextColor(...whiteRGB);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');

  const headers = isRTL
    ? ['المبلغ', 'ض.ق.م', 'السعر', 'الكمية', 'الوصف']
    : ['Description', 'Qty', 'Unit Price', 'VAT %', 'Amount'];

  if (isRTL) {
    doc.text(headers[4], pageWidth - col1X - 3, tableTop + 7, { align: 'right' });
    doc.text(headers[3], pageWidth - col2X, tableTop + 7, { align: 'center' });
    doc.text(headers[2], pageWidth - col3X, tableTop + 7, { align: 'center' });
    doc.text(headers[1], pageWidth - col4X, tableTop + 7, { align: 'center' });
    doc.text(headers[0], pageWidth - col5X, tableTop + 7, { align: 'right' });
  } else {
    doc.text(headers[0], col1X + 3, tableTop + 7);
    doc.text(headers[1], col2X + 5, tableTop + 7, { align: 'center' });
    doc.text(headers[2], col3X + 10, tableTop + 7, { align: 'right' });
    doc.text(headers[3], col4X + 8, tableTop + 7, { align: 'center' });
    doc.text(headers[4], tableRight - 3, tableTop + 7, { align: 'right' });
  }

  yPosition = tableTop + 13;

  // Table Rows with alternating colors
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  data.lines.forEach((line, index) => {
    // Alternating row backgrounds
    if (index % 2 === 1) {
      doc.setFillColor(...altRowRGB);
      doc.rect(margin, yPosition - 5, tableWidth, rowHeight, 'F');
    }

    doc.setTextColor(...textDarkRGB);

    const lineTotal = line.quantity * line.unitPrice;
    const vatPercent = (line.vatRate * 100).toFixed(0);

    if (isRTL) {
      doc.text(line.description, pageWidth - col1X - 3, yPosition, { align: 'right', maxWidth: 75 });
      doc.text(line.quantity.toString(), pageWidth - col2X, yPosition, { align: 'center' });
      doc.text(formatCurrency(line.unitPrice, data.currency, data.locale), pageWidth - col3X, yPosition, { align: 'right' });
      doc.text(`${vatPercent}%`, pageWidth - col4X, yPosition, { align: 'center' });
      doc.text(formatCurrency(lineTotal, data.currency, data.locale), pageWidth - col5X, yPosition, { align: 'right' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.text(line.description, col1X + 3, yPosition, { maxWidth: 75 });
      doc.text(line.quantity.toString(), col2X + 5, yPosition, { align: 'center' });
      doc.text(formatCurrency(line.unitPrice, data.currency, data.locale), col3X + 10, yPosition, { align: 'right' });
      doc.text(`${vatPercent}%`, col4X + 8, yPosition, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(lineTotal, data.currency, data.locale), tableRight - 3, yPosition, { align: 'right' });
    }

    // Subtle row separator line
    doc.setDrawColor(235, 238, 242);
    doc.setLineWidth(0.2);
    doc.line(margin, yPosition + 3.5, margin + tableWidth, yPosition + 3.5);

    yPosition += rowHeight;
  });

  // Bottom border of table
  doc.setDrawColor(...borderRGB);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition - 5, margin + tableWidth, yPosition - 5);

  // Outer border around entire table
  doc.setDrawColor(...borderRGB);
  doc.setLineWidth(0.3);
  doc.rect(margin, tableTop, tableWidth, yPosition - tableTop - 5, 'S');

  yPosition += 5;

  // ============================================================
  // 5. TOTALS SECTION - improved layout
  // ============================================================
  const totalsWidth = 75;
  const totalsX = pageWidth - margin - totalsWidth;

  // Totals background
  doc.setFillColor(...bgLightRGB);
  doc.roundedRect(totalsX, yPosition - 2, totalsWidth, 32, 2, 2, 'F');
  doc.setDrawColor(...borderRGB);
  doc.roundedRect(totalsX, yPosition - 2, totalsWidth, 32, 2, 2, 'S');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...textDarkRGB);

  const subtotalLabel = isRTL ? 'المجموع الفرعي:' : 'Subtotal:';
  const vatTotalLabel = isRTL ? 'ضريبة القيمة المضافة:' : 'VAT (5%):';
  const totalLabel = isRTL ? 'المجموع الكلي:' : 'TOTAL:';

  // Subtotal
  doc.text(subtotalLabel, totalsX + 5, yPosition + 5);
  doc.text(formatCurrency(data.subtotal, data.currency, data.locale), totalsX + totalsWidth - 5, yPosition + 5, { align: 'right' });

  // VAT
  yPosition += 8;
  doc.text(vatTotalLabel, totalsX + 5, yPosition + 5);
  doc.text(formatCurrency(data.vatAmount, data.currency, data.locale), totalsX + totalsWidth - 5, yPosition + 5, { align: 'right' });

  // Separator line before total
  yPosition += 8;
  doc.setDrawColor(...primaryRGB);
  doc.setLineWidth(0.5);
  doc.line(totalsX + 3, yPosition + 1, totalsX + totalsWidth - 3, yPosition + 1);

  // Total - bold, colored background
  yPosition += 3;
  doc.setFillColor(...primaryRGB);
  doc.roundedRect(totalsX, yPosition, totalsWidth, 10, 1, 1, 'F');
  doc.setTextColor(...whiteRGB);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(totalLabel, totalsX + 5, yPosition + 7);
  doc.text(formatCurrency(data.total, data.currency, data.locale), totalsX + totalsWidth - 5, yPosition + 7, { align: 'right' });

  yPosition += 18;

  // ============================================================
  // 6. BANK DETAILS SECTION
  // ============================================================
  const hasBankDetails = data.bankName || data.bankAccountNumber || data.bankIBAN;

  if (hasBankDetails) {
    // Section header
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryRGB);
    const bankLabel = isRTL ? 'تفاصيل الحساب البنكي' : 'BANK DETAILS';
    doc.text(bankLabel, margin, yPosition + 3);

    // Underline
    doc.setDrawColor(...primaryRGB);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition + 5, margin + 30, yPosition + 5);

    yPosition += 10;

    // Bank details box
    const bankBoxHeight = 28;
    doc.setFillColor(...bgLightRGB);
    doc.roundedRect(margin, yPosition, contentWidth / 2, bankBoxHeight, 2, 2, 'F');
    doc.setDrawColor(...borderRGB);
    doc.roundedRect(margin, yPosition, contentWidth / 2, bankBoxHeight, 2, 2, 'S');

    let bankY = yPosition + 6;
    doc.setFontSize(8);
    doc.setTextColor(...textDarkRGB);

    if (data.bankName) {
      doc.setFont('helvetica', 'bold');
      doc.text(isRTL ? 'البنك:' : 'Bank:', margin + 4, bankY);
      doc.setFont('helvetica', 'normal');
      doc.text(data.bankName, margin + 25, bankY);
      bankY += 5;
    }

    if (data.bankAccountName) {
      doc.setFont('helvetica', 'bold');
      doc.text(isRTL ? 'اسم الحساب:' : 'Account Name:', margin + 4, bankY);
      doc.setFont('helvetica', 'normal');
      doc.text(data.bankAccountName, margin + 35, bankY);
      bankY += 5;
    }

    if (data.bankAccountNumber) {
      doc.setFont('helvetica', 'bold');
      doc.text(isRTL ? 'رقم الحساب:' : 'Account No:', margin + 4, bankY);
      doc.setFont('helvetica', 'normal');
      doc.text(data.bankAccountNumber, margin + 30, bankY);
      bankY += 5;
    }

    if (data.bankIBAN) {
      doc.setFont('helvetica', 'bold');
      doc.text('IBAN:', margin + 4, bankY);
      doc.setFont('helvetica', 'normal');
      doc.text(data.bankIBAN, margin + 18, bankY);
      bankY += 5;
    }

    if (data.bankSwiftCode) {
      doc.setFont('helvetica', 'bold');
      doc.text('SWIFT:', margin + 4, bankY);
      doc.setFont('helvetica', 'normal');
      doc.text(data.bankSwiftCode, margin + 20, bankY);
    }

    yPosition += bankBoxHeight + 5;
  } else {
    // Placeholder bank details area
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryRGB);
    const bankLabel = isRTL ? 'تفاصيل الحساب البنكي' : 'BANK DETAILS';
    doc.text(bankLabel, margin, yPosition + 3);

    doc.setDrawColor(...primaryRGB);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition + 5, margin + 30, yPosition + 5);

    yPosition += 10;

    doc.setFillColor(...bgLightRGB);
    doc.roundedRect(margin, yPosition, contentWidth / 2, 15, 2, 2, 'F');
    doc.setDrawColor(...borderRGB);
    doc.setLineDashPattern([1, 1], 0);
    doc.roundedRect(margin, yPosition, contentWidth / 2, 15, 2, 2, 'S');
    doc.setLineDashPattern([], 0);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...textMutedRGB);
    const placeholder = isRTL ? 'أضف تفاصيل البنك في الإعدادات' : 'Add bank details in settings';
    doc.text(placeholder, margin + 4, yPosition + 9);

    yPosition += 20;
  }

  // ============================================================
  // 7. QR CODE AREA (bottom-right)
  // ============================================================
  const qrSize = 30;
  const qrX = pageWidth - margin - qrSize;
  const qrY = pageHeight - margin - qrSize - 20;

  // QR code label
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textMutedRGB);
  const qrLabel = isRTL ? 'رمز الاستجابة السريعة' : 'QR CODE';
  doc.text(qrLabel, qrX + qrSize / 2, qrY - 2, { align: 'center' });

  // Try to generate actual QR code
  let qrGenerated = false;
  try {
    const qrData = `Invoice: ${data.invoiceNumber}\nAmount: ${data.total} ${data.currency}\nCompany: ${data.companyName}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 200,
      margin: 1,
    });

    doc.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    qrGenerated = true;
  } catch (error) {
    console.error('Failed to generate QR code:', error);
  }

  // If QR generation failed, show placeholder box
  if (!qrGenerated) {
    doc.setDrawColor(...borderRGB);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(qrX, qrY, qrSize, qrSize, 'S');
    doc.setLineDashPattern([], 0);

    doc.setFillColor(...bgLightRGB);
    doc.rect(qrX + 1, qrY + 1, qrSize - 2, qrSize - 2, 'F');

    // QR placeholder icon (simple grid pattern)
    doc.setFillColor(...borderRGB);
    const cellSize = 3;
    const gridStart = qrX + (qrSize - cellSize * 5) / 2;
    const gridStartY = qrY + (qrSize - cellSize * 5) / 2;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        if ((row + col) % 2 === 0) {
          doc.rect(gridStart + col * cellSize, gridStartY + row * cellSize, cellSize, cellSize, 'F');
        }
      }
    }

    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textMutedRGB);
    doc.text('E-Invoice Ready', qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' });
  }

  // ============================================================
  // 8. FOOTER SECTION
  // ============================================================

  // Footer separator line
  const footerLineY = pageHeight - margin - 8;
  doc.setDrawColor(...borderRGB);
  doc.setLineWidth(0.3);
  doc.line(margin, footerLineY, pageWidth - margin, footerLineY);

  // Custom footer note or default thank you
  doc.setTextColor(...textMutedRGB);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  let footerY = footerLineY + 4;

  if (data.footerNote) {
    doc.text(data.footerNote, pageWidth / 2, footerY, { align: 'center', maxWidth: contentWidth });
  } else {
    const footerText = isRTL
      ? 'شكراً لتعاملكم معنا'
      : 'Thank you for your business';
    doc.text(footerText, margin, footerY);
  }

  // Tax notice for VAT registered companies
  if (data.isVATRegistered) {
    doc.setFontSize(7);
    const taxNote = isRTL
      ? 'هذه فاتورة ضريبية - يرجى الاحتفاظ بها لسجلاتكم'
      : 'This is a tax invoice - Please retain for your records';
    doc.text(taxNote, margin, footerY + 4);
  }

  // "Powered by Muhasib.ai" branding footer - right-aligned
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 170, 185); // Subtle gray
  const brandingText = 'Generated by Muhasib.ai | FTA-Compliant';
  doc.text(brandingText, pageWidth - margin, footerY + (data.isVATRegistered ? 4 : 0), { align: 'right' });

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

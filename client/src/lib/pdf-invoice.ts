import jsPDF from "jspdf";
import QRCode from "qrcode";
import { formatCurrency, formatDate } from "./format";

export type InvoicePdfTemplate = "standard" | "nra";

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
  locale: "en" | "ar";
  companyType?: string | null;
  invoiceTemplate?: InvoicePdfTemplate;
  // Invoice customization settings
  showLogo?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showWebsite?: boolean;
  customTitle?: string;
  footerNote?: string;
  isVATRegistered?: boolean;
}

const NRA_PAGE_WIDTH = 210;
const NR_GREEN: [number, number, number] = [111, 158, 58];
const BORDER: [number, number, number] = [17, 17, 17];
const HEADER_FILL: [number, number, number] = [230, 230, 230];

export function invoicePdfTemplateForData(data: InvoicePDFData): InvoicePdfTemplate {
  return data.invoiceTemplate ?? (data.companyType === "client" ? "nra" : "standard");
}

export async function generateInvoicePDF(data: InvoicePDFData): Promise<jsPDF> {
  if (invoicePdfTemplateForData(data) === "nra") {
    return generateNraInvoicePDF(data);
  }

  return generateStandardInvoicePDF(data);
}

async function generateStandardInvoicePDF(data: InvoicePDFData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const isRTL = data.locale === "ar";

  // Color scheme - professional UAE colors
  const primaryColor = "#1E40AF"; // Blue
  const secondaryColor = "#059669"; // Green
  const textDark = "#1F2937";
  const textLight = "#6B7280";
  const borderColor = "#E5E7EB";

  let yPosition = margin;

  // Header Section with gradient background
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 50, "F");

  // Company Logo (if enabled and provided)
  if (data.showLogo && data.companyLogo) {
    try {
      doc.addImage(
        data.companyLogo,
        "PNG",
        isRTL ? pageWidth - margin - 40 : margin,
        yPosition,
        40,
        25
      );
    } catch (error) {
      console.error("Failed to add logo to PDF:", error);
    }
  }

  // Company Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  const companyNameX =
    data.showLogo && data.companyLogo
      ? isRTL
        ? pageWidth - margin - 50
        : margin + 45
      : isRTL
        ? pageWidth - margin
        : margin;
  doc.text(data.companyName, companyNameX, yPosition + 15);

  // Invoice Title - "Tax Invoice" for VAT registered, or custom title
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  let invoiceLabel: string;
  if (data.customTitle) {
    invoiceLabel = data.customTitle;
  } else if (data.isVATRegistered) {
    invoiceLabel = isRTL ? "فاتورة ضريبية" : "TAX INVOICE";
  } else {
    invoiceLabel = isRTL ? "فاتورة" : "INVOICE";
  }
  doc.text(invoiceLabel, isRTL ? margin : pageWidth - margin, yPosition + 15, {
    align: isRTL ? "left" : "right",
  });

  yPosition = 60;

  // Invoice Details Box
  doc.setFillColor(249, 250, 251);
  doc.rect(margin, yPosition, pageWidth - 2 * margin, 30, "F");
  doc.setDrawColor(229, 231, 235);
  doc.rect(margin, yPosition, pageWidth - 2 * margin, 30, "S");

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");

  const invoiceNumLabel = isRTL ? "رقم الفاتورة:" : "Invoice #:";
  const dateLabel = isRTL ? "التاريخ:" : "Date:";

  doc.text(invoiceNumLabel, margin + 5, yPosition + 10);
  doc.setFont("helvetica", "normal");
  doc.text(data.invoiceNumber, margin + 35, yPosition + 10);

  doc.setFont("helvetica", "bold");
  doc.text(dateLabel, margin + 5, yPosition + 20);
  doc.setFont("helvetica", "normal");
  doc.text(formatDate(new Date(data.date), data.locale), margin + 35, yPosition + 20);

  // Company Details - Right side
  let companyDetailsY = yPosition + 10;

  // TRN (always show for VAT registered companies)
  if (data.isVATRegistered && data.companyTRN) {
    doc.setFont("helvetica", "bold");
    const trnLabel = isRTL ? "الرقم الضريبي:" : "TRN:";
    doc.text(trnLabel, pageWidth - margin - 65, companyDetailsY);
    doc.setFont("helvetica", "normal");
    doc.text(data.companyTRN, pageWidth - margin - 5, companyDetailsY, { align: "right" });
    companyDetailsY += 6;
  }

  // Additional company details (left side below invoice box)
  let additionalDetailsY = yPosition + 35;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(107, 114, 128);

  if (data.showAddress && data.companyAddress) {
    doc.text(data.companyAddress, margin, additionalDetailsY, { maxWidth: 80 });
    additionalDetailsY += 8;
  }

  if (data.showPhone && data.companyPhone) {
    const phoneLabel = isRTL ? `هاتف: ${data.companyPhone}` : `Phone: ${data.companyPhone}`;
    doc.text(phoneLabel, margin, additionalDetailsY);
    additionalDetailsY += 5;
  }

  if (data.showEmail && data.companyEmail) {
    const emailLabel = isRTL ? `بريد: ${data.companyEmail}` : `Email: ${data.companyEmail}`;
    doc.text(emailLabel, margin, additionalDetailsY);
    additionalDetailsY += 5;
  }

  if (data.showWebsite && data.companyWebsite) {
    const websiteLabel = isRTL ? `موقع: ${data.companyWebsite}` : `Web: ${data.companyWebsite}`;
    doc.text(websiteLabel, margin, additionalDetailsY);
    additionalDetailsY += 5;
  }

  yPosition = Math.max(yPosition + 45, additionalDetailsY + 5);

  // Bill To Section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  const billToLabel = isRTL ? "الفاتورة إلى:" : "BILL TO:";
  doc.text(billToLabel, margin, yPosition);

  yPosition += 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(31, 41, 55);
  doc.text(data.customerName, margin, yPosition);

  if (data.customerTRN) {
    yPosition += 6;
    doc.setFont("helvetica", "normal");
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
  doc.rect(margin, tableTop, pageWidth - 2 * margin, 10, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");

  const headers = isRTL
    ? ["المبلغ", "ض.ق.م", "السعر", "الكمية", "الوصف"]
    : ["Description", "Qty", "Price", "VAT", "Amount"];

  if (isRTL) {
    doc.text(headers[4], pageWidth - col1X - 5, tableTop + 7, { align: "right" });
    doc.text(headers[3], pageWidth - col2X, tableTop + 7, { align: "center" });
    doc.text(headers[2], pageWidth - col3X, tableTop + 7, { align: "center" });
    doc.text(headers[1], pageWidth - col4X, tableTop + 7, { align: "center" });
    doc.text(headers[0], pageWidth - col5X - 5, tableTop + 7, { align: "right" });
  } else {
    doc.text(headers[0], col1X + 2, tableTop + 7);
    doc.text(headers[1], col2X, tableTop + 7, { align: "center" });
    doc.text(headers[2], col3X, tableTop + 7, { align: "center" });
    doc.text(headers[3], col4X, tableTop + 7, { align: "center" });
    doc.text(headers[4], col5X + 25, tableTop + 7, { align: "right" });
  }

  yPosition = tableTop + 15;

  // Table Rows
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  data.lines.forEach((line, index) => {
    const rowBg: [number, number, number] = index % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
    doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
    doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, 8, "F");

    const lineTotal = line.quantity * line.unitPrice;
    const vatPercent = (line.vatRate * 100).toFixed(0);

    if (isRTL) {
      doc.text(line.description, pageWidth - col1X - 5, yPosition, {
        align: "right",
        maxWidth: 70,
      });
      doc.text(line.quantity.toString(), pageWidth - col2X, yPosition, { align: "center" });
      doc.text(
        formatCurrency(line.unitPrice, data.currency, data.locale),
        pageWidth - col3X,
        yPosition,
        { align: "center" }
      );
      doc.text(`${vatPercent}%`, pageWidth - col4X, yPosition, { align: "center" });
      doc.text(
        formatCurrency(lineTotal, data.currency, data.locale),
        pageWidth - col5X - 5,
        yPosition,
        { align: "right" }
      );
    } else {
      doc.text(line.description, col1X + 2, yPosition, { maxWidth: 70 });
      doc.text(line.quantity.toString(), col2X, yPosition, { align: "center" });
      doc.text(formatCurrency(line.unitPrice, data.currency, data.locale), col3X, yPosition, {
        align: "center",
      });
      doc.text(`${vatPercent}%`, col4X, yPosition, { align: "center" });
      doc.text(formatCurrency(lineTotal, data.currency, data.locale), col5X + 25, yPosition, {
        align: "right",
      });
    }

    yPosition += 10;
  });

  // Border around table
  doc.setDrawColor(229, 231, 235);
  doc.rect(margin, tableTop, pageWidth - 2 * margin, yPosition - tableTop - 5, "S");

  yPosition += 10;

  // Totals Section
  const totalsX = pageWidth - margin - 60;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const subtotalLabel = isRTL ? "المجموع الفرعي:" : "Subtotal:";
  const vatLabel = isRTL ? "ضريبة القيمة المضافة:" : "VAT (5%):";
  const totalLabel = isRTL ? "المجموع الكلي:" : "TOTAL:";

  doc.text(subtotalLabel, totalsX, yPosition);
  doc.text(
    formatCurrency(data.subtotal, data.currency, data.locale),
    pageWidth - margin - 5,
    yPosition,
    { align: "right" }
  );

  yPosition += 8;
  doc.text(vatLabel, totalsX, yPosition);
  doc.text(
    formatCurrency(data.vatAmount, data.currency, data.locale),
    pageWidth - margin - 5,
    yPosition,
    { align: "right" }
  );

  yPosition += 10;
  doc.setFillColor(30, 64, 175);
  doc.rect(totalsX - 5, yPosition - 6, 65, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(totalLabel, totalsX, yPosition);
  doc.text(
    formatCurrency(data.total, data.currency, data.locale),
    pageWidth - margin - 5,
    yPosition,
    { align: "right" }
  );

  // QR Code for payment (optional)
  try {
    const qrData = `Invoice: ${data.invoiceNumber}\nAmount: ${data.total} ${data.currency}\nCompany: ${data.companyName}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 200,
      margin: 1,
    });

    doc.addImage(qrCodeDataUrl, "PNG", margin, pageHeight - margin - 35, 35, 35);
  } catch (error) {
    console.error("Failed to generate QR code:", error);
  }

  // Footer
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  let footerY = pageHeight - margin - 15;

  // Custom footer note if provided
  if (data.footerNote) {
    doc.text(data.footerNote, pageWidth / 2, footerY, {
      align: "center",
      maxWidth: pageWidth - 2 * margin,
    });
    footerY += 5;
  } else {
    const footerText = isRTL ? "شكراً لتعاملكم معنا" : "Thank you for your business";
    doc.text(footerText, pageWidth / 2, footerY, { align: "center" });
    footerY += 5;
  }

  // Tax notice for VAT registered companies
  if (data.isVATRegistered) {
    doc.setFontSize(7);
    const taxNote = isRTL
      ? "هذه فاتورة ضريبية - يرجى الاحتفاظ بها لسجلاتكم"
      : "This is a tax invoice - Please keep for your records";
    doc.text(taxNote, pageWidth / 2, footerY, { align: "center" });
  }

  return doc;
}

async function generateNraInvoicePDF(data: InvoicePDFData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  doc.setProperties({
    title: `Invoice ${data.invoiceNumber}`,
    author: "Najma Al Raeda Accounting Services",
    subject: "Invoice",
    creator: "Muhasib.ai",
  });

  drawNraInvoiceTitle(doc);
  drawNraDateInvoiceBox(doc, data);
  drawNraHeader(doc);
  drawNraBillToBox(doc, data);
  drawNraLineItemsTable(doc, data);
  drawNraTotalBox(doc, data);

  return doc;
}

function drawNraInvoiceTitle(doc: jsPDF) {
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("Invoice", NRA_PAGE_WIDTH / 2, 22, { align: "center" });
}

function drawNraDateInvoiceBox(doc: jsPDF, data: InvoicePDFData) {
  const x = 152.4;
  const y = 13.4;
  const w = 51.2;
  const h = 13.8;
  const colW = w / 2;
  const headerH = 5.3;

  doc.setLineWidth(0.35);
  doc.setDrawColor(...BORDER);
  doc.rect(x, y, w, h, "S");
  doc.line(x + colW, y, x + colW, y + h);
  doc.line(x, y + headerH, x + w, y + headerH);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Date", x + colW / 2, y + 3.8, { align: "center" });
  doc.text("Invoice #", x + colW + colW / 2, y + 3.8, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.text(formatNraInvoiceDate(data.date), x + colW / 2, y + 11.5, { align: "center" });
  drawNraSingleLineCellText(doc, data.invoiceNumber, x + colW, y + 11.5, colW);
}

function drawNraHeader(doc: jsPDF) {
  const centerX = NRA_PAGE_WIDTH / 2;
  const logoTop = 24.7;

  doc.setDrawColor(...NR_GREEN);
  doc.setFillColor(...NR_GREEN);
  doc.setLineWidth(1.4);
  doc.line(centerX - 29.3, logoTop + 17.6, centerX - 10.6, logoTop + 17.6);
  doc.line(centerX - 10.6, logoTop + 17.6, centerX - 2.5, logoTop + 8.8);
  doc.line(centerX - 2.5, logoTop + 8.8, centerX + 6, logoTop + 17.6);
  doc.line(centerX + 6, logoTop + 17.6, centerX + 26.5, logoTop - 6.4);
  doc.triangle(
    centerX + 26.5,
    logoTop - 6.4,
    centerX + 22.6,
    logoTop + 0.7,
    centerX + 31.4,
    logoTop - 10.2,
    "F"
  );

  doc.setLineWidth(0.7);
  doc.line(centerX - 29.3, logoTop + 17.6, centerX + 30, logoTop + 17.6);

  doc.setTextColor(...NR_GREEN);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text("NAJMA AL RAEDA", centerX, 53.8, { align: "center" });

  doc.setLineWidth(0.5);
  doc.line(centerX - 29.3, 55.7, centerX + 29.3, 55.7);

  doc.setFontSize(8.5);
  doc.text("A C C O U N T I N G   S E R V I C E S", centerX, 62.1, {
    align: "center",
  });

  doc.setTextColor(0, 0, 0);
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.text("Al Futtaim Tower, 202", centerX, 69.2, { align: "center" });
  doc.text("Baniyas Square,", centerX, 74.5, { align: "center" });
  doc.text("Dubai, U.A.E.", centerX, 79.8, { align: "center" });
  doc.text("971-50-7042270", centerX, 85.1, { align: "center" });
}

function drawNraBillToBox(doc: jsPDF, data: InvoicePDFData) {
  const x = 130.5;
  const y = 77.6;
  const w = 65.3;
  const h = 33.9;
  const headerH = 8.5;

  doc.setLineWidth(0.35);
  doc.setDrawColor(...BORDER);
  doc.rect(x, y, w, h, "S");
  doc.line(x, y + headerH, x + w, y + headerH);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Bill To", x + 4.2, y + 5.8);

  doc.setTextColor(34, 34, 34);
  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  doc.text(data.customerName, x + 1.5, y + headerH + 5.1, {
    maxWidth: w - 3,
  });
}

function drawNraLineItemsTable(doc: jsPDF, data: InvoicePDFData) {
  const x = 12.7;
  const y = 121.7;
  const w = 184.5;
  const h = 140.4;
  const headerH = 7;
  const widths = [16.2, 52.9, 67, 26.1, 22.3];
  const headers = ["Quantity", "Item Code", "Description", "Price Each", "Amount"];
  const colX = widths.reduce<number[]>(
    (acc, width) => {
      acc.push(acc[acc.length - 1] + width);
      return acc;
    },
    [x]
  );

  doc.setLineWidth(0.35);
  doc.setDrawColor(...BORDER);
  doc.rect(x, y, w, h, "S");
  doc.setFillColor(...HEADER_FILL);
  doc.rect(x, y, w, headerH, "FD");

  for (let i = 1; i < colX.length - 1; i += 1) {
    doc.line(colX[i], y, colX[i], y + h);
  }
  doc.line(x, y + headerH, x + w, y + headerH);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  headers.forEach((header, index) => {
    doc.text(header, colX[index] + widths[index] / 2, y + 4.9, {
      align: "center",
    });
  });

  let rowY = y + headerH + 4.5;
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(17, 17, 17);

  for (const line of data.lines) {
    if (rowY > y + h - 6) break;

    const parsed = splitLineDescription(line.description);
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const itemCodeLines = doc.splitTextToSize(parsed.itemCode || " ", widths[1] - 2);
    const descriptionLines = doc.splitTextToSize(parsed.description || " ", widths[2] - 2);

    doc.text(formatNraQuantity(line.quantity), colX[0] + widths[0] / 2, rowY, {
      align: "center",
    });
    doc.text(itemCodeLines, colX[1] + 1.2, rowY);
    doc.text(descriptionLines, colX[2] + 1.2, rowY);
    doc.text(formatNraPlainAmount(Number(line.unitPrice || 0)), colX[3] + widths[3] - 2, rowY, {
      align: "right",
    });
    doc.text(formatNraPlainAmount(amount), colX[4] + widths[4] - 2, rowY, {
      align: "right",
    });

    rowY += Math.max(6, itemCodeLines.length * 4.4, descriptionLines.length * 4.4);
  }
}

function drawNraTotalBox(doc: jsPDF, data: InvoicePDFData) {
  const x = 12.7;
  const y = 263.9;
  const w = 184.5;
  const h = 14.1;
  const splitX = 146.1;

  doc.setLineWidth(0.35);
  doc.setDrawColor(...BORDER);
  doc.rect(x, y, w, h, "S");
  doc.line(splitX, y, splitX, y + h);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Total", splitX + 4.6, y + 9.8);

  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.text(formatNraTotalAmount(Number(data.total || 0), data.currency), x + w - 4.2, y + 9.8, {
    align: "right",
  });
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

function formatNraInvoiceDate(date: string): string {
  const dateOnly = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[2]}/${dateOnly[3]}/${dateOnly[1]}`;

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${month}/${day}/${parsed.getFullYear()}`;
}

function drawNraSingleLineCellText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number
) {
  let fontSize = 10.5;
  doc.setFont("times", "normal");
  doc.setFontSize(fontSize);
  while (fontSize > 7 && doc.getTextWidth(text) > width - 2) {
    fontSize -= 0.5;
    doc.setFontSize(fontSize);
  }
  doc.text(text, x + width / 2, y + (10.5 - fontSize) / 4, { align: "center" });
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

export async function downloadInvoicePDF(data: InvoicePDFData, filename?: string) {
  const pdf = await generateInvoicePDF(data);
  const name = filename || `invoice-${data.invoiceNumber}.pdf`;
  pdf.save(name);
}

export async function getInvoicePDFBlob(data: InvoicePDFData): Promise<Blob> {
  const pdf = await generateInvoicePDF(data);
  return pdf.output("blob");
}

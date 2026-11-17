// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { loadCompanyLogo } from "./pdf-logo";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { renderEInvoiceQrPng } from "./einvoice-qr.service";
import {
  isArabic,
  isDraftStatus,
  pdfLocale,
  preparePdfDocument,
  stampDraftWatermark,
  text,
  type PdfDoc,
  type PdfLocale,
} from "./pdf-fonts";
import {
  amount,
  bi,
  companyDetails,
  date as ledgerDate,
  Ledger,
  LEDGER_COLORS,
  lineVatRate,
  ltr,
  MM,
  money,
  trnLine,
  type Bi,
} from "./pdf-ledger";

const PAGE_WIDTH = 595.28;
const NR_GREEN = "#6F9E3A";
const BORDER = "#111111";
const HEADER_FILL = "#E6E6E6";

export type InvoicePdfTemplate = "standard" | "nra";

export interface GenerateInvoicePdfOptions {
  template?: InvoicePdfTemplate;
  /** Document language; defaults to the company's `locale` (en/ar). */
  locale?: PdfLocale;
  /** Payments received so far. Defaults to the full total for `paid` invoices, else 0. */
  amountPaid?: number;
  /** Date of supply; defaults to the invoice date when absent. */
  supplyDate?: Date | string | null;
  /** Customer details from the linked contact, used when the invoice has none stored. */
  customer?: { name?: string | null; trn?: string | null; address?: string | null };
  /**
   * W3-A (R03-24): invoice-template branding applied to the standard layout. WP-F: the template
   * colour is the document accent (top rule, section labels, amount-due row only).
   */
  branding?: InvoicePdfBranding | null;
}

export interface InvoicePdfBranding {
  primaryColor?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  termsText?: string | null;
  bankDetails?: string | null;
  /**
   * Legacy template logo (raster data: URL). The company's uploaded logo (companies.logo_path)
   * wins; nothing is fetched from the network while rendering.
   */
  logoUrl?: string | null;
  showLogo?: boolean | null;
}

export function invoicePdfTemplateForCompany(company: Company): InvoicePdfTemplate {
  return company.companyType === "client" ? "nra" : "standard";
}

export async function generateInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: GenerateInvoicePdfOptions = {}
): Promise<Buffer> {
  const template = options.template ?? invoicePdfTemplateForCompany(company);
  if (template === "nra") {
    return generateNraInvoicePDF(invoice, lines);
  }

  return generateStandardInvoicePDF(invoice, lines, company, options);
}

export type VatTreatment =
  | "standard_rated"
  | "zero_rated"
  | "exempt"
  | "out_of_scope"
  | "reverse_charge";

const TREATMENT_LABELS: Record<VatTreatment, { en: string; ar: string }> = {
  standard_rated: { en: "Standard rated", ar: "خاضع للنسبة الأساسية" },
  zero_rated: { en: "Zero-rated", ar: "خاضع لنسبة الصفر" },
  exempt: { en: "Exempt", ar: "معفى" },
  out_of_scope: { en: "Out of scope", ar: "خارج النطاق" },
  reverse_charge: { en: "Reverse charge", ar: "الاحتساب العكسي" },
};

/**
 * VAT treatment of one invoice line (R03-19). Reads `line.vatSupplyType` when present and
 * consistent with the rate, otherwise derives it from the rate; a reverse-charge invoice marks
 * every taxable line as reverse charge.
 */
export function vatTreatmentForLine(
  line: Pick<InvoiceLine, "vatRate"> & { vatSupplyType?: string | null },
  reverseCharge = false
): VatTreatment {
  const rate = lineVatRate(line);
  const declared = (line.vatSupplyType ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const known: VatTreatment[] = [
    "standard_rated",
    "zero_rated",
    "exempt",
    "out_of_scope",
    "reverse_charge",
  ];
  let treatment: VatTreatment;
  if ((known as string[]).includes(declared) && !(declared === "standard_rated" && rate === 0)) {
    treatment = declared as VatTreatment;
  } else {
    treatment = rate > 0 ? "standard_rated" : "zero_rated";
  }
  if (reverseCharge && treatment === "standard_rated") return "reverse_charge";
  return treatment;
}

export interface InvoicePdfTotals {
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  paid: boolean;
  /** VAT in AED for foreign-currency invoices; null when the invoice is already in AED. */
  vatAed: number | null;
  exchangeRate: number;
}

/** Totals block (R03-15): amount due = total minus payments, never negative. */
export function computeInvoicePdfTotals(
  invoice: Invoice,
  options: Pick<GenerateInvoicePdfOptions, "amountPaid"> = {}
): InvoicePdfTotals {
  const currency = invoice.currency || "AED";
  const total = Number(invoice.total) || 0;
  const status = (invoice.status || "").toLowerCase();
  let amountPaid = options.amountPaid ?? (status === "paid" ? total : 0);
  amountPaid = Math.min(Math.max(amountPaid, 0), Math.max(total, 0));
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const exchangeRate = Number(invoice.exchangeRate) > 0 ? Number(invoice.exchangeRate) : 1;
  return {
    currency,
    subtotal: Number(invoice.subtotal) || 0,
    vat: Number(invoice.vatAmount) || 0,
    total,
    amountPaid,
    amountDue,
    paid: status === "paid" || (total > 0 && amountDue === 0),
    vatAed: currency === "AED" ? null : (Number(invoice.vatAmount) || 0) * exchangeRate,
    exchangeRate,
  };
}

async function generateStandardInvoicePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: GenerateInvoicePdfOptions = {}
): Promise<Buffer> {
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
      qrPng = null;
    }
  }

  const locale = options.locale ?? pdfLocale(company);
  const totals = computeInvoicePdfTotals(invoice, options);
  const customer = {
    name: invoice.customerName || options.customer?.name || "",
    trn: invoice.customerTrn || options.customer?.trn || null,
    address: invoice.customerAddress || options.customer?.address || null,
  };
  const supplyDate =
    options.supplyDate ??
    (invoice as Invoice & { supplyDate?: Date | string | null }).supplyDate ??
    invoice.date;

  // S1 (R14-13): the uploaded logo (companies.logo_path), template data: URL as legacy fallback.
  const logo = await loadCompanyLogo(company, {
    fallbackDataUrl: options.branding?.logoUrl ?? null,
    show: options.branding?.showLogo,
  });
  const brand = options.branding ?? null;
  const isVATRegistered = !!company.trnVatNumber;

  const ledger = new Ledger({
    locale,
    accent: brand?.primaryColor,
    info: {
      Title: `Invoice ${invoice.number}`,
      Author: company.name,
      Subject: "Tax Invoice",
    },
  });
  const m = (n: number) => money(n, totals.currency);

  ledger.header({
    companyName: company.name,
    logo,
    details: [
      ...companyDetails(ledger, {
        trn: isVATRegistered ? company.trnVatNumber : null,
        address: company.businessAddress,
        phone: company.contactPhone,
        email: company.contactEmail,
      }),
      brand?.headerText ?? "",
    ],
    title: isVATRegistered ? bi("Tax invoice", "فاتورة ضريبية") : bi("Invoice", "فاتورة"),
  });

  if (invoice.reverseCharge) {
    ledger.note(
      bi("Reverse charge", "آلية الاحتساب العكسي"),
      ledger.rtl
        ? "تُحتسب ضريبة القيمة المضافة من قبل المستلم بموجب آلية الاحتساب العكسي (قانون ضريبة القيمة المضافة الإماراتي). VAT is to be accounted for by the recipient under the reverse-charge mechanism."
        : "VAT is to be accounted for by the recipient under the reverse-charge mechanism (UAE VAT law). تُحتسب ضريبة القيمة المضافة من قبل المستلم بموجب آلية الاحتساب العكسي."
    );
  }

  ledger.meta([
    { label: bi("Invoice no.", "رقم الفاتورة"), value: ltr(invoice.number) },
    { label: bi("Issue date", "تاريخ الإصدار"), value: formatDate(invoice.date) },
    { label: bi("Date of supply", "تاريخ التوريد"), value: formatDate(supplyDate) },
    {
      label: bi("Due date", "تاريخ الاستحقاق"),
      value: invoice.dueDate
        ? formatDate(invoice.dueDate)
        : paymentTermsLabel(invoice.paymentTerms, invoice.date, locale),
    },
    { label: bi("Currency", "العملة"), value: totals.currency },
  ]);

  ledger.parties([
    {
      label: bi("From", "من"),
      name: company.legalName || company.name,
      lines: [
        trnLine(ledger, isVATRegistered ? company.trnVatNumber : null),
        company.businessAddress,
      ],
    },
    {
      label: bi("Bill to", "فاتورة إلى"),
      name: customer.name,
      lines: [trnLine(ledger, customer.trn), customer.address],
    },
  ]);

  ledger.table(
    [
      { key: "desc", label: bi("Description", "الوصف"), weight: 2.7 },
      { key: "qty", label: bi("Qty", "الكمية"), weight: 0.75, align: "end" },
      { key: "price", label: bi("Unit price", "سعر الوحدة"), weight: 1.25, align: "end" },
      { key: "net", label: bi("Net amount", "المبلغ الصافي"), weight: 1.35, align: "end" },
      { key: "type", label: bi("VAT treatment", "المعالجة الضريبية"), weight: 1.65 },
      { key: "rate", label: bi("Rate", "النسبة"), weight: 0.75, align: "end" },
      { key: "vat", label: bi("VAT amount", "قيمة الضريبة"), weight: 1.35, align: "end" },
      { key: "total", label: bi("Total", "الإجمالي"), weight: 1.35, align: "end" },
    ],
    lines.map((line) => {
      const treatment = vatTreatmentForLine(line, !!invoice.reverseCharge);
      const label = TREATMENT_LABELS[treatment];
      // Net after line + allocated document discount (W3-A); legacy rows
      // without net_amount fall back to quantity × unit price.
      const storedNet = (line as InvoiceLine & { netAmount?: number | null }).netAmount;
      const net =
        storedNet !== null && storedNet !== undefined
          ? Math.abs(Number(storedNet))
          : line.quantity * line.unitPrice;
      const rate = lineVatRate(line);
      const vat = net * rate;
      const [primary, secondary] = ledger.pair(label);
      return {
        cells: {
          desc: line.description,
          qty: formatQuantity(line.quantity),
          price: amount(line.unitPrice),
          net: amount(net),
          type: { text: `${primary}\n${secondary}`, size: 7, color: LEDGER_COLORS.muted },
          rate: `${(rate * 100).toFixed(0)}%`,
          vat: amount(vat),
          total: amount(net + vat),
        },
      };
    }),
    { size: 8.5 }
  );

  // VAT breakdown by treatment and rate
  const buckets = aggregateVatBuckets(lines, !!invoice.reverseCharge);
  if (buckets.length > 1 || (buckets[0] && buckets[0].treatment !== "standard_rated")) {
    ledger.section(bi("VAT breakdown", "تفاصيل ضريبة القيمة المضافة"));
    ledger.table(
      [
        { key: "t", label: bi("Treatment", "المعالجة"), weight: 2 },
        { key: "taxable", label: bi("Taxable amount", "المبلغ الخاضع"), weight: 1, align: "end" },
        { key: "vat", label: bi("VAT", "الضريبة"), weight: 1, align: "end" },
        { key: "incl", label: bi("Inclusive total", "الإجمالي"), weight: 1, align: "end" },
      ],
      buckets.map((b) => {
        const lbl = TREATMENT_LABELS[b.treatment];
        return {
          cells: {
            t: `${ledger.rtl ? lbl.ar : lbl.en} ${ltr(`${(b.rate * 100).toFixed(0)}%`)}`,
            taxable: amount(b.taxable),
            vat: amount(b.vat),
            incl: amount(b.taxable + b.vat),
          },
        };
      }),
      { size: 8 }
    );
  }

  const discountAmount = Number(
    (invoice as Invoice & { discountAmount?: number | null }).discountAmount ?? 0
  );
  const rows: Array<{ label: Bi; value: string; bold?: boolean; ruleAbove?: boolean }> = [];
  if (discountAmount > 0)
    rows.push({ label: bi("Discount", "الخصم"), value: `- ${m(discountAmount)}` });
  rows.push({ label: bi("Subtotal excl. VAT", "المجموع قبل الضريبة"), value: m(totals.subtotal) });
  rows.push({
    label: invoice.reverseCharge
      ? bi("VAT (reverse charge)", "الضريبة (احتساب عكسي)")
      : bi("VAT", "ضريبة القيمة المضافة"),
    value: m(totals.vat),
  });
  if (totals.vatAed !== null) {
    rows.push({
      label: bi("VAT total (AED)", "إجمالي الضريبة (درهم)"),
      value: money(totals.vatAed),
    });
  }
  rows.push({
    label: bi("Total", "الإجمالي"),
    value: m(totals.total),
    bold: true,
    ruleAbove: true,
  });
  if (totals.amountPaid > 0) {
    rows.push({
      label: bi("Payments received", "المدفوعات المستلمة"),
      value: `- ${m(totals.amountPaid)}`,
    });
  }
  const totalsW = 78 * MM;
  const totalsBlock = ledger.totals(rows, {
    label: bi("Amount due", "المبلغ المستحق"),
    value: m(totals.amountDue),
  });
  const totalsX = ledger.x(ledger.width - totalsW, totalsW);
  if (totals.vatAed !== null) {
    text(
      ledger.doc,
      `${ledger.inline(bi("Exchange rate", "سعر الصرف"))}: ${ltr(`1 ${totals.currency} = ${totals.exchangeRate.toFixed(4)} AED`)}`,
      {
        x: totalsX,
        y: ledger.y - 8,
        width: totalsW,
        size: 7,
        color: LEDGER_COLORS.muted,
        align: ledger.end,
      }
    );
    ledger.y += 6;
  }
  if (totals.paid) {
    text(ledger.doc, ledger.inline(bi("Paid in full", "مدفوعة بالكامل")), {
      x: totalsX,
      y: ledger.y - 6,
      width: totalsW,
      size: 8,
      bold: true,
      color: LEDGER_COLORS.success,
      align: ledger.end,
    });
    ledger.y += 8;
  }

  // QR (24 mm) at the start side level with the totals block; payment terms beside it.
  const afterTotals = ledger.y;
  const qrSize = 24 * MM;
  const qrY = totalsBlock.top;
  let sideBottom = qrY;
  if (qrPng) {
    ledger.doc.image(qrPng, ledger.x(0, qrSize), qrY, { width: qrSize, height: qrSize });
    sideBottom =
      text(ledger.doc, ledger.inline(bi("Invoice QR (TLV)", "رمز الفاتورة")), {
        x: ledger.x(0, qrSize + 60),
        y: qrY + qrSize + 3,
        width: qrSize + 60,
        size: 7,
        color: LEDGER_COLORS.muted,
        align: ledger.start,
      }).endY + 8;
  }
  if (invoice.paymentTerms) {
    const offset = qrPng ? qrSize + 16 : 0;
    ledger.y = qrY;
    ledger.note(bi("Payment terms", "شروط الدفع"), paymentTermsText(invoice.paymentTerms, locale), {
      offset,
      width: ledger.width - totalsW - offset - 16,
    });
    sideBottom = Math.max(sideBottom, ledger.y);
  }
  ledger.y = Math.max(afterTotals, sideBottom);

  if (brand?.termsText) ledger.note(bi("Terms", "الشروط"), brand.termsText);
  if (brand?.bankDetails)
    ledger.note(bi("Bank details", "تفاصيل الحساب البنكي"), brand.bankDetails);

  ledger.smallPrint([
    brand?.footerText ||
      ledger.sentence(bi("Thank you for your business.", "شكراً لتعاملكم معنا.")),
    isVATRegistered
      ? ledger.sentence(
          bi(
            "This is a computer-generated tax invoice and is valid without a signature.",
            "هذه فاتورة ضريبية صادرة إلكترونياً وصالحة بدون توقيع."
          )
        )
      : "",
  ]);

  return ledger.finish((doc) => {
    if (isDraftStatus(invoice.status)) stampDraftWatermark(doc);
  });
}

async function generateNraInvoicePDF(invoice: Invoice, lines: InvoiceLine[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        bufferPages: true,
        info: {
          Title: `Invoice ${invoice.number}`,
          Author: "Najma Al Raeda Accounting Services",
          Subject: "Invoice",
          Creator: "Muhasib.ai",
        },
      });

      if (
        isDraftStatus(invoice.status) ||
        isArabic(invoice.customerName) ||
        lines.some((line) => isArabic(line.description))
      ) {
        preparePdfDocument(doc);
      }

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      drawNraInvoiceTitle(doc);
      drawNraDateInvoiceBox(doc, invoice);
      drawNraHeader(doc);
      drawNraBillToBox(doc, invoice);
      drawNraLineItemsTable(doc, lines);
      drawNraTotalBox(doc, invoice);

      if (isDraftStatus(invoice.status)) stampDraftWatermark(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawNraInvoiceTitle(doc: PdfDoc) {
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#000000");
  doc.text("Invoice", 0, 45, { width: PAGE_WIDTH, align: "center" });
}

function drawNraDateInvoiceBox(doc: PdfDoc, invoice: Invoice) {
  const x = 432;
  const y = 38;
  const w = 145;
  const h = 39;
  const colW = w / 2;
  const headerH = 15;

  doc.lineWidth(1).strokeColor(BORDER).fillColor("#FFFFFF");
  doc.rect(x, y, w, h).stroke();
  doc
    .moveTo(x + colW, y)
    .lineTo(x + colW, y + h)
    .stroke();
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  doc.text("Date", x, y + 3, { width: colW, align: "center" });
  doc.text("Invoice #", x + colW, y + 3, { width: colW, align: "center" });

  doc.font("Times-Roman").fontSize(10.5);
  doc.text(formatNraInvoiceDate(invoice.date), x, y + 24, { width: colW, align: "center" });
  drawNraSingleLineCellText(doc, invoice.number, x + colW, y + 24, colW);
}

function drawNraHeader(doc: PdfDoc) {
  const centerX = PAGE_WIDTH / 2;
  const logoTop = 70;

  doc.save();
  doc.strokeColor(NR_GREEN).fillColor(NR_GREEN).lineWidth(4).lineJoin("miter").lineCap("butt");

  doc
    .moveTo(centerX - 83, logoTop + 50)
    .lineTo(centerX - 30, logoTop + 50)
    .lineTo(centerX - 7, logoTop + 25)
    .lineTo(centerX + 17, logoTop + 50)
    .lineTo(centerX + 75, logoTop - 18)
    .stroke();

  doc
    .path(
      `M ${centerX + 75} ${logoTop - 18} L ${centerX + 64} ${logoTop + 2} L ${centerX + 89} ${logoTop - 29} Z`
    )
    .fill(NR_GREEN);

  doc.lineWidth(2);
  doc
    .moveTo(centerX - 83, logoTop + 50)
    .lineTo(centerX + 85, logoTop + 50)
    .stroke();
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(21).fillColor(NR_GREEN);
  doc.text("NAJMA AL RAEDA", 0, 131, { width: PAGE_WIDTH, align: "center" });

  doc.lineWidth(1.4).strokeColor(NR_GREEN);
  doc
    .moveTo(centerX - 83, 158)
    .lineTo(centerX + 83, 158)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NR_GREEN);
  doc.text("A C C O U N T I N G   S E R V I C E S", 0, 166, {
    width: PAGE_WIDTH,
    align: "center",
  });

  doc.font("Times-Roman").fontSize(12).fillColor("#000000");
  doc.text("Al Futtaim Tower, 202", 0, 183, { width: PAGE_WIDTH, align: "center" });
  doc.text("Baniyas Square,", 0, 198, { width: PAGE_WIDTH, align: "center" });
  doc.text("Dubai, U.A.E.", 0, 213, { width: PAGE_WIDTH, align: "center" });
  doc.text("971-50-7042270", 0, 228, { width: PAGE_WIDTH, align: "center" });
}

function drawNraBillToBox(doc: PdfDoc, invoice: Invoice) {
  const x = 370;
  const y = 220;
  const w = 185;
  const h = 96;
  const headerH = 24;

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10.5).fillColor("#000000");
  doc.text("Bill To", x + 12, y + 8, { width: w - 24 });

  doc.font("Times-Roman").fontSize(9.5).fillColor("#222222");
  doc.text(invoice.customerName, x + 4, y + headerH + 5, {
    width: w - 4,
    height: h - headerH - 8,
  });
}

function drawNraLineItemsTable(doc: PdfDoc, lines: InvoiceLine[]) {
  const x = 36;
  const y = 345;
  const w = 523;
  const h = 398;
  const headerH = 20;
  const widths = [46, 150, 190, 74, 63];
  const headers = ["Quantity", "Item Code", "Description", "Price Each", "Amount"];
  const colX = widths.reduce<number[]>(
    (acc, width) => {
      acc.push(acc[acc.length - 1] + width);
      return acc;
    },
    [x]
  );

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc.rect(x, y, w, headerH).fillAndStroke(HEADER_FILL, BORDER);

  for (let i = 1; i < colX.length - 1; i += 1) {
    doc
      .moveTo(colX[i], y)
      .lineTo(colX[i], y + h)
      .stroke();
  }
  doc
    .moveTo(x, y + headerH)
    .lineTo(x + w, y + headerH)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  headers.forEach((header, index) => {
    doc.text(header, colX[index] + 2, y + 5, {
      width: widths[index] - 4,
      align: "center",
    });
  });

  let rowY = y + headerH + 5;
  doc.font("Times-Roman").fontSize(10).fillColor("#111111");
  for (const line of lines) {
    if (rowY > y + h - 18) break;
    const parsed = splitLineDescription(line.description);
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0);

    doc.text(formatNraQuantity(line.quantity), colX[0] + 3, rowY, {
      width: widths[0] - 6,
      align: "center",
    });
    doc.text(parsed.itemCode, colX[1] + 3, rowY, { width: widths[1] - 6 });
    doc.text(parsed.description, colX[2] + 3, rowY, { width: widths[2] - 6 });
    doc.text(formatNraPlainAmount(Number(line.unitPrice || 0)), colX[3] + 3, rowY, {
      width: widths[3] - 8,
      align: "right",
    });
    doc.text(formatNraPlainAmount(amount), colX[4] + 3, rowY, {
      width: widths[4] - 8,
      align: "right",
    });

    rowY += Math.max(
      17,
      nraTextHeight(doc, parsed.itemCode, widths[1] - 6),
      nraTextHeight(doc, parsed.description, widths[2] - 6)
    );
  }
}

function drawNraTotalBox(doc: PdfDoc, invoice: Invoice) {
  const x = 36;
  const y = 748;
  const w = 523;
  const h = 40;
  const splitX = 414;

  doc.lineWidth(1).strokeColor(BORDER).rect(x, y, w, h).stroke();
  doc
    .moveTo(splitX, y)
    .lineTo(splitX, y + h)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#000000");
  doc.text("Total", splitX + 13, y + 13, { width: 95 });

  doc.font("Times-Roman").fontSize(10.5);
  doc.text(
    formatNraTotalAmount(Number(invoice.total || 0), invoice.currency),
    splitX + 72,
    y + 17,
    {
      width: x + w - splitX - 84,
      align: "right",
    }
  );
}

type VatBucket = { treatment: VatTreatment; rate: number; taxable: number; vat: number };

function aggregateVatBuckets(lines: InvoiceLine[], reverseCharge: boolean): VatBucket[] {
  const buckets = new Map<string, VatBucket>();
  for (const line of lines) {
    const rate = lineVatRate(line);
    const treatment = vatTreatmentForLine(line, reverseCharge);
    const storedNet = (line as InvoiceLine & { netAmount?: number | null }).netAmount;
    const taxable =
      storedNet !== null && storedNet !== undefined
        ? Math.abs(Number(storedNet))
        : line.quantity * line.unitPrice;
    const vat = taxable * rate;
    const key = `${treatment}:${rate}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.taxable += taxable;
      existing.vat += vat;
    } else {
      buckets.set(key, { treatment, rate, taxable, vat });
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) => a.rate - b.rate || a.treatment.localeCompare(b.treatment)
  );
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
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

function formatDate(value: Date | string | null | undefined): string {
  return ledgerDate(value);
}

function paymentTermsLabel(
  terms: string | null | undefined,
  invoiceDate: Date | string,
  locale: PdfLocale
): string {
  if (!terms) return "—";
  const days = paymentTermsDays(terms);
  if (days === null) return formatPaymentTerms(terms, locale);
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + days);
  return formatDate(due);
}

function paymentTermsDays(terms: string): number | null {
  const map: Record<string, number> = {
    net7: 7,
    net14: 14,
    net30: 30,
    net60: 60,
    net90: 90,
    immediate: 0,
    cod: 0,
  };
  return map[terms.toLowerCase()] ?? null;
}

const PAYMENT_TERMS: Record<string, Bi> = {
  net7: { en: "Net 7 days", ar: "خلال 7 أيام" },
  net14: { en: "Net 14 days", ar: "خلال 14 يومًا" },
  net30: { en: "Net 30 days", ar: "خلال 30 يومًا" },
  net60: { en: "Net 60 days", ar: "خلال 60 يومًا" },
  net90: { en: "Net 90 days", ar: "خلال 90 يومًا" },
  immediate: { en: "Due immediately", ar: "مستحقة فورًا" },
  cod: { en: "Cash on delivery", ar: "الدفع عند التسليم" },
};

function formatPaymentTerms(terms: string, locale: PdfLocale): string {
  const label = PAYMENT_TERMS[terms.toLowerCase()];
  if (!label) return terms;
  return locale === "ar" ? `${label.ar} / ${label.en}` : `${label.en} / ${label.ar}`;
}

function paymentTermsText(terms: string, locale: PdfLocale): string {
  return formatPaymentTerms(terms, locale);
}

function nraTextHeight(doc: PdfDoc, text: string, width: number): number {
  return doc.heightOfString(text || " ", { width }) + 4;
}

function drawNraSingleLineCellText(doc: PdfDoc, text: string, x: number, y: number, width: number) {
  let fontSize = 10.5;
  doc.font("Times-Roman").fontSize(fontSize);
  while (fontSize > 7 && doc.widthOfString(text) > width - 6) {
    fontSize -= 0.5;
    doc.fontSize(fontSize);
  }
  doc.text(text, x, y + (10.5 - fontSize) / 3, {
    width,
    align: "center",
    lineBreak: false,
  });
}

function formatNraInvoiceDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}/${d.getFullYear()}`;
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

/**
 * Delivery note derived from an invoice (W3-A, R03-24): goods and quantities
 * only — no prices or VAT — with receiver signature boxes. Not a tax document.
 */
export async function generateDeliveryNotePDF(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: { locale?: PdfLocale } = {}
): Promise<Buffer> {
  const ledger = new Ledger({
    locale: options.locale ?? pdfLocale(company),
    info: { Title: `Delivery Note ${invoice.number}`, Author: company.name },
  });
  ledger.header({
    companyName: company.legalName || company.name,
    details: companyDetails(ledger, {
      trn: company.trnVatNumber,
      address: company.businessAddress,
      phone: company.contactPhone,
      email: company.contactEmail,
    }),
    title: bi("Delivery note", "إشعار تسليم"),
  });
  ledger.meta([
    { label: bi("Reference invoice", "الفاتورة المرجعية"), value: ltr(invoice.number) },
    { label: bi("Date", "التاريخ"), value: formatDate(invoice.supplyDate ?? invoice.date) },
  ]);
  ledger.parties([
    {
      label: bi("Deliver to", "التسليم إلى"),
      name: invoice.customerName,
      lines: [invoice.customerAddress],
    },
  ]);
  ledger.table(
    [
      { key: "n", label: bi("#", "#"), weight: 0.4 },
      { key: "desc", label: bi("Description", "الوصف"), weight: 5 },
      { key: "qty", label: bi("Quantity", "الكمية"), weight: 1, align: "end" },
    ],
    lines.map((line, i) => ({
      cells: {
        n: String(i + 1),
        desc: line.description,
        qty: formatQuantity(Math.abs(line.quantity)),
      },
    }))
  );
  ledger.ensure(110);
  ledger.y = Math.max(ledger.y + 24, ledger.bottom - 110);
  const boxW = ledger.width / 2 - 10;
  [
    bi("Delivered by", "سُلّم بواسطة"),
    bi("Received by (name, signature, date)", "استلم بواسطة (الاسم، التوقيع، التاريخ)"),
  ].forEach((label, i) => {
    const x = ledger.x(i * (boxW + 20), boxW);
    ledger.doc
      .save()
      .lineWidth(0.5)
      .rect(x, ledger.y, boxW, 70)
      .strokeColor(LEDGER_COLORS.hairline)
      .stroke()
      .restore();
    ledger.stacked(label, x + 6, ledger.y + 6, boxW - 12, { size: 7.5 });
  });
  ledger.y += 84;
  ledger.smallPrint([
    ledger.inline(
      bi("This delivery note is not a tax invoice.", "إشعار التسليم هذا ليس فاتورة ضريبية.")
    ),
  ]);
  return ledger.finish();
}

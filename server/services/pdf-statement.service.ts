import { createPdfDocument } from "./pdf-fonts";
import { fitFontSize } from "./pdf-layout";
import { formatMoney, formatPdfDate } from "./pdf-format";
import type { StatementAging, StatementContact } from "./customer-statement.service";

/** Whose account the statement is: a customer's (what they owe us) or a vendor's (what we owe them). */
export type StatementParty = "customer" | "vendor";

/** The shape both the customer and the vendor statement builders produce. */
export interface StatementDocument {
  from: string;
  to: string;
  openingBalance: number;
  lines: Array<{
    date: string;
    type: string;
    reference: string;
    currency: string;
    documentAmount: number;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  aging: StatementAging;
  /** Phase 8 D1: advances and deposits received and not yet applied (a memo, not part of the balance). */
  unappliedAdvances?: Array<{
    number: string;
    kind: string;
    invoiceNumber: string;
    date: string;
    availableNet: number;
    availableGross: number;
  }>;
}

const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = 760;
const ROW_HEIGHT = 20;

const TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  payment: "Payment",
  refund: "Refund",
  bill: "Bill",
  vendor_credit: "Vendor Credit",
  vendor_credit_fx: "FX Difference",
};

const PARTY_LABELS: Record<StatementParty, { title: string; counterparty: string; ageing: string; footer: string; titlePrefix: string }> = {
  customer: {
    title: "STATEMENT OF ACCOUNT",
    counterparty: "CUSTOMER / العميل",
    ageing: "أعمار الديون",
    footer: "Amounts are in AED at the rate booked on each document. Ageing is by due date. Draft and void documents are excluded.",
    titlePrefix: "Statement of Account",
  },
  vendor: {
    title: "VENDOR STATEMENT",
    counterparty: "SUPPLIER / المورد",
    ageing: "أعمار الذمم الدائنة",
    footer:
      "Amounts are in AED at the rate booked on each document; the balance is what we owe the supplier. Ageing is by due date. Pending, draft and void documents are excluded.",
    titlePrefix: "Vendor Statement",
  },
};

// x offset and width of each table column (sums to CONTENT_WIDTH).
const COLS = {
  date: { x: 0, w: 52 },
  reference: { x: 52, w: 115 },
  type: { x: 167, w: 58 },
  document: { x: 225, w: 78 },
  debit: { x: 303, w: 64 },
  credit: { x: 367, w: 64 },
  balance: { x: 431, w: 64 },
} as const;

export interface StatementPdfCompany {
  name: string;
  trnVatNumber?: string | null;
  businessAddress?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export async function generateStatementPDF(
  statement: StatementDocument & { contact: StatementContact },
  company: StatementPdfCompany,
  party: StatementParty = "customer"
): Promise<Buffer> {
  const labels = PARTY_LABELS[party];
  return new Promise((resolve, reject) => {
    try {
      const doc = createPdfDocument({
        size: "A4",
        margin: MARGIN,
        info: { Title: `${labels.titlePrefix} - ${statement.contact.name}`, Author: company.name },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Header ---
      doc.rect(0, 0, PAGE_WIDTH, 100).fill("#1E40AF");
      doc.fontSize(20).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, MARGIN, 30, { width: CONTENT_WIDTH * 0.55, align: "left" });
      doc.fontSize(16).text(labels.title, MARGIN, 35, { width: CONTENT_WIDTH, align: "right" });
      doc.fontSize(12).fillColor("#DBEAFE").font("Helvetica");
      doc.text("كشف حساب", MARGIN, 57, { width: CONTENT_WIDTH, align: "right" });

      let y = 114;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      if (company.trnVatNumber) {
        doc.text(`TRN: ${company.trnVatNumber}`, MARGIN, y);
        y += 11;
      }
      if (company.businessAddress) {
        doc.text(company.businessAddress, MARGIN, y, { width: 250 });
        y += doc.heightOfString(company.businessAddress, { width: 250 }) + 2;
      }

      // Customer + period on the right of the company block
      const customerX = MARGIN + 290;
      let cy = 114;
      doc.fontSize(9).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text(labels.counterparty, customerX, cy, { width: 205 });
      cy += 14;
      doc.fontSize(11).fillColor("#1F2937");
      doc.text(statement.contact.name, customerX, cy, { width: 205 });
      cy += doc.heightOfString(statement.contact.name, { width: 205 }) + 2;
      if (statement.contact.nameAr) {
        doc.fontSize(10).font("Helvetica");
        doc.text(statement.contact.nameAr, customerX, cy, { width: 205 });
        cy += doc.heightOfString(statement.contact.nameAr, { width: 205 }) + 2;
      }
      if (statement.contact.trnNumber) {
        doc.fontSize(8.5).fillColor("#6B7280").font("Helvetica");
        doc.text(`TRN: ${statement.contact.trnNumber}`, customerX, cy, { width: 205 });
        cy += 12;
      }
      doc.fontSize(9).fillColor("#1F2937").font("Helvetica-Bold");
      doc.text(
        `Period: ${formatPdfDate(statement.from)} - ${formatPdfDate(statement.to)}`,
        customerX,
        cy + 4,
        { width: 205 }
      );
      cy += 18;
      y = Math.max(y, cy) + 12;

      // --- Table ---
      const drawTableHeader = () => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, 30).fill("#1E40AF");
        doc.fontSize(8).fillColor("#FFFFFF").font("Helvetica-Bold");
        const heads: Array<[keyof typeof COLS, string, string, "left" | "right"]> = [
          ["date", "Date", "التاريخ", "left"],
          ["reference", "Reference", "المرجع", "left"],
          ["type", "Type", "النوع", "left"],
          ["document", "Document", "المستند", "right"],
          ["debit", "Debit (AED)", "مدين", "right"],
          ["credit", "Credit (AED)", "دائن", "right"],
          ["balance", "Balance (AED)", "الرصيد", "right"],
        ];
        for (const [key, en, ar, align] of heads) {
          const c = COLS[key];
          doc.text(en, MARGIN + c.x + 3, y + 5, { width: c.w - 6, align, lineBreak: false });
          doc.font("Helvetica").text(ar, MARGIN + c.x + 3, y + 16, { width: c.w - 6, align, lineBreak: false });
          doc.font("Helvetica-Bold");
        }
        y += 30;
      };
      const ensureSpace = (needed: number) => {
        if (y + needed <= BOTTOM) return false;
        doc.addPage();
        y = MARGIN;
        return true;
      };
      const cell = (key: keyof typeof COLS, text: string, align: "left" | "right", size = 8) => {
        const c = COLS[key];
        doc.fontSize(fitFontSize(doc, text, c.w - 6, size));
        doc.text(text, MARGIN + c.x + 3, y + 6, { width: c.w - 6, align, lineBreak: false });
      };

      drawTableHeader();
      // Opening balance row
      doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill("#EFF6FF");
      doc.fillColor("#1F2937").font("Helvetica-Bold");
      doc.fontSize(8).text("Opening Balance / الرصيد الافتتاحي", MARGIN + 6, y + 6, { width: 280, lineBreak: false });
      cell("balance", formatMoney(statement.openingBalance), "right");
      y += ROW_HEIGHT;

      statement.lines.forEach((line, index) => {
        if (ensureSpace(ROW_HEIGHT + 4)) drawTableHeader();
        doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill(index % 2 === 0 ? "#FFFFFF" : "#F9FAFB");
        doc.fillColor("#1F2937").font("Helvetica");
        cell("date", formatPdfDate(line.date), "left");
        cell("reference", line.reference, "left");
        cell("type", TYPE_LABEL[line.type], "left");
        cell("document", `${line.currency} ${formatMoney(line.documentAmount)}`, "right");
        cell("debit", line.debit ? formatMoney(line.debit) : "", "right");
        cell("credit", line.credit ? formatMoney(line.credit) : "", "right");
        cell("balance", formatMoney(line.balance), "right");
        y += ROW_HEIGHT;
      });

      if (ensureSpace(ROW_HEIGHT + 4)) drawTableHeader();
      doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill("#1E40AF");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance / الرصيد الختامي", MARGIN + 6, y + 6, { width: 200, lineBreak: false });
      cell("debit", formatMoney(statement.totalDebits), "right");
      cell("credit", formatMoney(statement.totalCredits), "right");
      cell("balance", formatMoney(statement.closingBalance), "right");
      y += ROW_HEIGHT + 22;

      // --- Ageing ---
      ensureSpace(90);
      doc.fontSize(10).fillColor("#1E40AF").font("Helvetica-Bold");
      doc.text(`AGEING AT ${formatPdfDate(statement.to).toUpperCase()} / ${labels.ageing}`, MARGIN, y, {
        width: CONTENT_WIDTH,
      });
      y += 18;
      const buckets: Array<[string, string, number]> = [
        ["Current", "حالي", statement.aging.current],
        ["1-30 days", "1-30 يوماً", statement.aging.days1to30],
        ["31-60 days", "31-60 يوماً", statement.aging.days31to60],
        ["61-90 days", "61-90 يوماً", statement.aging.days61to90],
        ["90+ days", "أكثر من 90 يوماً", statement.aging.over90],
        ["Total", "الإجمالي", statement.aging.total],
      ];
      const boxW = CONTENT_WIDTH / buckets.length;
      buckets.forEach(([en, ar, value], i) => {
        const x = MARGIN + i * boxW;
        const isTotal = i === buckets.length - 1;
        doc.rect(x, y, boxW, 46).fill(isTotal ? "#EFF6FF" : "#F9FAFB").stroke("#E5E7EB");
        doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold");
        doc.text(en, x + 4, y + 6, { width: boxW - 8, align: "center", lineBreak: false });
        doc.font("Helvetica").text(ar, x + 4, y + 17, { width: boxW - 8, align: "center", lineBreak: false });
        const text = formatMoney(value);
        doc.fontSize(fitFontSize(doc, text, boxW - 8, 10)).fillColor("#1F2937").font("Helvetica-Bold");
        doc.text(text, x + 4, y + 31, { width: boxW - 8, align: "center", lineBreak: false });
      });
      y += 60;

      // --- Advances received and not yet applied (memo) ---
      const advances = statement.unappliedAdvances ?? [];
      if (advances.length > 0) {
        ensureSpace(40 + advances.length * 16);
        doc.fontSize(10).fillColor("#1E40AF").font("Helvetica-Bold");
        doc.text("ADVANCES RECEIVED, NOT YET APPLIED / دفعات مقدمة غير مطبقة", MARGIN, y, { width: CONTENT_WIDTH });
        y += 16;
        doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica");
        doc.text("Memo only: these amounts are already paid and are not part of the balance above.", MARGIN, y, { width: CONTENT_WIDTH });
        y += 12;
        doc.fontSize(8.5).fillColor("#1F2937").font("Helvetica");
        for (const a of advances) {
          ensureSpace(16);
          doc.text(`${a.number} (${a.invoiceNumber}) - ${formatPdfDate(a.date)}${a.kind === "deposit" ? " - deposit" : ""}`, MARGIN, y, { width: 330, lineBreak: false });
          doc.text(formatMoney(a.availableGross), MARGIN + 330, y, { width: CONTENT_WIDTH - 330, align: "right", lineBreak: false });
          y += 16;
        }
        y += 8;
      }

      doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica");
      doc.text(
        labels.footer,
        MARGIN,
        Math.min(y, 790),
        { width: CONTENT_WIDTH, align: "center" }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
